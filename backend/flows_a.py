import io, json, asyncio
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Body, Request
from fastapi.responses import Response
import openpyxl
from core import (db, col, uid, now, today, num, clean, audit, verify_audit_chain, current_user, require, has_company,
                  hash_pw, check_pw, make_token, build_ctx, save_file, read_file, send_email, email_shell, logger)
from registers import create_record, update_record, R
import hooks

router = APIRouter(prefix="/api")
SENSITIVE = ["salary", "basic", "daily_wage", "rate", "margin_pct", "margin_amt", "bid_value", "total_cost", "landed_total"]


# ---------------- auth ----------------
@router.post("/auth/login")
async def login(body: dict = Body(...), request: Request = None):
    email = (body.get("email") or "").strip().lower()
    user = await db.users.find_one({"email": email}, {"_id": 0})
    ok = bool(user and check_pw(body.get("password", ""), user["password_hash"]))
    await db.login_history.insert_one({"id": uid(), "email": email, "success": ok, "at": now(),
                                       "ip": request.client.host if request and request.client else None,
                                       "agent": request.headers.get("user-agent", "")[:200] if request else ""})
    if not ok:
        raise HTTPException(401, "Invalid email or password")
    if user.get("onboarding_locked"):
        raise HTTPException(403, "Your login is locked until HR verifies your mandatory onboarding documents.")
    if user.get("locked"):
        raise HTTPException(403, "Account disabled. Contact your administrator.")
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login": now()}})
    return {"token": make_token(user["id"]), "user": await build_ctx(user)}


@router.get("/auth/me")
async def me(user=Depends(current_user)):
    return user


@router.get("/auth/login-history")
async def login_history(user=Depends(current_user)):
    f = {} if user["is_super"] else {"email": user["email"]}
    return await db.login_history.find(f, {"_id": 0}).sort("at", -1).to_list(200)


# ---------------- companies ----------------
async def company_stats(c):
    cid = c["id"]
    return {"projects_running": await col(cid, "projects").count_documents({"status": {"$in": ["Active", "Running"]}}),
            "tenders_active": await col(cid, "tenders").count_documents({"stage": {"$nin": ["Won", "Lost", "No-Go"]}}),
            "pending_approvals": await db.approvals.count_documents({"company_id": cid, "status": "Pending"}),
            "gstin_count": len(c.get("gstins") or [])}


@router.get("/companies")
async def companies(user=Depends(current_user)):
    rows = await db.companies.find({}, {"_id": 0}).to_list(100)
    rows = [c for c in rows if has_company(user, c["id"])]
    for c in rows:
        c["stats"] = await company_stats(c)
    return rows


@router.get("/companies/{cid}")
async def company(cid: str, user=Depends(current_user)):
    if not has_company(user, cid):
        raise HTTPException(403, "No access")
    c = await db.companies.find_one({"id": cid}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Company not found")
    return c


@router.post("/companies")
async def create_company(body: dict = Body(...), user=Depends(current_user)):
    if not user["is_super"]:
        raise HTTPException(403, "Only Super Admin can create companies")
    if not body.get("name") or not body.get("short_code"):
        raise HTTPException(400, "Name and short code are required")
    body.update(id=uid(), created_at=now(), short_code=body["short_code"].upper())
    body.setdefault("theme", {"preset": "ocean-instinct", "primary": "#20309A", "surface": "#FFFFFF", "accent": "#BB232B"})
    await db.companies.insert_one(dict(body))
    await audit(body["id"], user, "create", "companies", body["id"], {}, body)
    return clean(body)


@router.put("/companies/{cid}")
async def update_company(cid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "ADMIN", "edit")
    before = await db.companies.find_one({"id": cid}, {"_id": 0})
    body.pop("id", None); body.pop("stats", None)
    await db.companies.update_one({"id": cid}, {"$set": body})
    after = await db.companies.find_one({"id": cid}, {"_id": 0})
    await audit(cid, user, "update", "companies", cid, before, after)
    return after


@router.post("/companies/{cid}/close-period")
async def close_period(cid: str, body: dict = Body(...), user=Depends(current_user)):
    if not (user["is_super"] or "Accounts Head" in user["acting_roles"]):
        raise HTTPException(403, "Only Accounts Head can close/reopen periods")
    p, action = body.get("period"), body.get("action", "close")
    if action == "reopen" and not body.get("reason"):
        raise HTTPException(400, "Reason required to reopen a period")
    op = {"$addToSet": {"closed_periods": p}} if action == "close" else {"$pull": {"closed_periods": p}}
    await db.companies.update_one({"id": cid}, op)
    await audit(cid, user, f"period_{action}", "companies", cid, note=f"{p} {body.get('reason', '')}")
    return await db.companies.find_one({"id": cid}, {"_id": 0})


# ---------------- users & roles ----------------
@router.get("/admin/roles")
async def roles(user=Depends(current_user)):
    return await db.roles.find({}, {"_id": 0}).to_list(100)


@router.post("/admin/roles")
async def save_role(body: dict = Body(...), user=Depends(current_user)):
    if not user["is_super"]:
        raise HTTPException(403, "Only Super Admin manages roles")
    if body.get("clone_from"):
        src = await db.roles.find_one({"id": body.pop("clone_from")}, {"_id": 0})
        body = {**src, **body, "id": uid(), "system": False}
    if body.get("id") and await db.roles.find_one({"id": body["id"]}):
        await db.roles.update_one({"id": body["id"]}, {"$set": body})
    else:
        body["id"] = body.get("id") or uid()
        await db.roles.insert_one(dict(body))
    await audit("global", user, "save", "roles", body["id"])
    return await db.roles.find_one({"id": body["id"]}, {"_id": 0})


@router.get("/admin/users")
async def users(user=Depends(current_user)):
    if not (user["is_super"] or user["modules"].get("ADMIN") in ("edit", "admin") or user["modules"].get("M3") in ("edit", "approve", "admin")):
        raise HTTPException(403, "No access")
    return await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(500)


@router.post("/admin/users")
async def save_user(body: dict = Body(...), user=Depends(current_user)):
    if not (user["is_super"] or user["modules"].get("ADMIN") in ("edit", "admin")):
        raise HTTPException(403, "No access")
    pw = body.pop("password", None)
    body.pop("role_names", None)
    if body.get("id"):
        if pw:
            body["password_hash"] = hash_pw(pw)
        await db.users.update_one({"id": body["id"]}, {"$set": body})
    else:
        body["email"] = body["email"].strip().lower()
        if await db.users.find_one({"email": body["email"]}):
            raise HTTPException(400, "Email already exists")
        body.update(id=uid(), password_hash=hash_pw(pw or "Welcome@123"), created_at=now())
        await db.users.insert_one(dict(body))
    await audit("global", user, "save", "users", body["id"])
    return await db.users.find_one({"id": body["id"]}, {"_id": 0, "password_hash": 0})


@router.post("/me/delegations")
async def delegate(body: dict = Body(...), user=Depends(current_user)):
    d = {"to_user_id": body["to_user_id"], "from_date": body["from_date"], "to_date": body["to_date"]}
    await db.users.update_one({"id": user["id"]}, {"$push": {"delegations": d}})
    return {"ok": True}


# ---------------- HR onboarding gate ----------------
@router.post("/c/{cid}/employees/{eid}/verify-docs")
async def verify_docs(cid: str, eid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M3", "approve")
    emp = await col(cid, "employees").find_one({"id": eid}, {"_id": 0})
    if not emp:
        raise HTTPException(404, "Employee not found")
    docs = emp.get("onboarding_docs") or []
    for dd in docs:
        if dd["name"] in (body.get("verified") or []):
            dd["verified"] = True
            dd["verified_by"] = user["name"]
    all_ok = all(dd.get("verified") for dd in docs if dd.get("mandatory", True))
    await col(cid, "employees").update_one({"id": eid}, {"$set": {"onboarding_docs": docs, "docs_verified": all_ok, "onboarding_stage": "Verified" if all_ok else "Documents Pending"}})
    if all_ok:
        await db.users.update_one({"employee_id": eid}, {"$set": {"onboarding_locked": False}})
    await audit(cid, user, "verify_docs", "employees", eid, note=",".join(body.get("verified") or []))
    return {"docs_verified": all_ok, "onboarding_docs": docs}


@router.post("/c/{cid}/employees/{eid}/create-login")
async def create_login(cid: str, eid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M3", "edit")
    emp = await col(cid, "employees").find_one({"id": eid}, {"_id": 0})
    if await db.users.find_one({"email": emp["email"].lower()}):
        raise HTTPException(400, "A login already exists for this email")
    role = await db.roles.find_one({"name": body.get("role", "Employee")}, {"_id": 0})
    u = {"id": uid(), "email": emp["email"].lower(), "name": emp["name"], "password_hash": hash_pw(body.get("password") or "Welcome@123"),
         "roles": [role["id"]] if role else [], "company_ids": [cid], "employee_id": eid, "onboarding_locked": not emp.get("docs_verified"), "created_at": now()}
    await db.users.insert_one(dict(u))
    return {"ok": True, "onboarding_locked": u["onboarding_locked"]}


# ---------------- files ----------------
@router.post("/c/{cid}/files")
async def upload(cid: str, file: UploadFile = File(...), tag: str = Form(""), stamp: str = Form(""), user=Depends(current_user)):
    if not has_company(user, cid):
        raise HTTPException(403, "No access")
    data = await file.read()
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, "File too large (25 MB max)")
    if stamp and (file.content_type or "").startswith("image/"):
        data = await asyncio.to_thread(stamp_image, data, stamp)
    return await save_file(cid, file.filename, data, user, {"tag": tag}, file.content_type)


def stamp_image(data, text):
    from PIL import Image, ImageDraw
    try:
        img = Image.open(io.BytesIO(data)).convert("RGB")
        img.thumbnail((1600, 1600))
        d = ImageDraw.Draw(img)
        h = max(28, img.height // 18)
        d.rectangle([0, img.height - h, img.width, img.height], fill=(11, 18, 32))
        d.text((10, img.height - h + 6), text[:160], fill=(255, 255, 255))
        out = io.BytesIO(); img.save(out, "JPEG", quality=82)
        return out.getvalue()
    except Exception:
        return data


@router.get("/c/{cid}/files/{fid}")
async def download(cid: str, fid: str, user=Depends(current_user)):
    if not has_company(user, cid):
        raise HTTPException(403, "No access")
    rec, data = await read_file(cid, fid)
    return Response(content=data, media_type=rec.get("content_type") or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{rec.get("name", "file")}"'})


# ---------------- AI reader ----------------
PROMPTS = {
    "nit": 'Extract tender (NIT) fields. JSON: {"fields":[{"key","label","value","confidence"}]} with keys: tender_no, title, department, location, state, estimated_value (number INR), emd (number INR), tender_fee (number), bid_due_date (YYYY-MM-DD), prebid_date (YYYY-MM-DD), opening_date (YYYY-MM-DD), completion_period, eligibility, required_documents (semicolon list), tender_portal_url.',
    "corrigendum": 'Extract corrigendum changes. JSON: {"fields":[{"key","label","value","confidence"}]} keys: corrigendum_no, date (YYYY-MM-DD), new_bid_due_date (YYYY-MM-DD), summary_of_changes.',
    "boq": 'Extract the Bill of Quantities. JSON: {"fields":[{"key":"title","label":"Title","value":...,"confidence":..}], "items":[{"code","desc","uom","qty"(number),"rate"(number or null),"confidence"}]}.',
    "vendor_quote": 'Extract vendor quotation. JSON: {"fields":[{"key","label","value","confidence"}] keys vendor_name, quote_no, date (YYYY-MM-DD), validity, freight (number), payment_terms, delivery_period; "items":[{"desc","uom","qty","rate","gst_pct","confidence"}]}.',
    "invoice": 'Extract invoice. JSON: {"fields":[{"key","label","value","confidence"}] keys party, gstin, invoice_no, date (YYYY-MM-DD), taxable (number), gst_amount (number), total (number); "items":[{"desc","qty","rate","confidence"}]}.',
}


def office_to_text(name, data):
    n = name.lower()
    if n.endswith((".xlsx", ".xlsm")):
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True, keep_vba=False)
        out, preview = [], []
        for ws in wb.worksheets[:6]:
            out.append(f"## Sheet: {ws.title}")
            for i, row in enumerate(ws.iter_rows(values_only=True)):
                if i > 400:
                    break
                vals = ["" if v is None else str(v) for v in row]
                if any(vals):
                    out.append(" | ".join(vals))
                    if len(preview) < 200:
                        preview.append(vals[:12])
        return "\n".join(out)[:120000], preview
    if n.endswith(".docx"):
        import docx
        d = docx.Document(io.BytesIO(data))
        parts = [p.text for p in d.paragraphs if p.text.strip()]
        for t in d.tables:
            for r in t.rows:
                parts.append(" | ".join(c.text for c in r.cells))
        return "\n".join(parts)[:120000], None
    return data.decode("utf-8", "ignore")[:120000], None


@router.post("/c/{cid}/ai/extract")
async def ai_extract(cid: str, file: UploadFile = File(...), doc_type: str = Form("nit"), user=Depends(current_user)):
    from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType, TextDelta, StreamDone
    import os, tempfile
    if not has_company(user, cid):
        raise HTTPException(403, "No access")
    data = await file.read()
    saved = await save_file(cid, file.filename, data, user, {"tag": f"ai_{doc_type}"}, file.content_type)
    name = (file.filename or "").lower()
    prompt = PROMPTS.get(doc_type, PROMPTS["nit"]) + " confidence is 0-1. Use null when not found. Reply ONLY with JSON."
    chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=uid(),
                   system_message="You are a precise data extraction engine for Indian EPC tender and procurement documents.").with_model("gemini", "gemini-2.5-flash")
    preview, text = None, None
    tmp = None
    if name.endswith(".pdf") or (file.content_type or "").startswith("image/"):
        ext = name.rsplit(".", 1)[-1] if "." in name else "pdf"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix="." + ext); tmp.write(data); tmp.close()
        mime = "application/pdf" if name.endswith(".pdf") else (file.content_type or "image/png")
        msg = UserMessage(text=prompt, file_contents=[FileContentWithMimeType(file_path=tmp.name, mime_type=mime)])
    else:
        text, preview = office_to_text(name, data)
        msg = UserMessage(text=prompt + "\n\nDOCUMENT CONTENT:\n" + text)
    out = ""
    try:
        async for ev in chat.stream_message(msg):
            if isinstance(ev, TextDelta):
                out += ev.content
            elif isinstance(ev, StreamDone):
                break
    except Exception as e:
        logger.error("AI extract failed: %s", e)
        raise HTTPException(502, f"AI reading failed: {str(e)[:200]}")
    finally:
        if tmp:
            os.unlink(tmp.name)
    try:
        parsed = json.loads(out[out.find("{"): out.rfind("}") + 1])
    except Exception:
        raise HTTPException(502, "AI returned an unreadable response; please retry")
    return {"file": saved, "doc_type": doc_type, "fields": parsed.get("fields") or [], "items": parsed.get("items") or [],
            "preview_rows": preview, "preview_text": (text or "")[:20000] if not preview else None}


# ---------------- alerts & calendar ----------------
async def expiry_items(cid):
    """(date, title, kind, entity, id)"""
    out = []
    specs = [("vault_docs", "expiry_date", "Licence/Doc expiry", "name"), ("bgs", "expiry_date", "BG expiry", "bg_no"),
             ("insurance", "expiry_date", "Insurance expiry", "policy_no"), ("trainings", "expiry_date", "Training/Licence expiry", "title"),
             ("contracts", "end_date", "Contract end", "title"), ("permits", "expiry_date", "Permit/NOC expiry", "title"),
             ("warranties", "expiry_date", "Warranty/DLP end", "title"), ("compliances", "due_date", "Statutory compliance due", "title"),
             ("correspondence", "reply_due", "Reply due", "subject"), ("equipment", "next_maintenance", "Equipment maintenance", "name")]
    for reg, fld, kind, label in specs:
        async for r in col(cid, reg).find({fld: {"$nin": [None, ""]}, "superseded": {"$ne": True}, "status": {"$nin": ["Released", "Closed", "Replied", "Superseded"]}}, {"_id": 0}):
            out.append((r[fld][:10], f"{kind}: {r.get(label) or r.get('name') or ''}", kind, reg, r["id"], r.get("project_id")))
    async for v in col(cid, "vehicles").find({}, {"_id": 0}):
        for fld, k in (("insurance_expiry", "Vehicle insurance"), ("fitness_expiry", "Vehicle fitness"), ("puc_expiry", "Vehicle PUC"), ("next_service", "Vehicle service")):
            if v.get(fld):
                out.append((v[fld][:10], f"{k}: {v.get('reg_no')}", k, "vehicles", v["id"], v.get("project_id")))
    async for t in col(cid, "tenders").find({"stage": {"$nin": ["Won", "Lost", "No-Go", "Submitted"]}}, {"_id": 0}):
        for fld, k in (("bid_due_date", "Tender bid due"), ("prebid_date", "Pre-bid meeting")):
            if t.get(fld):
                out.append((t[fld][:10], f"{k}: {t.get('tender_no')} {t.get('title', '')[:40]}", k, "tenders", t["id"], None))
    return out


@router.get("/c/{cid}/alerts")
async def alerts(cid: str, user=Depends(current_user)):
    if not has_company(user, cid):
        raise HTTPException(403, "No access")
    td = date.today()
    res = []
    for d, title, kind, reg, rid, pid in await expiry_items(cid):
        try:
            days = (date.fromisoformat(d) - td).days
        except ValueError:
            continue
        if days <= 30:
            bucket = 1 if days <= 1 else 7 if days <= 7 else 15 if days <= 15 else 30
            res.append({"id": f"{reg}-{rid}-{kind}", "title": title, "date": d, "days_left": days, "rule": f"{bucket}-day",
                        "severity": "danger" if days <= 7 else "warning", "entity": reg, "entity_id": rid, "project_id": pid})
    async for n in col(cid, "ncrs").find({"status": {"$nin": ["Closed"]}, "due_date": {"$lt": td.isoformat()}}, {"_id": 0}):
        res.append({"id": f"ncr-{n['id']}", "title": f"NCR overdue - escalated: {n.get('number')} {n.get('title', '')}", "date": n["due_date"],
                    "days_left": (date.fromisoformat(n["due_date"][:10]) - td).days, "rule": "escalation", "severity": "danger", "entity": "ncrs", "entity_id": n["id"]})
    async for p in col(cid, "projects").find({"status": "Active"}, {"_id": 0}):
        async for s in col(cid, "sites").find({"project_id": p["id"]}, {"_id": 0}):
            last = await col(cid, "dprs").find_one({"site_id": s["id"]}, sort=[("date", -1)])
            if not last or last.get("date", "") < (td - timedelta(days=1)).isoformat():
                res.append({"id": f"dpr-{s['id']}", "title": f"Missing DPR: {p.get('code')} / {s.get('name')}", "date": (last or {}).get("date", "-"),
                            "days_left": 0, "rule": "missing-dpr", "severity": "warning", "entity": "sites", "entity_id": s["id"], "project_id": p["id"]})
    stored = await col(cid, "alerts").find({"read": False}, {"_id": 0}).sort("at", -1).to_list(100)
    for s in stored:
        res.append({"id": s["id"], "title": s["title"], "date": s["at"][:10], "days_left": 0, "rule": "event", "severity": s["severity"],
                    "entity": s.get("entity"), "entity_id": s.get("entity_id"), "message": s.get("message"), "stored": True})
    res.sort(key=lambda x: x["days_left"])
    return res


@router.post("/c/{cid}/alerts/{aid}/read")
async def read_alert(cid: str, aid: str, user=Depends(current_user)):
    await col(cid, "alerts").update_one({"id": aid}, {"$set": {"read": True}})
    return {"ok": True}


@router.get("/c/{cid}/calendar")
async def calendar(cid: str, user=Depends(current_user)):
    if not has_company(user, cid):
        raise HTTPException(403, "No access")
    ev = [{"date": d, "title": t, "kind": k, "entity": r, "entity_id": i} for d, t, k, r, i, _ in await expiry_items(cid)]
    async for t in col(cid, "tasks").find({"due_date": {"$nin": [None, ""]}}, {"_id": 0}):
        ev.append({"date": t["due_date"][:10], "title": f"Task: {t.get('title')}", "kind": "Task", "entity": "tasks", "entity_id": t["id"], "status": t.get("status")})
    async for t in col(cid, "reminders").find({}, {"_id": 0}):
        ev.append({"date": (t.get("date") or "")[:10], "title": f"Reminder: {t.get('title')}", "kind": "Reminder", "entity": "reminders", "entity_id": t["id"]})
    return sorted(ev, key=lambda e: e["date"])


# ---------------- dashboard & MIS ----------------
async def company_kpis(cid):
    projects = await col(cid, "projects").find({}, {"_id": 0}).to_list(500)
    tenders = await col(cid, "tenders").find({}, {"_id": 0}).to_list(2000)
    invoices = await col(cid, "invoices").find({}, {"_id": 0}).to_list(5000)
    bgs = await col(cid, "bgs").find({"status": {"$ne": "Released"}}, {"_id": 0}).to_list(2000)
    won = sum(1 for t in tenders if t.get("stage") == "Won")
    lost = sum(1 for t in tenders if t.get("stage") == "Lost")
    order_book = sum(num(p.get("contract_value")) for p in projects if p.get("status") == "Active")
    billed = sum(num(p.get("billed_value")) for p in projects)
    recv = sum(num(i.get("net_receivable")) - num(i.get("received")) for i in invoices)
    budget = sum(num(h.get("budget")) for p in projects for h in (p.get("budget") or {}).values())
    actual = sum(num(h.get("actual")) for p in projects for h in (p.get("budget") or {}).values())
    stages = {}
    for t in tenders:
        stages[t.get("stage", "Identified")] = stages.get(t.get("stage", "Identified"), 0) + 1
    by_state = {}
    for p in projects:
        s = by_state.setdefault(p.get("state", "NA"), {"state": p.get("state", "NA"), "projects": 0, "value": 0, "billed": 0})
        s["projects"] += 1; s["value"] += num(p.get("contract_value")); s["billed"] += num(p.get("billed_value"))
    lost_reasons = {}
    for t in tenders:
        if t.get("stage") == "Lost":
            lost_reasons[t.get("lost_reason") or "Unspecified"] = lost_reasons.get(t.get("lost_reason") or "Unspecified", 0) + 1
    return {"projects_active": sum(1 for p in projects if p.get("status") == "Active"), "projects_closed": sum(1 for p in projects if p.get("status") == "Closed"),
            "order_book": order_book, "billed": billed, "receivables": recv, "bg_exposure": sum(num(b.get("amount")) for b in bgs),
            "tenders_active": sum(1 for t in tenders if t.get("stage") not in ("Won", "Lost", "No-Go")), "won": won, "lost": lost,
            "win_ratio": round(won * 100 / (won + lost), 1) if won + lost else 0, "tender_stages": stages, "budget_total": budget, "actual_total": actual,
            "margin_pct": round((billed - actual) * 100 / billed, 1) if billed else 0, "by_state": list(by_state.values()),
            "lost_reasons": lost_reasons,
            "projects": [{"id": p["id"], "code": p.get("code"), "name": p.get("name"), "physical_pct": p.get("physical_pct", 0), "contract_value": p.get("contract_value"),
                          "billed_value": p.get("billed_value", 0), "status": p.get("status"), "state": p.get("state"),
                          "budget": sum(num(h.get("budget")) for h in (p.get("budget") or {}).values()),
                          "actual": sum(num(h.get("actual")) for h in (p.get("budget") or {}).values())} for p in projects]}


@router.get("/c/{cid}/dashboard")
async def dashboard(cid: str, user=Depends(current_user)):
    if not has_company(user, cid):
        raise HTTPException(403, "No access")
    k = await company_kpis(cid)
    k["pending_approvals"] = await db.approvals.count_documents({"company_id": cid, "status": "Pending"})
    k["my_tasks"] = await col(cid, "tasks").count_documents({"assignee_id": user["id"], "status": {"$ne": "Done"}})
    k["alerts"] = len(await alerts(cid, user))
    return k


@router.get("/group/mis")
async def group_mis(user=Depends(current_user)):
    if not (user["is_super"] or "Director" in user["role_names"]):
        raise HTTPException(403, "Group MIS is for Super Admin / Management")
    out = []
    for c in await db.companies.find({}, {"_id": 0}).to_list(100):
        k = await company_kpis(c["id"])
        k.pop("projects", None)
        out.append({"company": {"id": c["id"], "name": c["name"], "short_code": c.get("short_code"), "theme": c.get("theme")}, **k})
    return out


# ---------------- audit ----------------
@router.get("/c/{cid}/audit")
async def audit_log(cid: str, entity: str = None, entity_id: str = None, user=Depends(current_user)):
    if not has_company(user, cid):
        raise HTTPException(403, "No access")
    f = {"company_id": cid}
    if entity:
        f["entity"] = entity
    if entity_id:
        f["entity_id"] = entity_id
    return await db.audit.find(f, {"_id": 0}).sort("seq", -1).to_list(500)


@router.get("/audit/verify")
async def audit_verify(user=Depends(current_user)):
    return await verify_audit_chain()


# ---------------- email log & triage ----------------
@router.get("/c/{cid}/emails")
async def emails(cid: str, vendor_id: str = None, user=Depends(current_user)):
    require(user, cid, "M15", "view")
    f = {"vendor_id": vendor_id} if vendor_id else {}
    return await col(cid, "email_log").find(f, {"_id": 0, "html": 0}).sort("at", -1).to_list(500)


@router.get("/c/{cid}/emails/{eid}")
async def email_detail(cid: str, eid: str, user=Depends(current_user)):
    require(user, cid, "M15", "view")
    return await col(cid, "email_log").find_one({"id": eid}, {"_id": 0})


@router.post("/c/{cid}/emails/{eid}/attach")
async def email_attach(cid: str, eid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M15", "edit")
    link = {"entity": body["entity"], "entity_id": body["entity_id"], "label": body.get("label"), "by": user["name"], "at": now()}
    await col(cid, "email_log").update_one({"id": eid}, {"$push": {"attached_to": link}})
    return {"ok": True}


@router.post("/c/{cid}/emails/retry/{eid}")
async def email_retry(cid: str, eid: str, user=Depends(current_user)):
    require(user, cid, "M15", "edit")
    e = await col(cid, "email_log").find_one({"id": eid}, {"_id": 0})
    r = await send_email(cid, to=e["to"], subject=e["subject"], html=e["html"], entity=e.get("entity"), entity_id=e.get("entity_id"), vendor_id=e.get("vendor_id"), user=user)
    return r


# ---------------- Tally ----------------
@router.get("/c/{cid}/tally/xml")
async def tally_xml(cid: str, user=Depends(current_user)):
    require(user, cid, "M12", "view")
    comp = await db.companies.find_one({"id": cid}, {"_id": 0})
    maps = {m.get("erp_key"): m.get("tally_ledger") for m in await col(cid, "tally_mappings").find({}, {"_id": 0}).to_list(500)}
    vs = await col(cid, "vouchers").find({"status": {"$in": ["Pending", "Failed"]}}, {"_id": 0}).to_list(2000)
    from xml.sax.saxutils import escape as xe
    body = []
    for v in vs:
        led = maps.get(v["voucher_type"], v["voucher_type"] + " A/c")
        party = maps.get(v.get("party") or "", v.get("party") or "Cash")
        body.append(f'<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="{xe(v["voucher_type"])}" ACTION="Create"><DATE>{v["date"].replace("-", "")}</DATE>'
                    f'<VOUCHERNUMBER>{xe(v.get("ref_no") or v["id"])}</VOUCHERNUMBER><NARRATION>{xe(v.get("narration", ""))}</NARRATION>'
                    f'<ALLLEDGERENTRIES.LIST><LEDGERNAME>{xe(party)}</LEDGERNAME><AMOUNT>-{v["amount"]}</AMOUNT></ALLLEDGERENTRIES.LIST>'
                    f'<ALLLEDGERENTRIES.LIST><LEDGERNAME>{xe(led)}</LEDGERNAME><AMOUNT>{v["amount"]}</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>')
    xml = (f'<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>'
           f'<STATICVARIABLES><SVCURRENTCOMPANY>{xe(comp.get("tally_company") or comp["name"])}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>{"".join(body)}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>')
    return Response(content=xml, media_type="application/xml", headers={"Content-Disposition": "attachment; filename=tally_vouchers.xml"})


@router.post("/c/{cid}/tally/mark")
async def tally_mark(cid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M12", "edit")
    status = body.get("status", "Synced")
    upd = {"status": status, "synced_at": now() if status == "Synced" else None, "error": body.get("error")}
    if status == "Synced":
        upd["locked"] = True
    await col(cid, "vouchers").update_many({"id": {"$in": body.get("ids", [])}}, {"$set": upd})
    await audit(cid, user, f"tally_{status}", "vouchers", ",".join(body.get("ids", []))[:200])
    return {"ok": True}


# ---------------- cross-company import ----------------
@router.post("/import/cross/preview")
async def cross_preview(body: dict = Body(...), user=Depends(current_user)):
    src, tgt, reg = body["source_cid"], body["target_cid"], body["register"]
    if not (has_company(user, src) and has_company(user, tgt)):
        raise HTTPException(403, "Need access to both companies")
    rows = await col(src, reg).find({}, {"_id": 0}).to_list(2000)
    key = {"vendors": "gstin", "products": "code", "employees": "email", "subcontractors": "gstin"}.get(reg, "name")
    existing = {r.get(key) for r in await col(tgt, reg).find({}, {"_id": 0, key: 1}).to_list(5000) if r.get(key)}
    for r in rows:
        r["_duplicate"] = bool(r.get(key) and r.get(key) in existing)
    return {"rows": rows, "match_key": key}


@router.post("/import/cross/run")
async def cross_run(body: dict = Body(...), user=Depends(current_user)):
    src, tgt, reg = body["source_cid"], body["target_cid"], body["register"]
    if not (has_company(user, src) and has_company(user, tgt)):
        raise HTTPException(403, "Need access to both companies")
    require(user, tgt, R[reg][0], "edit")
    strategy = body.get("duplicates", "skip")
    key = {"vendors": "gstin", "products": "code", "employees": "email", "subcontractors": "gstin"}.get(reg, "name")
    done = skipped = files = 0
    for rid in body.get("ids", []):
        r = await col(src, reg).find_one({"id": rid}, {"_id": 0})
        if not r:
            continue
        dup = await col(tgt, reg).find_one({key: r.get(key)}, {"_id": 0}) if r.get(key) else None
        if dup and strategy == "skip":
            skipped += 1; continue
        new = {k: v for k, v in r.items() if k not in ("id", "number", "created_at", "updated_at", "locked", "status")}
        new.update(cloned_from={"company_id": src, "id": rid})
        if body.get("include_files"):
            new_files = []
            for f in r.get("kyc_files") or []:
                try:
                    rec, data = await read_file(src, f["id"])
                    new_files.append(await save_file(tgt, rec["name"], data, user, {"tag": "cloned"}, rec.get("content_type")))
                    files += 1
                except Exception:
                    pass
            new["kyc_files"] = new_files
        else:
            new.pop("kyc_files", None)
        if dup and strategy == "overwrite":
            await update_record(tgt, reg, dup["id"], new, user, force=True)
        else:
            if dup and strategy == "rename":
                new[key] = f"{new.get(key)} (copy)"
            await create_record(tgt, reg, new, user, run_hooks=False)
        done += 1
    await audit(tgt, user, "cross_company_import", reg, "", note=f"from {src}: {done} cloned, {skipped} skipped, {files} files")
    await db.import_log.insert_one({"id": uid(), "source": src, "target": tgt, "register": reg, "cloned": done, "skipped": skipped, "files": files, "by": user["name"], "at": now()})
    return {"cloned": done, "skipped": skipped, "files": files}


@router.get("/import/cross/log")
async def cross_log(user=Depends(current_user)):
    return await db.import_log.find({}, {"_id": 0}).sort("at", -1).to_list(200)
