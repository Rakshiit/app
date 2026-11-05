from datetime import date, timedelta, datetime
from calendar import monthrange
from html import escape
from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import Response
from core import (db, col, uid, now, today, num, clean, audit, current_user, require, has_company, next_number,
                  send_email, email_shell, APP_URL, mask)
from registers import create_record, update_record
from pdfs import build_pdf, inr, ddmmyyyy, register_doc
import hooks

router = APIRouter(prefix="/api")


async def get_or_404(cid, reg, rid):
    r = await col(cid, reg).find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(404, f"{reg} record not found")
    return r


async def company_of(cid):
    return await db.companies.find_one({"id": cid}, {"_id": 0}) or {}


# ================= M1 TENDERS =================
@router.post("/c/{cid}/tenders/{tid}/gonogo")
async def gonogo_request(cid: str, tid: str, user=Depends(current_user)):
    require(user, cid, "M1", "edit")
    t = await get_or_404(cid, "tenders", tid)
    if await db.approvals.find_one({"company_id": cid, "entity": "tenders", "entity_id": tid, "status": "Pending"}):
        raise HTTPException(400, "Go/No-Go already pending")
    appr = {"id": uid(), "company_id": cid, "entity": "tenders", "entity_id": tid, "title": f"Go/No-Go: {t.get('tender_no')} {t.get('title', '')[:50]}",
            "amount": t.get("estimated_value"), "levels": [{"role": "Director", "status": "Pending", "by": None, "at": None, "remarks": ""}],
            "current": 0, "status": "Pending", "submitted_by": user["name"], "submitted_at": now(), "kind": "gonogo"}
    await db.approvals.insert_one(dict(appr))
    await update_record(cid, "tenders", tid, {"stage": "Go/No-Go Pending", "approval_id": appr["id"]}, user, force=True)
    return clean(appr)


@router.get("/c/{cid}/tenders/{tid}/feasibility")
async def feasibility(cid: str, tid: str, user=Depends(current_user)):
    require(user, cid, "M1", "view")
    t = await get_or_404(cid, "tenders", tid)
    comp = await company_of(cid)
    docs = await col(cid, "vault_docs").find({"superseded": {"$ne": True}}, {"_id": 0}).to_list(500)
    reqs = [r.strip() for r in str(t.get("required_documents") or "").replace("\n", ";").replace(",", ";").split(";") if r.strip()]
    out, td = [], today()
    for rq in reqs:
        words = [w for w in rq.lower().replace("/", " ").split() if len(w) > 2]
        best = None
        for d in docs:
            hay = f"{d.get('name', '')} {d.get('category', '')} {d.get('doc_type', '')}".lower()
            if words and sum(1 for w in words if w in hay) >= max(1, len(words) // 2):
                best = d; break
        status = "Missing"
        if best:
            status = "Expired" if best.get("expiry_date") and best["expiry_date"] < td else ("Available" if best.get("verified") else "Unverified")
        out.append({"requirement": rq, "status": status, "doc": {"id": best["id"], "name": best["name"], "expiry_date": best.get("expiry_date")} if best else None})
    turnover_req = num(t.get("min_turnover"))
    turnover = num(comp.get("avg_turnover"))
    score = round(sum(1 for o in out if o["status"] == "Available") * 100 / len(out)) if out else 100
    return {"checks": out, "turnover": {"required": turnover_req, "company": turnover, "pass": turnover >= turnover_req},
            "score": score, "feasible": score >= 80 and turnover >= turnover_req}


@router.post("/c/{cid}/tenders/{tid}/costings/new")
async def new_costing(cid: str, tid: str, body: dict = Body(default={}), user=Depends(current_user)):
    require(user, cid, "M1", "edit")
    t = await get_or_404(cid, "tenders", tid)
    existing = await col(cid, "costings").find({"tender_id": tid}, {"_id": 0}).sort("version", -1).to_list(50)
    ver = (existing[0]["version"] + 1) if existing else 1
    base = existing[0] if existing else None
    items = (base or {}).get("items") or [{"desc": b.get("desc"), "uom": b.get("uom"), "qty": b.get("qty"), "material": b.get("rate") or 0,
                                           "labour": 0, "subcontractor": 0, "equipment": 0, "overheads": 0, "margin_pct": 10} for b in t.get("boq") or []]
    d = {"tender_id": tid, "version": ver, "cost_type": body.get("cost_type") or (base or {}).get("cost_type", "EPC"), "items": items,
         "margin_pct": (base or {}).get("margin_pct", 10), "title": f"Costing v{ver} - {t.get('tender_no')}"}
    return await create_record(cid, "costings", d, user)


@router.post("/c/{cid}/tenders/{tid}/submit-bid")
async def submit_bid(cid: str, tid: str, body: dict = Body(default={}), user=Depends(current_user)):
    require(user, cid, "M1", "edit")
    t = await get_or_404(cid, "tenders", tid)
    if not t.get("costing_approved"):
        raise HTTPException(400, "Bid submission blocked: final costing has not been approved by management")
    if t.get("stage") in ("No-Go",):
        raise HTTPException(400, "Tender was marked No-Go")
    await update_record(cid, "tenders", tid, {"stage": "Submitted", "submitted_on": today(), "submission_ref": body.get("submission_ref")}, user, force=True)
    if num(t.get("emd")) and not await col(cid, "bgs").find_one({"tender_id": tid, "bg_type": "EMD"}):
        await create_record(cid, "bgs", {"bg_type": "EMD", "tender_id": tid, "bg_no": body.get("emd_ref") or f"EMD-{t.get('tender_no')}", "amount": t.get("emd"),
                                         "bank": body.get("emd_bank") or "", "issue_date": today(), "expiry_date": (date.today() + timedelta(days=180)).isoformat(),
                                         "beneficiary": t.get("department"), "status": "Active"}, user)
    return await get_or_404(cid, "tenders", tid)


@router.post("/c/{cid}/tenders/{tid}/lost")
async def tender_lost(cid: str, tid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M1", "edit")
    if not body.get("lost_reason"):
        raise HTTPException(400, "Reason is required")
    await update_record(cid, "tenders", tid, {"stage": "Lost", "lost_reason": body["lost_reason"], "competitor": body.get("competitor"),
                                              "l1_value": body.get("l1_value"), "l1_rates": body.get("l1_rates")}, user, force=True)
    await col(cid, "bgs").update_many({"tender_id": tid, "bg_type": "EMD"}, {"$set": {"status": "Refund Due"}})
    return await get_or_404(cid, "tenders", tid)


@router.post("/c/{cid}/tenders/{tid}/award")
async def tender_award(cid: str, tid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M2", "edit")
    t = await get_or_404(cid, "tenders", tid)
    if t.get("project_id"):
        raise HTTPException(400, "Tender already converted to a project")
    if not body.get("loa_no") or not num(body.get("wo_value")):
        raise HTTPException(400, "LOA/WO number and WO value are required")
    state = (body.get("state") or t.get("state") or "XX").upper()[:2]
    code = await next_number(cid, "project", state, body.get("loa_date"), "P")
    cost = await col(cid, "costings").find_one({"id": t.get("approved_costing_id")}, {"_id": 0}) or {}
    heads = cost.get("head_totals") or {}
    factor = num(body["wo_value"]) / num(cost.get("bid_value")) if num(cost.get("bid_value")) else 1
    budget = {h: {"budget": round(num(heads.get(h)) * min(factor, 1), 2), "actual": 0} for h in hooks.HEADS}
    proj = {"code": code, "name": t.get("title"), "tender_id": tid, "tender_no": t.get("tender_no"), "client": body.get("client") or t.get("department"),
            "client_gstin": body.get("client_gstin"), "state": state, "location": t.get("location"), "loa_no": body["loa_no"], "loa_date": body.get("loa_date") or today(),
            "contract_value": num(body["wo_value"]), "original_value": num(body["wo_value"]), "start_date": body.get("start_date") or today(),
            "end_date": body.get("end_date"), "retention_pct": num(body.get("retention_pct") or 5), "mob_advance": num(body.get("mob_advance")),
            "mob_recovery_pct": num(body.get("mob_recovery_pct") or (10 if num(body.get("mob_advance")) else 0)),
            "budget": budget, "baseline_budget": budget, "physical_pct": 0, "billed_value": 0, "status": "Active", "project_type": t.get("category") or "EPC"}
    p = await create_record(cid, "projects", proj, user)
    # WBS from costing
    if cost.get("items"):
        root = await create_record(cid, "wbs", {"project_id": p["id"], "level": 1, "code": "1", "name": "Main Works", "qty": 0, "rate": 0}, user)
        for i, it in enumerate(cost["items"], 1):
            q = num(it.get("qty")) or 1
            await create_record(cid, "wbs", {"project_id": p["id"], "parent_id": root["id"], "level": 2, "code": f"1.{i}", "name": it.get("desc"), "uom": it.get("uom"),
                                             "qty": q, "rate": round(num(it.get("sell")) * min(factor, 1) / q, 2), "done_qty": 0, "billed_qty": 0,
                                             "start_date": proj["start_date"], "end_date": proj["end_date"]}, user)
    for s in body.get("sites") or []:
        await create_record(cid, "sites", {"project_id": p["id"], "name": s, "state": state}, user)
    # EMD -> Performance BG
    emd = await col(cid, "bgs").find_one({"tender_id": tid, "bg_type": "EMD"}, {"_id": 0})
    if emd:
        await col(cid, "bgs").update_one({"id": emd["id"]}, {"$set": {"status": "Converted to PBG", "project_id": p["id"]}})
    await create_record(cid, "bgs", {"bg_type": "Performance", "project_id": p["id"], "tender_id": tid, "bg_no": body.get("pbg_no") or f"PBG-{code}",
                                     "amount": round(num(body["wo_value"]) * num(body.get("pbg_pct") or 5) / 100, 2), "bank": body.get("pbg_bank") or (emd or {}).get("bank", ""),
                                     "issue_date": today(), "expiry_date": body.get("pbg_expiry") or (date.today() + timedelta(days=730)).isoformat(),
                                     "converted_from": (emd or {}).get("id"), "beneficiary": proj["client"], "status": "Active"}, user)
    if num(body.get("mob_advance")):
        await create_record(cid, "mob_advances", {"project_id": p["id"], "amount": num(body["mob_advance"]), "recovered": 0, "recovery_pct": proj["mob_recovery_pct"],
                                                  "date": today(), "status": "Outstanding"}, user)
        await create_record(cid, "bgs", {"bg_type": "Mobilisation", "project_id": p["id"], "bg_no": f"MBG-{code}", "amount": num(body["mob_advance"]),
                                         "issue_date": today(), "expiry_date": (date.today() + timedelta(days=365)).isoformat(), "status": "Active"}, user)
    await update_record(cid, "tenders", tid, {"stage": "Won", "project_id": p["id"], "project_code": code}, user, force=True)
    return p


# ================= M2/M6/M9 PROJECT =================
def month_iter(start, end):
    d = date(start.year, start.month, 1)
    while d <= end:
        yield d
        d = date(d.year + (d.month // 12), d.month % 12 + 1, 1)


@router.get("/c/{cid}/projects/{pid}/overview")
async def project_overview(cid: str, pid: str, user=Depends(current_user)):
    require(user, cid, "M2", "view")
    p = await get_or_404(cid, "projects", pid)
    pct = await hooks.project_progress(cid, pid)
    wbs = await col(cid, "wbs").find({"project_id": pid}, {"_id": 0}).to_list(3000)
    leaves = [w for w in wbs if num(w.get("qty")) > 0]
    tw = sum(num(w.get("qty")) * num(w.get("rate")) or 1 for w in leaves) or 1
    budget = p.get("budget") or {}
    bt = sum(num(h.get("budget")) for h in budget.values())
    at = sum(num(h.get("actual")) for h in budget.values())
    # S-curve
    curve = []
    try:
        s = date.fromisoformat(p["start_date"][:10]); e = date.fromisoformat((p.get("end_date") or p["start_date"])[:10])
    except Exception:
        s = e = date.today()
    dprs = await col(cid, "dprs").find({"project_id": pid, "status": "Approved"}, {"_id": 0}).to_list(5000)
    wmap = {w["id"]: w for w in leaves}
    for m in month_iter(s, max(e, date.today())):
        me = date(m.year, m.month, monthrange(m.year, m.month)[1])
        planned = 0.0
        for w in leaves:
            ws = date.fromisoformat((w.get("start_date") or p["start_date"])[:10]); we = date.fromisoformat((w.get("end_date") or p.get("end_date") or p["start_date"])[:10])
            span = max((we - ws).days, 1)
            frac = min(max((me - ws).days / span, 0), 1)
            planned += (num(w["qty"]) * num(w.get("rate")) or 1) * frac
        actual = 0.0
        for d in dprs:
            if d.get("date", "")[:10] <= me.isoformat():
                for it in d.get("items") or []:
                    w = wmap.get(it.get("wbs_id"))
                    if w:
                        actual += num(it.get("qty")) * num(w.get("rate")) or 0
        curve.append({"month": m.strftime("%b-%y"), "planned": round(planned * 100 / tw, 1), "actual": round(actual * 100 / tw, 1) if m <= date.today() else None})
    sites = await col(cid, "sites").find({"project_id": pid}, {"_id": 0}).to_list(100)
    site_cmp = []
    for st in sites:
        sd = [d for d in dprs if d.get("site_id") == st["id"]]
        val = sum(num(it.get("qty")) * num(wmap.get(it.get("wbs_id"), {}).get("rate")) for d in sd for it in d.get("items") or [])
        last = await col(cid, "dprs").find_one({"site_id": st["id"]}, sort=[("date", -1)])
        site_cmp.append({"site": st["name"], "site_id": st["id"], "dpr_count": len(sd), "work_value": round(val, 2), "contribution_pct": round(val * 100 / tw, 2),
                         "last_dpr": (last or {}).get("date"), "missing": not last or last.get("date", "") < (date.today() - timedelta(days=1)).isoformat()})
    cv = num(p.get("contract_value")) or 1
    return {"project": mask(p, user["masked_fields"]), "physical_pct": pct, "billed_pct": round(num(p.get("billed_value")) * 100 / cv, 2),
            "cost_pct": round(at * 100 / bt, 2) if bt else 0, "budget_total": bt, "actual_total": at, "s_curve": curve, "sites": site_cmp,
            "projected_margin_pct": round((cv - at / max(pct / 100, 0.01)) * 100 / cv, 2) if pct else None,
            "counts": {k: await col(cid, k).count_documents({"project_id": pid}) for k in ("dprs", "ra_bills", "change_orders", "ncrs", "pos", "grns", "hindrances", "drawings", "rfis")},
            "pending_change_orders": await col(cid, "change_orders").count_documents({"project_id": pid, "status": {"$nin": ["Approved", "Rejected"]}})}


@router.get("/c/{cid}/reports/unbilled")
async def unbilled(cid: str, project_id: str = None, user=Depends(current_user)):
    require(user, cid, "M8", "view")
    f = {"project_id": project_id} if project_id else {}
    rows = []
    for w in await col(cid, "wbs").find({**f, "qty": {"$gt": 0}}, {"_id": 0}).to_list(5000):
        ub = num(w.get("done_qty")) - num(w.get("billed_qty"))
        if ub > 0:
            rows.append({"project_id": w["project_id"], "code": w.get("code"), "name": w.get("name"), "uom": w.get("uom"), "done_qty": w.get("done_qty"),
                         "billed_qty": w.get("billed_qty", 0), "unbilled_qty": ub, "rate": w.get("rate"), "unbilled_value": round(ub * num(w.get("rate")), 2)})
    return mask(rows, user["masked_fields"])


@router.get("/c/{cid}/stock/balance")
async def stock_bal(cid: str, location: str = None, user=Depends(current_user)):
    require(user, cid, "M5", "view")
    m = {"location": location} if location else {}
    agg = await col(cid, "stock_ledger").aggregate([{"$match": m}, {"$group": {"_id": {"p": "$product_id", "l": "$location"}, "name": {"$first": "$product_name"},
                                                                           "uom": {"$first": "$uom"}, "lname": {"$first": "$location_name"}, "i": {"$sum": "$qty_in"},
                                                                           "o": {"$sum": "$qty_out"}, "rate": {"$avg": "$rate"}}}]).to_list(5000)
    prods = {p["id"]: p for p in await col(cid, "products").find({}, {"_id": 0}).to_list(2000)}
    out = []
    for a in agg:
        bal = a["i"] - a["o"]
        rl = num(prods.get(a["_id"]["p"], {}).get("reorder_level"))
        out.append({"product_id": a["_id"]["p"], "product_name": a["name"], "uom": a["uom"], "location": a["_id"]["l"], "location_name": a["lname"],
                    "qty_in": a["i"], "qty_out": a["o"], "balance": bal, "value": round(bal * num(a["rate"]), 2),
                    "low": a["_id"]["l"] == "CENTRAL" and rl and bal <= rl})
    return out


# ================= CLOSURE (M11) =================
@router.get("/c/{cid}/projects/{pid}/closure")
async def closure_gate(cid: str, pid: str, user=Depends(current_user)):
    require(user, cid, "M11", "view")
    p = await get_or_404(cid, "projects", pid)
    c = lambda reg, f: col(cid, reg).count_documents({"project_id": pid, **f})  # noqa
    invs = await col(cid, "invoices").find({"project_id": pid}, {"_id": 0}).to_list(1000)
    outstanding = sum(num(i.get("net_receivable")) - num(i.get("received")) for i in invs)
    draft_ra = await c("ra_bills", {"status": {"$nin": ["Approved", "Rejected"]}})
    ret_open = await c("deductions", {"type": "Security Deposit / Retention", "status": {"$ne": "Released"}})
    mob = sum(num(m.get("amount")) - num(m.get("recovered")) for m in await col(cid, "mob_advances").find({"project_id": pid}, {"_id": 0}).to_list(50))
    stock = [s for s in await stock_bal(cid, None, user) if s["project_id"] == pid] if False else []
    site_ids = [s["id"] for s in await col(cid, "sites").find({"project_id": pid}, {"_id": 0, "id": 1}).to_list(100)]
    site_stock = 0
    for sid in site_ids:
        for b in await stock_bal(cid, sid, user):
            site_stock += max(b["balance"], 0)
    fi = await col(cid, "free_issue").find({"project_id": pid}, {"_id": 0}).to_list(500)
    fi_unrec = sum(1 for f in fi if abs(num(f.get("qty_received")) - num(f.get("qty_consumed")) - num(f.get("qty_returned"))) > 1e-6)
    wos = await col(cid, "work_orders").find({"project_id": pid}, {"_id": 0}).to_list(200)
    wo_open = sum(1 for w in wos if not w.get("final_bill_done") or not w.get("rating"))
    checks = [
        ("accounts", "Accounts: final bill, receivables & retention settled", draft_ra == 0 and outstanding <= 1 and ret_open == 0,
         f"{draft_ra} unapproved RA bills, receivable {inr(outstanding)}, {ret_open} retention entries unreleased", "ra_bills"),
        ("tally", "Tally 100% synced", await c("vouchers", {"status": {"$ne": "Synced"}}) == 0, f"{await c('vouchers', {'status': {'$ne': 'Synced'}})} vouchers not synced", "vouchers"),
        ("bg", "BG register: all BGs released", await c("bgs", {"status": {"$nin": ["Released", "Converted to PBG"]}}) == 0,
         f"{await c('bgs', {'status': {'$nin': ['Released', 'Converted to PBG']}})} BGs still active", "bgs"),
        ("mob", "Zero mobilisation advance outstanding", mob <= 1, f"Outstanding {inr(mob)}", "mob_advances"),
        ("co", "Zero pending change orders", await c("change_orders", {"status": {"$nin": ["Approved", "Rejected"]}}) == 0,
         f"{await c('change_orders', {'status': {'$nin': ['Approved', 'Rejected']}})} pending", "change_orders"),
        ("stock", "Zero site stock & free-issue reconciled", site_stock == 0 and fi_unrec == 0, f"Site stock qty {site_stock}, {fi_unrec} free-issue items unreconciled", "stock_ledger"),
        ("assets", "Equipment & vehicles released", await c("equipment", {"status": "Deployed"}) + await c("vehicles", {"status": "Deployed"}) == 0,
         f"{await c('equipment', {'status': 'Deployed'})} equipment, {await c('vehicles', {'status': 'Deployed'})} vehicles deployed", "equipment"),
        ("ncr", "Zero open safety/quality NCRs", await c("ncrs", {"status": {"$ne": "Closed"}}) == 0, f"{await c('ncrs', {'status': {'$ne': 'Closed'}})} open NCRs", "ncrs"),
        ("sub", "Subcontractor final bills & ratings done", wo_open == 0, f"{wo_open} work orders without final bill/rating", "work_orders"),
        ("insurance", "Insurance closed / transferred", await c("insurance", {"status": {"$nin": ["Closed", "Transferred"]}}) == 0,
         f"{await c('insurance', {'status': {'$nin': ['Closed', 'Transferred']}})} active policies", "insurance"),
        ("legal", "Legal & completion certificate uploaded", bool(p.get("completion_certificate")) and await c("disputes", {"status": {"$ne": "Closed"}}) == 0,
         ("Certificate uploaded" if p.get("completion_certificate") else "Completion certificate missing") + f", {await c('disputes', {'status': {'$ne': 'Closed'}})} open disputes", "projects"),
    ]
    rows = [{"key": k, "label": l, "pass": bool(ok), "detail": d, "register": r} for k, l, ok, d, r in checks]
    return {"project": {"id": p["id"], "code": p.get("code"), "status": p.get("status")}, "checks": rows, "passed": sum(r["pass"] for r in rows),
            "can_close": all(r["pass"] for r in rows)}


@router.post("/c/{cid}/projects/{pid}/close")
async def close_project(cid: str, pid: str, body: dict = Body(default={}), user=Depends(current_user)):
    if not (user["is_super"] or "Director" in user["acting_roles"]):
        raise HTTPException(403, "Management approval required to close a project")
    gate = await closure_gate(cid, pid, user)
    if not gate["can_close"]:
        raise HTTPException(400, "Closure blocked: " + "; ".join(r["label"] for r in gate["checks"] if not r["pass"]))
    p = await get_or_404(cid, "projects", pid)
    at = sum(num(h.get("actual")) for h in (p.get("budget") or {}).values())
    margin = round((num(p.get("billed_value")) - at) * 100 / num(p.get("billed_value")), 2) if num(p.get("billed_value")) else 0
    await update_record(cid, "projects", pid, {"status": "Closed", "frozen_margin_pct": margin, "frozen_cost": at, "closed_on": today(),
                                               "closed_by": user["name"], "locked": True, "archived": True, "closure_remarks": body.get("remarks")}, user, force=True)
    return await get_or_404(cid, "projects", pid)


# ================= M3 ATTENDANCE & PAYROLL =================
@router.post("/c/{cid}/attendance/lock")
async def lock_attendance(cid: str, body: dict = Body(...), user=Depends(current_user)):
    if not (user["is_super"] or "Project Manager" in user["acting_roles"] or "HR Manager" in user["acting_roles"]):
        raise HTTPException(403, "Only PM/HR can lock attendance")
    key = {"project_id": body.get("project_id") or "OFFICE", "month": body["month"]}
    await col(cid, "attendance_locks").update_one(key, {"$set": {**key, "locked_by": user["name"], "at": now()}}, upsert=True)
    await col(cid, "attendance").update_many({"project_id": body.get("project_id"), "date": {"$regex": f"^{body['month']}"}}, {"$set": {"locked": True}})
    await audit(cid, user, "attendance_lock", "attendance", f"{key['project_id']}:{key['month']}")
    return {"ok": True}


@router.get("/c/{cid}/attendance/locks")
async def att_locks(cid: str, user=Depends(current_user)):
    return await col(cid, "attendance_locks").find({}, {"_id": 0}).to_list(500)


PT_STATES = {"MH": 200, "KA": 200, "WB": 150, "TN": 208, "GJ": 200, "AP": 200, "TG": 200, "MP": 208, "OR": 200, "AS": 208}


@router.post("/c/{cid}/payroll/run")
async def payroll_run(cid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M3", "edit")
    month = body["month"]
    if await col(cid, "payroll_runs").find_one({"month": month, "status": {"$ne": "Rejected"}}):
        raise HTTPException(400, f"Payroll for {month} already exists")
    att = await col(cid, "attendance").find({"date": {"$regex": f"^{month}"}}, {"_id": 0}).to_list(20000)
    locks = {(l["project_id"], l["month"]) for l in await col(cid, "attendance_locks").find({"month": month}, {"_id": 0}).to_list(500)}
    unlocked = {a.get("project_id") or "OFFICE" for a in att} - {p for p, _ in locks}
    if unlocked:
        names = []
        for pid in unlocked:
            pr = await col(cid, "projects").find_one({"id": pid}, {"_id": 0, "code": 1})
            names.append((pr or {}).get("code", pid))
        raise HTTPException(400, f"Attendance not locked by PM for: {', '.join(names)}")
    mw = {(m.get("state"), m.get("skill")): num(m.get("daily_rate")) for m in await col(cid, "min_wages").find({}, {"_id": 0}).to_list(500)}
    emps = await col(cid, "employees").find({"status": {"$ne": "Exited"}}, {"_id": 0}).to_list(5000)
    run = await create_record(cid, "payroll_runs", {"month": month, "date": f"{month}-28", "title": f"Payroll {month}"}, user)
    tg = tn = 0
    flags = []
    for e in emps:
        rows = [a for a in att if a.get("employee_id") == e["id"]]
        present = sum(1 if a.get("status") == "P" else 0.5 if a.get("status") == "HD" else 0 for a in rows)
        if e.get("emp_type") == "Labour":
            rate = num(e.get("daily_wage")); gross = rate * present; basic = gross * 0.6
        else:
            rate = num(e.get("salary")) / 26; gross = min(rate * present, num(e.get("salary"))); basic = num(e.get("basic") or num(e.get("salary")) * 0.5) * min(present / 26, 1)
        minw = mw.get((e.get("state"), e.get("skill") or "Unskilled"))
        mw_ok = not minw or rate >= minw
        if not mw_ok:
            flags.append(f"{e['name']}: daily rate {rate:.0f} below {e.get('state')} minimum {minw:.0f}")
        epf = round(min(basic, 15000) * 0.12, 0)
        esic = round(gross * 0.0075, 0) if gross <= 21000 else 0
        pt = PT_STATES.get(e.get("state"), 0) if gross > 15000 else 0
        adv = num(e.get("advance_recovery"))
        net = gross - epf - esic - pt - adv
        split = e.get("project_split") or ([{"project_id": e.get("project_id"), "pct": 100}] if e.get("project_id") else [])
        await col(cid, "payslips").insert_one({"id": uid(), "payroll_run_id": run["id"], "month": month, "employee_id": e["id"], "employee_name": e["name"],
                                               "emp_code": e.get("number"), "emp_type": e.get("emp_type"), "designation": e.get("designation"), "present_days": present,
                                               "gross": round(gross, 0), "basic": round(basic, 0), "epf": epf, "esic": esic, "pt": pt, "advance_recovery": adv,
                                               "net_pay": round(net, 0), "min_wage_ok": mw_ok, "project_split": split, "project_id": e.get("project_id"),
                                               "status": "Draft", "created_at": now()})
        tg += gross; tn += net
    await col(cid, "payroll_runs").update_one({"id": run["id"]}, {"$set": {"total_gross": round(tg, 0), "total_net": round(tn, 0), "employees": len(emps), "min_wage_flags": flags}})
    return await get_or_404(cid, "payroll_runs", run["id"])


# ================= M4 PROCUREMENT & VENDOR LINKS =================
LINK_DAYS = {"rfq": 10, "onboarding": 15, "po_ack": 7, "bill": 30}


async def make_link(cid, ltype, ref_id, vendor_id, user):
    token = uid() + uid()
    rec = {"token": token, "company_id": cid, "type": ltype, "ref_id": ref_id, "vendor_id": vendor_id, "status": "Open",
           "expires_at": (datetime.utcnow() + timedelta(days=LINK_DAYS.get(ltype, 10))).isoformat(), "created_by": (user or {}).get("name"), "created_at": now()}
    await db.vendor_links.insert_one(dict(rec))
    return {**{k: v for k, v in rec.items() if k != "_id"}, "url": f"{APP_URL}/v/{token}"}


def items_table(items, with_rate=False):
    h = "".join(f'<th style="border:1px solid #cbd3e1;padding:6px;background:#eef1f6;text-align:left">{x}</th>' for x in (["#", "Item", "UOM", "Qty"] + (["Rate"] if with_rate else [])))
    rows = ""
    for i, it in enumerate(items, 1):
        cells = [str(i), escape(str(it.get("desc") or it.get("name") or "")), escape(str(it.get("uom") or "")), escape(str(it.get("qty") or ""))]
        if with_rate:
            cells.append(inr(it.get("rate")))
        rows += "<tr>" + "".join(f'<td style="border:1px solid #cbd3e1;padding:6px">{c}</td>' for c in cells) + "</tr>"
    return f'<table role="presentation" style="border-collapse:collapse;width:100%;font-size:13px"><tr>{h}</tr>{rows}</table>'


@router.post("/c/{cid}/vendor-links")
async def create_vendor_link(cid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M4", "edit")
    link = await make_link(cid, body["type"], body.get("ref_id"), body.get("vendor_id"), user)
    if body.get("send_email") and body.get("email"):
        comp = await company_of(cid)
        title = {"onboarding": "Vendor registration request", "bill": "Bill submission link"}.get(body["type"], "Action requested")
        html = email_shell(comp, title, f'<p>Dear Partner,</p><p>Please use the secure link below. It is single-purpose and expires on {ddmmyyyy(link["expires_at"])}.</p>'
                                        f'<p><a href="{link["url"]}" style="background:#0b1220;color:#fff;padding:10px 16px;text-decoration:none">Open secure form</a></p>')
        link["email"] = await send_email(cid, to=body["email"], subject=f"{comp.get('name')} - {title}", html=html, entity="vendor_links", vendor_id=body.get("vendor_id"), user=user)
    return link


@router.get("/c/{cid}/vendor-links")
async def list_links(cid: str, ref_id: str = None, user=Depends(current_user)):
    f = {"company_id": cid}
    if ref_id:
        f["ref_id"] = ref_id
    rows = await db.vendor_links.find(f, {"_id": 0}).sort("created_at", -1).to_list(500)
    for r in rows:
        r["url"] = f"{APP_URL}/v/{r['token']}"
    return rows


@router.post("/c/{cid}/rfqs/{rid}/send")
async def send_rfq(cid: str, rid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M4", "edit")
    rfq = await get_or_404(cid, "rfqs", rid)
    comp = await company_of(cid)
    out = []
    for vid in body.get("vendor_ids") or []:
        v = await get_or_404(cid, "vendors", vid)
        link = await make_link(cid, "rfq", rid, vid, user)
        res = {"vendor_id": vid, "vendor_name": v.get("name"), "url": link["url"], "token": link["token"], "email_status": None}
        if body.get("send_email", True) and v.get("email"):
            pdf_url = f"{APP_URL}/api/public/v/{link['token']}/pdf"
            html = email_shell(comp, f"Request for Quotation {rfq.get('number')}",
                               f"<p>Dear {escape(v.get('name', ''))},</p><p>We invite your best quotation for the following items"
                               f"{(' for ' + escape(rfq.get('title'))) if rfq.get('title') else ''}. Please quote by <b>{ddmmyyyy(rfq.get('due_date'))}</b>.</p>"
                               f"{items_table(rfq.get('items') or [])}<p>Delivery location: {escape(str(rfq.get('delivery_location') or '-'))}</p>"
                               f'<p><a href="{link["url"]}" style="background:#0b1220;color:#fff;padding:10px 16px;text-decoration:none">Enter prices online</a>&nbsp;&nbsp;'
                               f'<a href="{pdf_url}">Download RFQ PDF</a></p><p>You may also reply to this email with your quotation.</p>')
            em = await send_email(cid, to=v["email"], subject=f"RFQ {rfq.get('number')} - {comp.get('name')}", html=html, entity="rfqs", entity_id=rid, vendor_id=vid, user=user)
            res["email_status"] = em["status"]; res["email_error"] = em.get("error")
        out.append(res)
    sent = list({*(rfq.get("vendor_ids") or []), *(body.get("vendor_ids") or [])})
    await col(cid, "rfqs").update_one({"id": rid}, {"$set": {"vendor_ids": sent, "status": "Sent", "sent_at": now()}})
    return out


@router.get("/c/{cid}/rfqs/{rid}/compare")
async def compare(cid: str, rid: str, user=Depends(current_user)):
    require(user, cid, "M4", "view")
    rfq = await get_or_404(cid, "rfqs", rid)
    quotes = await col(cid, "quotes").find({"rfq_id": rid, "status": {"$ne": "Rejected"}}, {"_id": 0}).sort("revision", 1).to_list(200)
    latest = {}
    for q in quotes:
        latest[q["vendor_id"]] = q
    # historical benchmark
    bench = {}
    for it in rfq.get("items") or []:
        key = it.get("product_id") or it.get("desc")
        rates = []
        async for q in col(cid, "quotes").find({"rfq_id": {"$ne": rid}, "status": "Confirmed"}, {"_id": 0, "items": 1}):
            rates += [num(x.get("rate")) for x in q.get("items") or [] if (x.get("product_id") or x.get("desc")) == key and num(x.get("rate"))]
        prod = await col(cid, "products").find_one({"id": it.get("product_id")}, {"_id": 0}) if it.get("product_id") else None
        bench[key] = {"avg": round(sum(rates) / len(rates), 2) if rates else None, "last_po": (prod or {}).get("last_po_rate")}
    matrix = []
    for i, it in enumerate(rfq.get("items") or []):
        key = it.get("product_id") or it.get("desc")
        row = {"desc": it.get("desc"), "uom": it.get("uom"), "qty": it.get("qty"), "benchmark": bench.get(key), "vendors": {}}
        best = None
        for vid, q in latest.items():
            qi = next((x for x in q.get("items") or [] if (x.get("product_id") or x.get("desc")) == key), (q.get("items") or [None] * (i + 1))[i] if len(q.get("items") or []) > i else None)
            if qi:
                landed = num(qi.get("rate")) * num(it.get("qty")) * (1 + num(qi.get("gst_pct", 18)) / 100)
                row["vendors"][vid] = {"rate": qi.get("rate"), "gst_pct": qi.get("gst_pct", 18), "landed": round(landed, 2)}
                if best is None or landed < row["vendors"][best]["landed"]:
                    best = vid
        row["l1"] = best
        matrix.append(row)
    vendors = [{"vendor_id": vid, "vendor_name": q.get("vendor_name"), "revision": q.get("revision", 1), "freight": q.get("freight"), "payment_terms": q.get("payment_terms"),
                "delivery_period": q.get("delivery_period"), "landed_total": round(sum(r["vendors"].get(vid, {}).get("landed", 0) for r in matrix) + num(q.get("freight")), 2),
                "quote_id": q["id"], "revisions": [x.get("revision", 1) for x in quotes if x["vendor_id"] == vid]} for vid, q in latest.items()]
    vendors.sort(key=lambda v: v["landed_total"])
    return mask({"rfq": rfq, "matrix": matrix, "vendors": vendors}, user["masked_fields"])


@router.post("/c/{cid}/rfqs/{rid}/create-po")
async def create_po(cid: str, rid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M4", "edit")
    rfq = await get_or_404(cid, "rfqs", rid)
    q = await get_or_404(cid, "quotes", body["quote_id"])
    items = []
    for i, it in enumerate(rfq.get("items") or []):
        qi = (q.get("items") or [])[i] if i < len(q.get("items") or []) else {}
        items.append({"product_id": it.get("product_id"), "desc": it.get("desc"), "uom": it.get("uom"), "qty": it.get("qty"), "rate": num(qi.get("rate")), "gst_pct": num(qi.get("gst_pct", 18)), "received_qty": 0})
    po = await create_record(cid, "pos", {"vendor_id": q["vendor_id"], "vendor_name": q.get("vendor_name"), "rfq_id": rid, "quote_id": q["id"], "project_id": rfq.get("project_id"),
                                          "site_id": rfq.get("site_id"), "date": today(), "items": items, "freight": q.get("freight"), "payment_terms": q.get("payment_terms"),
                                          "delivery_date": body.get("delivery_date"), "delivery_status": "Pending", "ack_status": "Not Sent"}, user)
    await col(cid, "rfqs").update_one({"id": rid}, {"$set": {"status": "PO Created", "po_id": po["id"]}})
    for it in items:
        if it.get("product_id"):
            await col(cid, "products").update_one({"id": it["product_id"]}, {"$set": {"last_po_rate": it["rate"]}})
    return po


@router.post("/c/{cid}/pos/{pid}/send")
async def send_po(cid: str, pid: str, body: dict = Body(default={}), user=Depends(current_user)):
    require(user, cid, "M4", "edit")
    po = await get_or_404(cid, "pos", pid)
    if po.get("status") != "Approved":
        raise HTTPException(400, "PO must be approved before sending")
    v = await get_or_404(cid, "vendors", po["vendor_id"])
    comp = await company_of(cid)
    link = await make_link(cid, "po_ack", pid, v["id"], user)
    res = {"url": link["url"], "email_status": None}
    if body.get("send_email", True) and v.get("email"):
        kind = body.get("kind", "po")
        title = f"Purchase Order {po.get('number')}" if kind == "po" else f"Delivery reminder: PO {po.get('number')}"
        html = email_shell(comp, title, f"<p>Dear {escape(v.get('name', ''))},</p><p>{'Please find our purchase order below.' if kind == 'po' else 'This is a reminder for pending delivery against the PO below.'} "
                                        f"Delivery by <b>{ddmmyyyy(po.get('delivery_date'))}</b>. Total: <b>{inr(po.get('total'))}</b></p>{items_table(po.get('items') or [], True)}"
                                        f'<p><a href="{link["url"]}" style="background:#0b1220;color:#fff;padding:10px 16px;text-decoration:none">Acknowledge PO</a>&nbsp;&nbsp;'
                                        f'<a href="{APP_URL}/api/public/v/{link["token"]}/pdf">Download PO PDF</a></p>')
        em = await send_email(cid, to=v["email"], subject=f"{title} - {comp.get('name')}", html=html, entity="pos", entity_id=pid, vendor_id=v["id"], user=user)
        res["email_status"] = em["status"]; res["email_error"] = em.get("error")
    await col(cid, "pos").update_one({"id": pid}, {"$set": {"ack_status": "Awaiting Ack", "sent_at": now()}})
    return res


@router.get("/c/{cid}/staging")
async def staging(cid: str, user=Depends(current_user)):
    require(user, cid, "M4", "view")
    return await col(cid, "staging").find({}, {"_id": 0}).sort("at", -1).to_list(500)


@router.post("/c/{cid}/staging/{sid}/{action}")
async def staging_act(cid: str, sid: str, action: str, user=Depends(current_user)):
    require(user, cid, "M4", "edit")
    s = await get_or_404(cid, "staging", sid)
    if s["status"] != "Pending Review":
        raise HTTPException(400, "Already processed")
    result = None
    if action == "confirm":
        p = s["payload"]
        if s["type"] == "rfq":
            v = await col(cid, "vendors").find_one({"id": s["vendor_id"]}, {"_id": 0}) or {}
            prev = await col(cid, "quotes").count_documents({"rfq_id": s["ref_id"], "vendor_id": s["vendor_id"]})
            result = await create_record(cid, "quotes", {**p, "rfq_id": s["ref_id"], "vendor_id": s["vendor_id"], "vendor_name": v.get("name"), "revision": prev + 1,
                                                         "status": "Confirmed", "source": "Vendor link"}, user)
        elif s["type"] == "onboarding":
            result = await create_record(cid, "vendors", {**p, "status": "Active", "source": "Self-onboarding"}, user)
        elif s["type"] == "po_ack":
            await col(cid, "pos").update_one({"id": s["ref_id"]}, {"$set": {"ack_status": "Acknowledged", "vendor_ack": p}})
        elif s["type"] == "bill":
            po = await col(cid, "pos").find_one({"id": s["ref_id"]}, {"_id": 0}) or {}
            await hooks.add_voucher(cid, "Purchase", num(p.get("amount")), "pos", s["ref_id"], p.get("bill_no"), po.get("project_id"), po.get("vendor_name"), "Vendor bill via link")
            await col(cid, "pos").update_one({"id": s["ref_id"]}, {"$push": {"vendor_bills": p}})
    await col(cid, "staging").update_one({"id": sid}, {"$set": {"status": "Confirmed" if action == "confirm" else "Rejected", "reviewed_by": user["name"], "reviewed_at": now()}})
    await audit(cid, user, f"staging_{action}", "staging", sid)
    return {"ok": True, "result": result}


# ----- public vendor link endpoints (no login) -----
async def link_ctx(token):
    l = await db.vendor_links.find_one({"token": token}, {"_id": 0})
    if not l:
        raise HTTPException(404, "Invalid link")
    comp = await company_of(l["company_id"])
    expired = l["expires_at"] < datetime.utcnow().isoformat()
    return l, comp, expired


@router.get("/public/v/{token}")
async def public_link(token: str):
    l, comp, expired = await link_ctx(token)
    cid = l["company_id"]
    ctx = {"type": l["type"], "status": l["status"], "expired": expired, "expires_at": l["expires_at"],
           "company": {"name": comp.get("name"), "theme": comp.get("theme"), "logo_file_id": comp.get("logo_file_id")}}
    if l.get("vendor_id"):
        v = await col(cid, "vendors").find_one({"id": l["vendor_id"]}, {"_id": 0, "name": 1})
        ctx["vendor"] = v
    if l["type"] == "rfq":
        r = await col(cid, "rfqs").find_one({"id": l["ref_id"]}, {"_id": 0})
        ctx["ref"] = {"number": r.get("number"), "title": r.get("title"), "due_date": r.get("due_date"), "items": [{k: i.get(k) for k in ("desc", "uom", "qty", "product_id")} for i in r.get("items") or []],
                      "delivery_location": r.get("delivery_location"), "terms": r.get("terms")}
    elif l["type"] in ("po_ack", "bill"):
        po = await col(cid, "pos").find_one({"id": l["ref_id"]}, {"_id": 0})
        ctx["ref"] = {"number": po.get("number"), "total": po.get("total"), "delivery_date": po.get("delivery_date"), "items": po.get("items")}
    return ctx


@router.post("/public/v/{token}")
async def public_submit(token: str, body: dict = Body(...)):
    l, comp, expired = await link_ctx(token)
    if expired:
        raise HTTPException(410, "This link has expired. Please contact the buyer for a new link.")
    if l["status"] != "Open":
        raise HTTPException(409, "This link has already been used.")
    cid = l["company_id"]
    payload = {k: v for k, v in body.items() if k not in ("_id", "id", "status")}
    await col(cid, "staging").insert_one({"id": uid(), "type": l["type"], "ref_id": l.get("ref_id"), "vendor_id": l.get("vendor_id"), "payload": payload,
                                          "status": "Pending Review", "at": now(), "token": token})
    await db.vendor_links.update_one({"token": token}, {"$set": {"status": "Submitted", "submitted_at": now()}})
    return {"ok": True, "message": "Thank you. Your submission has been received and is pending review by the buyer."}


@router.get("/public/v/{token}/pdf")
async def public_pdf(token: str):
    l, comp, expired = await link_ctx(token)
    if expired:
        raise HTTPException(410, "Link expired")
    reg = "rfqs" if l["type"] == "rfq" else "pos"
    return await render_pdf(l["company_id"], reg, l["ref_id"])


@router.get("/public/verify/{code}")
async def verify_doc(code: str):
    d = await db.doc_verifications.find_one({"code": code.upper()}, {"_id": 0})
    if not d:
        raise HTTPException(404, "No document found for this verification code")
    return d


# ================= M14 PDF =================
PDF_TITLES = {"rfqs": "REQUEST FOR QUOTATION", "pos": "PURCHASE ORDER", "work_orders": "WORK ORDER", "ra_bills": "RUNNING ACCOUNT BILL",
              "invoices": "TAX INVOICE", "payslips": "PAYSLIP", "hr_letters": "LETTER", "sub_bills": "SUBCONTRACTOR BILL", "grns": "GOODS RECEIPT NOTE",
              "change_orders": "CHANGE ORDER", "costings": "COSTING SHEET", "dprs": "DAILY PROGRESS REPORT"}


async def ra_sections(cid, r):
    rows = [[l.get("description"), l.get("uom"), l.get("wo_qty"), l.get("previous_qty"), l.get("current_qty"), l.get("cumulative_qty"), inr(l.get("rate")), inr(l.get("amount"))] for l in r.get("lines") or []]
    tot = [("Gross (current)", inr(r.get("gross"))), ("Escalation", inr(r.get("escalation"))), ("GST", inr(r.get("gst"))), ("Invoice total", inr(r.get("invoice_total"))),
           ("Retention", inr(r.get("retention_amt"))), ("Mob. advance recovery", inr(r.get("mob_recovery_amt"))), ("TDS", inr(r.get("tds_amt"))),
           ("GST TDS", inr(r.get("gst_tds_amt"))), ("Labour cess", inr(r.get("labour_cess_amt"))), ("Net payable", inr(r.get("net_payable")))]
    return [("table", ["Item", "UOM", "WO Qty", "Prev", "Current", "Cumulative", "Rate", "Amount"], rows), ("totals", tot)]


async def render_pdf(cid, reg, rid, extra_sections=None, title_override=None):
    comp = await company_of(cid)
    r = await get_or_404(cid, reg, rid)
    proj = await col(cid, "projects").find_one({"id": r.get("project_id")}, {"_id": 0}) if r.get("project_id") else None
    number = r.get("number") or r.get("id")
    draft = r.get("status") not in ("Approved", "Issued", "Certified", "Paid", "Active", "Sent") and reg not in ("rfqs", "payslips", "hr_letters", "grns")
    meta = [("Number", number), ("Date", ddmmyyyy(r.get("date") or r.get("bill_date") or r.get("created_at"))), ("Status", r.get("status"))]
    if proj:
        meta += [("Project", f"{proj.get('code')} - {proj.get('name')}"), ("Client", proj.get("client"))]
    secs = []
    if reg in ("rfqs", "pos", "work_orders", "invoices", "grns", "requisitions"):
        party = r.get("vendor_name") or r.get("subcontractor_name") or r.get("client")
        if party:
            meta.append(("Party", party))
        meta += [("Delivery / Due", ddmmyyyy(r.get("delivery_date") or r.get("due_date"))), ("Terms", r.get("payment_terms") or r.get("terms"))]
        show_rate = reg != "rfqs"
        rows = [[i, it.get("desc"), it.get("uom"), it.get("qty_received", it.get("qty")), *( [inr(it.get("rate")), inr(num(it.get("qty")) * num(it.get("rate")))] if show_rate else [""])] for i, it in enumerate(r.get("items") or [], 1)]
        secs.append(("table", ["#", "Description", "UOM", "Qty"] + (["Rate", "Amount"] if show_rate else ["Your Rate (Rs)"]), rows))
        if show_rate:
            secs.append(("totals", [("Subtotal", inr(r.get("subtotal") or r.get("taxable"))), ("GST", inr(r.get("gst_amount"))), ("Freight", inr(r.get("freight"))), ("Total", inr(r.get("total")))]))
    elif reg == "ra_bills":
        secs += await ra_sections(cid, r)
    elif reg == "payslips":
        meta += [("Employee", r.get("employee_name")), ("Month", r.get("month")), ("Present days", r.get("present_days"))]
        secs.append(("totals", [("Gross", inr(r.get("gross"))), ("Basic", inr(r.get("basic"))), ("EPF", inr(r.get("epf"))), ("ESIC", inr(r.get("esic"))),
                                ("Professional Tax", inr(r.get("pt"))), ("Advance recovery", inr(r.get("advance_recovery"))), ("Net Pay", inr(r.get("net_pay")))]))
    elif reg == "hr_letters":
        meta += [("To", r.get("employee_name")), ("Subject", r.get("subject"))]
        secs.append(("para", (r.get("body") or "").replace("\n", "<br/>")))
    elif reg == "sub_bills":
        secs.append(("table", ["Description", "Qty", "Rate", "Amount"], [[i.get("desc"), i.get("qty"), inr(i.get("rate")), inr(num(i.get("qty")) * num(i.get("rate")))] for i in r.get("items") or []]))
        secs.append(("totals", [("Gross", inr(r.get("gross"))), ("Retention", inr(r.get("retention_amt"))), ("Advance recovery", inr(r.get("advance_recovery"))), ("Net", inr(r.get("net_amount")))]))
    else:
        secs.append(("table", ["Field", "Value"], [[k, str(v)[:200]] for k, v in r.items() if not isinstance(v, (list, dict)) and k not in ("id", "created_by")]))
    secs += extra_sections or []
    code = await register_doc(comp, reg, number)
    pdf = build_pdf(comp, title_override or PDF_TITLES.get(reg, reg.upper()), number, meta, secs, draft=draft, verify_code=code)
    return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{number}.pdf"'})


@router.get("/c/{cid}/pdf/{reg}/{rid}")
async def pdf(cid: str, reg: str, rid: str, user=Depends(current_user)):
    if not has_company(user, cid):
        raise HTTPException(403, "No access")
    return await render_pdf(cid, reg, rid)


@router.get("/c/{cid}/ra_bills/{rid}/pack")
async def ra_pack(cid: str, rid: str, user=Depends(current_user)):
    require(user, cid, "M8", "view")
    r = await get_or_404(cid, "ra_bills", rid)
    pid = r["project_id"]
    proj = await get_or_404(cid, "projects", pid)
    comp = await company_of(cid)
    dprs = await col(cid, "dprs").find({"project_id": pid, "status": "Approved"}, {"_id": 0}).to_list(500)
    grns = await col(cid, "grns").find({"project_id": pid}, {"_id": 0}).to_list(500)
    certs = await col(cid, "documents").find({"project_id": pid}, {"_id": 0}).to_list(200)
    index = [["1", "Cover letter"], ["2", "RA Bill & Abstract"], ["3", "Measurement sheet (from approved DPRs)"], ["4", "Site photographs register"], ["5", "GRN / material register"], ["6", "Certificates & supporting documents"]]
    secs = [("heading", "INDEX"), ("table", ["S.No", "Section"], index), ("break",),
            ("heading", "1. COVER LETTER"),
            ("para", f"To,<br/>{proj.get('client')}<br/><br/>Subject: Submission of {r.get('title') or 'RA Bill'} against LOA/WO {proj.get('loa_no')} for {proj.get('name')}.<br/><br/>"
                     f"Dear Sir/Madam,<br/>We hereby submit our Running Account Bill No. {r.get('number')} for the work executed up to {ddmmyyyy(r.get('bill_date'))}, "
                     f"amounting to {inr(r.get('invoice_total'))} (incl. GST). Measurement sheets, photographs, material receipts and certificates are enclosed for your kind certification.<br/><br/>Thanking you,"),
            ("break",), ("heading", "2. RA BILL & ABSTRACT")] + await ra_sections(cid, r) + [
            ("break",), ("heading", "3. MEASUREMENT SHEET"),
            ("table", ["DPR", "Date", "WBS item", "Qty"], [[d.get("number"), ddmmyyyy(d.get("date")), it.get("wbs_name") or it.get("wbs_id"), it.get("qty")] for d in dprs for it in d.get("items") or []]),
            ("heading", "4. SITE PHOTOGRAPHS"),
            ("table", ["DPR", "Date", "Photo file", "Stamp"], [[d.get("number"), ddmmyyyy(d.get("date")), p.get("name"), p.get("stamp", "")] for d in dprs for p in d.get("photos") or []] or [["-", "-", "No photos", ""]]),
            ("heading", "5. GRN / MATERIAL REGISTER"),
            ("table", ["GRN", "Date", "Vendor", "Items"], [[g.get("number"), ddmmyyyy(g.get("date")), g.get("vendor_name"), ", ".join(f"{i.get('desc')} x {i.get('qty_received', i.get('qty'))}" for i in g.get("items") or [])] for g in grns] or [["-", "-", "-", "-"]]),
            ("heading", "6. CERTIFICATES"),
            ("table", ["Document", "Category", "Version"], [[c.get("title") or c.get("name"), c.get("category"), c.get("version")] for c in certs] or [["-", "-", "-"]])]
    code = await register_doc(comp, "ra_pack", r.get("number"))
    pdfb = build_pdf(comp, "RA BILL SUBMISSION PACK", r.get("number"), [("Project", f"{proj.get('code')} - {proj.get('name')}"), ("Client", proj.get("client")),
                                                                         ("RA Bill", r.get("number")), ("Bill date", ddmmyyyy(r.get("bill_date")))],
                     secs, draft=r.get("status") != "Approved", verify_code=code)
    return Response(content=pdfb, media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{r.get("number")}_pack.pdf"'})


# ================= M7 rating, M10 incident claim =================
@router.get("/c/{cid}/subcontractors/{sid}/rating")
async def sub_rating(cid: str, sid: str, user=Depends(current_user)):
    s = await get_or_404(cid, "subcontractors", sid)
    wos = await col(cid, "work_orders").find({"subcontractor_id": sid}, {"_id": 0}).to_list(200)
    ratings = [num(w.get("rating")) for w in wos if num(w.get("rating"))]
    ncr = await col(cid, "ncrs").count_documents({"subcontractor_id": sid})
    open_ncr = await col(cid, "ncrs").count_documents({"subcontractor_id": sid, "status": {"$ne": "Closed"}})
    base = sum(ratings) / len(ratings) if ratings else 4
    score = max(1, round(base - 0.3 * ncr - 0.5 * open_ncr, 1))
    await col(cid, "subcontractors").update_one({"id": sid}, {"$set": {"performance_score": score}})
    return {"subcontractor": s.get("name"), "avg_wo_rating": round(base, 1), "ncr_total": ncr, "ncr_open": open_ncr, "score": score}


@router.post("/c/{cid}/incidents/{iid}/insurance-claim")
async def incident_claim(cid: str, iid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M10", "edit")
    inc = await get_or_404(cid, "incidents", iid)
    claim = {"id": uid(), "incident_id": iid, "incident_no": inc.get("number"), "amount": num(body.get("amount")), "status": "Claim Filed", "date": today()}
    await col(cid, "insurance").update_one({"id": body["insurance_id"]}, {"$push": {"claims": claim}})
    await col(cid, "incidents").update_one({"id": iid}, {"$set": {"claim_status": "Claim Filed", "insurance_id": body["insurance_id"]}})
    return claim


# ================= CLIENT PORTAL =================
@router.get("/portal/projects")
async def portal_projects(user=Depends(current_user)):
    out = []
    for cp in user.get("client_projects") or []:
        p = await col(cp["company_id"], "projects").find_one({"id": cp["project_id"]}, {"_id": 0})
        comp = await company_of(cp["company_id"])
        if p:
            out.append({"company_id": cp["company_id"], "company_name": comp.get("name"), "theme": comp.get("theme"), "id": p["id"], "code": p.get("code"), "name": p.get("name"),
                        "physical_pct": p.get("physical_pct"), "contract_value": p.get("contract_value"), "status": p.get("status"), "end_date": p.get("end_date")})
    return out


@router.get("/portal/{cid}/projects/{pid}")
async def portal_project(cid: str, pid: str, user=Depends(current_user)):
    if not any(cp["company_id"] == cid and cp["project_id"] == pid for cp in user.get("client_projects") or []) and not user["is_super"]:
        raise HTTPException(403, "Not your project")
    p = await get_or_404(cid, "projects", pid)
    await hooks.project_progress(cid, pid)
    wbs = await col(cid, "wbs").find({"project_id": pid}, {"_id": 0}).to_list(2000)
    leaves = [w for w in wbs if num(w.get("qty")) > 0]
    milestones = [{"code": w.get("code"), "name": w.get("name"), "pct": round(min(num(w.get("done_qty")) / num(w["qty"]), 1) * 100, 1), "end_date": w.get("end_date")} for w in leaves]
    bills = await col(cid, "ra_bills").find({"project_id": pid, "status": "Approved"}, {"_id": 0, "id": 1, "number": 1, "bill_date": 1, "invoice_total": 1, "net_payable": 1, "received": 1}).to_list(200)
    for b in bills:
        b["payment_status"] = "Paid" if num(b.get("received")) >= num(b.get("net_payable")) - 1 else ("Part-paid" if num(b.get("received")) else "Pending")
    await col(cid, "client_views").insert_one({"id": uid(), "user": user["email"], "project_id": pid, "at": now(), "what": "project"})
    return {"project": {k: p.get(k) for k in ("code", "name", "client", "loa_no", "start_date", "end_date", "contract_value", "physical_pct", "billed_value", "status")},
            "milestones": milestones, "ra_bills": bills, "company": (await company_of(cid)).get("name")}


@router.get("/portal/{cid}/pdf/{rid}")
async def portal_pdf(cid: str, rid: str, user=Depends(current_user)):
    r = await get_or_404(cid, "ra_bills", rid)
    if not any(cp["company_id"] == cid and cp["project_id"] == r.get("project_id") for cp in user.get("client_projects") or []) and not user["is_super"]:
        raise HTTPException(403, "Not your project")
    await col(cid, "client_views").insert_one({"id": uid(), "user": user["email"], "project_id": r.get("project_id"), "at": now(), "what": f"pdf {r.get('number')}"})
    return await render_pdf(cid, "ra_bills", rid)


@router.get("/c/{cid}/client-views")
async def client_views(cid: str, user=Depends(current_user)):
    return await col(cid, "client_views").find({}, {"_id": 0}).sort("at", -1).to_list(500)
