"""Generic register engine: config, CRUD, approvals, locking, excel import/export."""
import io
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Body
from fastapi.responses import StreamingResponse
import openpyxl
import json
from core import (db, col, uid, now, num, clean, audit, next_number, current_user, require, mask, has_company)
import hooks

router = APIRouter(prefix="/api")

# key: (module, number_prefix or None, approval levels or None)
R = {
    # M1
    "tenders": ("M1", None, None), "costings": ("M1", None, ["Director"]), "maf": ("M1", None, None),
    "corrigenda": ("M1", None, None),
    # M2
    "projects": ("M2", None, None), "sites": ("M2", None, None), "wbs": ("M2", None, None),
    "change_orders": ("M2", "CO", ["Project Manager", "Director"]), "hindrances": ("M2", None, None),
    # M3
    "employees": ("M3", "EMP", None), "attendance": ("M3", None, None), "payroll_runs": ("M3", "PR", ["HR Manager", "Accounts Head"]),
    "payslips": ("M3", None, None), "claims": ("M3", "CLM", ["Project Manager", "Accounts Head"]),
    "advances": ("M3", "ADV", ["Accounts Head"]), "petty_cash": ("M3", None, None), "hr_letters": ("M3", "HRL", None),
    "trainings": ("M3", None, None), "min_wages": ("M3", None, None),
    # M4
    "products": ("M4", None, None), "vendors": ("M4", "VEN", None), "requisitions": ("M4", "MR", ["Project Manager"]),
    "rfqs": ("M4", "RFQ", None), "quotes": ("M4", None, None), "pos": ("M4", "PO", "PO"), "grns": ("M4", "GRN", None),
    "vendor_advances": ("M4", "VA", ["Accounts Head"]),
    # M5
    "stock_ledger": ("M5", None, None), "stock_transfers": ("M5", "ST", ["Project Manager"]), "free_issue": ("M5", None, None),
    "equipment": ("M5", None, None), "equipment_usage": ("M5", None, None), "vehicles": ("M5", None, None),
    "trips": ("M5", None, None), "insurance": ("M5", None, None),
    # M6
    "dprs": ("M6", "DPR", ["Project Manager"]), "drawings": ("M6", None, None), "rfis": ("M6", "RFI", None),
    # M7
    "subcontractors": ("M7", None, None), "work_orders": ("M7", "WO", ["Project Manager"]),
    "sub_dprs": ("M7", None, ["Site Engineer", "Project Manager"]), "sub_bills": ("M7", "SB", ["Project Manager", "Accounts Head"]),
    "sub_payments": ("M7", None, None),
    # M8
    "ra_bills": ("M8", "RA", ["Project Manager", "Accounts Head"]), "invoices": ("M8", "INV", None), "receipts": ("M8", "RCT", None),
    "deductions": ("M8", None, None), "credit_notes": ("M8", "CN", None),
    # M9
    "bgs": ("M9", None, None), "mob_advances": ("M9", None, None),
    # M10
    "checklists": ("M10", None, None), "checklist_runs": ("M10", None, None), "incidents": ("M10", "INC", None),
    "ncrs": ("M10", "NCR", None), "contracts": ("M10", None, None), "compliances": ("M10", None, None),
    "disputes": ("M10", None, None), "warranties": ("M10", None, None), "permits": ("M10", None, None),
    "correspondence": ("M10", "LTR", None),
    # M12
    "tally_mappings": ("M12", None, None), "vouchers": ("M12", None, None),
    # M13
    "tasks": ("M13", None, None), "documents": ("M13", None, None), "vault_docs": ("M13", None, None),
    # M15
    "communications": ("M15", None, None), "reminders": ("M15", None, None),
}
ACCOUNTING = {"ra_bills", "invoices", "receipts", "deductions", "credit_notes", "sub_bills", "sub_payments", "claims", "vouchers", "payroll_runs"}
PROJECT_SCOPED_SKIP = {"products", "vendors", "employees", "tenders", "min_wages", "tally_mappings", "vault_docs", "subcontractors", "checklists"}


def reg_cfg(reg):
    if reg not in R:
        raise HTTPException(404, f"Unknown register {reg}")
    return R[reg]


def approval_levels(reg, rec):
    lv = R[reg][2]
    if lv == "PO":
        return ["Project Manager"] if num(rec.get("total")) <= 500000 else ["Project Manager", "Director"]
    return lv


def scope_filter(user, reg):
    sc = user.get("scope") or {}
    f = {}
    if user["is_super"] or reg in PROJECT_SCOPED_SKIP:
        return f
    if sc.get("project_ids"):
        f["id" if reg == "projects" else "project_id"] = {"$in": sc["project_ids"]}
    if sc.get("site_ids") and reg in ("dprs", "attendance", "sites"):
        f["id" if reg == "sites" else "site_id"] = {"$in": sc["site_ids"]}
    if sc.get("states") and reg == "projects":
        f["state"] = {"$in": sc["states"]}
    return f


async def period_locked(cid, reg, rec):
    if reg not in ACCOUNTING:
        return False
    comp = await db.companies.find_one({"id": cid}, {"_id": 0, "closed_periods": 1}) or {}
    d = (rec.get("date") or rec.get("bill_date") or "")[:7]
    return bool(d and d in (comp.get("closed_periods") or []))


async def create_record(cid, reg, data, user, run_hooks=True):
    module, prefix, _ = reg_cfg(reg)
    data = {k: v for k, v in data.items() if k not in ("_id",)}
    data.setdefault("id", uid())
    data.update(created_at=now(), updated_at=now(), created_by=(user or {}).get("name", "System"))
    data.setdefault("status", "Draft" if R[reg][2] else data.get("status") or "Active")
    if prefix and not data.get("number"):
        state = None
        if data.get("project_id"):
            p = await col(cid, "projects").find_one({"id": data["project_id"]}, {"_id": 0, "state": 1})
            state = (p or {}).get("state")
        data["number"] = await next_number(cid, reg, state, data.get("date"), prefix)
    if run_hooks:
        await hooks.before_save(cid, reg, data, None, user)
    await col(cid, reg).insert_one(dict(data))
    await audit(cid, user, "create", reg, data["id"], {}, data)
    if run_hooks:
        await hooks.after_create(cid, reg, data, user)
    return clean(data)


async def update_record(cid, reg, rid, patch, user, force=False):
    c = col(cid, reg)
    before = await c.find_one({"id": rid}, {"_id": 0})
    if not before:
        raise HTTPException(404, "Record not found")
    if not force and (before.get("locked") or await period_locked(cid, reg, before)):
        raise HTTPException(423, "Record is locked (approved/synced or period closed). Use a reversal or credit/debit note, or ask Accounts Head to reopen.")
    patch = {k: v for k, v in patch.items() if k not in ("_id", "id", "created_at", "created_by", "number")}
    if not force:
        patch = {k: v for k, v in patch.items() if not (isinstance(v, str) and v == "••••")}
    patch["updated_at"] = now()
    after = {**before, **patch}
    await hooks.before_save(cid, reg, after, before, user)
    await c.replace_one({"id": rid}, after)
    await audit(cid, user, "update", reg, rid, before, after)
    await hooks.after_update(cid, reg, after, before, user)
    return clean(after)


@router.get("/c/{cid}/r/{reg}")
async def list_records(cid: str, reg: str, project_id: str = None, status: str = None, q: str = None, tender_id: str = None,
                       limit: int = 500, user=Depends(current_user)):
    module = reg_cfg(reg)[0]
    require(user, cid, module, "view")
    f = scope_filter(user, reg)
    if project_id:
        f["project_id"] = project_id
    if tender_id:
        f["tender_id"] = tender_id
    if status:
        f["status"] = {"$in": status.split(",")}
    if reg == "employees" and not user["is_super"] and user["modules"].get("M3") in (None, "none", "view") and user.get("employee_id"):
        f["id"] = user["employee_id"]
    rows = await col(cid, reg).find(f, {"_id": 0}).sort("created_at", -1).to_list(limit)
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in json.dumps(r, default=str).lower()]
    return mask(rows, user["masked_fields"])


@router.get("/c/{cid}/r/{reg}/{rid}")
async def get_record(cid: str, reg: str, rid: str, user=Depends(current_user)):
    require(user, cid, reg_cfg(reg)[0], "view")
    r = await col(cid, reg).find_one({"id": rid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Not found")
    return mask(r, user["masked_fields"])


@router.post("/c/{cid}/r/{reg}")
async def post_record(cid: str, reg: str, data: dict = Body(...), user=Depends(current_user)):
    require(user, cid, reg_cfg(reg)[0], "edit")
    return await create_record(cid, reg, data, user)


@router.put("/c/{cid}/r/{reg}/{rid}")
async def put_record(cid: str, reg: str, rid: str, data: dict = Body(...), user=Depends(current_user)):
    require(user, cid, reg_cfg(reg)[0], "edit")
    return await update_record(cid, reg, rid, data, user)


@router.delete("/c/{cid}/r/{reg}/{rid}")
async def delete_record(cid: str, reg: str, rid: str, user=Depends(current_user)):
    require(user, cid, reg_cfg(reg)[0], "edit")
    c = col(cid, reg)
    before = await c.find_one({"id": rid}, {"_id": 0})
    if not before:
        raise HTTPException(404, "Not found")
    if before.get("locked") or before.get("status") in ("Approved", "Synced", "Certified", "Paid", "Closed"):
        raise HTTPException(423, "Approved/locked records cannot be deleted; post a reversal instead.")
    await c.delete_one({"id": rid})
    await db.approvals.delete_many({"company_id": cid, "entity": reg, "entity_id": rid, "status": "Pending"})
    await audit(cid, user, "delete", reg, rid, before, {})
    return {"ok": True}


@router.post("/c/{cid}/r/{reg}/{rid}/reopen")
async def reopen(cid: str, reg: str, rid: str, body: dict = Body(...), user=Depends(current_user)):
    if not (user["is_super"] or "Accounts Head" in user["acting_roles"]):
        raise HTTPException(403, "Only Accounts Head can reopen locked entries")
    if not (body.get("reason") or "").strip():
        raise HTTPException(400, "Reason is mandatory to reopen")
    r = await update_record(cid, reg, rid, {"locked": False, "status": "Reopened", "reopen_reason": body["reason"]}, user, force=True)
    await audit(cid, user, "reopen", reg, rid, note=body["reason"])
    return r


# ---------------- approvals ----------------
@router.post("/c/{cid}/r/{reg}/{rid}/submit")
async def submit(cid: str, reg: str, rid: str, user=Depends(current_user)):
    require(user, cid, reg_cfg(reg)[0], "edit")
    rec = await col(cid, reg).find_one({"id": rid}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Not found")
    levels = approval_levels(reg, rec)
    if not levels:
        raise HTTPException(400, "This register has no approval workflow")
    await hooks.validate_submit(cid, reg, rec)
    existing = await db.approvals.find_one({"company_id": cid, "entity": reg, "entity_id": rid, "status": "Pending"})
    if existing:
        raise HTTPException(400, "Already pending approval")
    appr = {"id": uid(), "company_id": cid, "entity": reg, "entity_id": rid,
            "title": rec.get("number") or rec.get("title") or rec.get("name") or reg, "project_id": rec.get("project_id"),
            "amount": rec.get("total") or rec.get("amount") or rec.get("net_amount"),
            "levels": [{"role": r, "status": "Pending", "by": None, "at": None, "remarks": ""} for r in levels],
            "current": 0, "status": "Pending", "submitted_by": user["name"], "submitted_at": now()}
    await db.approvals.insert_one(dict(appr))
    await update_record(cid, reg, rid, {"status": "Submitted", "approval_id": appr["id"]}, user, force=True)
    return clean(appr)


def can_act(user, appr):
    if appr["status"] != "Pending":
        return False
    role = appr["levels"][appr["current"]]["role"]
    return user["is_super"] or role in user["acting_roles"]


@router.get("/c/{cid}/approvals")
async def list_approvals(cid: str, mine: bool = False, status: str = None, user=Depends(current_user)):
    if not has_company(user, cid):
        raise HTTPException(403, "No access")
    f = {"company_id": cid}
    if status:
        f["status"] = status
    rows = await db.approvals.find(f, {"_id": 0}).sort("submitted_at", -1).to_list(500)
    for r in rows:
        r["can_act"] = can_act(user, r)
        r["pending_role"] = r["levels"][r["current"]]["role"] if r["status"] == "Pending" else None
    if mine:
        rows = [r for r in rows if r["can_act"]]
    return rows


@router.post("/c/{cid}/approvals/{aid}/act")
async def act(cid: str, aid: str, body: dict = Body(...), user=Depends(current_user)):
    appr = await db.approvals.find_one({"id": aid, "company_id": cid}, {"_id": 0})
    if not appr:
        raise HTTPException(404, "Approval not found")
    if not can_act(user, appr):
        raise HTTPException(403, "You cannot act on this approval at its current level")
    action, remarks = body.get("action"), (body.get("remarks") or "").strip()
    if action == "reject" and not remarks:
        raise HTTPException(400, "A reason is mandatory when rejecting")
    lv = appr["levels"][appr["current"]]
    lv.update(status="Approved" if action == "approve" else "Rejected", by=user["name"], at=now(), remarks=remarks)
    reg, rid = appr["entity"], appr["entity_id"]
    if action == "reject":
        appr["status"] = "Rejected"
        await update_record(cid, reg, rid, {"status": "Rejected", "reject_reason": remarks}, user, force=True)
        await hooks.on_rejected(cid, reg, rid, remarks, user)
    elif appr["current"] + 1 < len(appr["levels"]):
        appr["current"] += 1
        await update_record(cid, reg, rid, {"status": f"Approved L{appr['current']}"}, user, force=True)
    else:
        appr["status"] = "Approved"
        rec = await update_record(cid, reg, rid, {"status": "Approved", "approved_by": user["name"], "approved_at": now()}, user, force=True)
        await hooks.on_approved(cid, reg, rec, user)
        if reg not in ("tenders",):
            await col(cid, reg).update_one({"id": rid}, {"$set": {"locked": True}})
    await db.approvals.replace_one({"id": aid}, appr)
    await audit(cid, user, f"approval_{action}", reg, rid, note=remarks)
    return clean(appr)


# ---------------- excel ----------------
@router.get("/c/{cid}/r/{reg}/export/xlsx")
async def export_xlsx(cid: str, reg: str, project_id: str = None, user=Depends(current_user)):
    rows = await list_records(cid, reg, project_id=project_id, user=user)
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = reg[:30]
    keys = []
    for r in rows:
        for k, v in r.items():
            if k not in keys and not isinstance(v, (list, dict)):
                keys.append(k)
    ws.append(keys)
    for r in rows:
        ws.append([str(r.get(k, "")) if r.get(k) is not None else "" for k in keys])
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename={reg}.xlsx"})


@router.post("/c/{cid}/r/{reg}/import/xlsx")
async def import_xlsx(cid: str, reg: str, file: UploadFile = File(...), user=Depends(current_user)):
    require(user, cid, reg_cfg(reg)[0], "edit")
    wb = openpyxl.load_workbook(io.BytesIO(await file.read()), data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(400, "Empty sheet")
    hdr = [str(h).strip().lower().replace(" ", "_") if h else "" for h in rows[0]]
    n = 0
    for row in rows[1:]:
        if not any(row):
            continue
        d = {hdr[i]: (v.isoformat()[:10] if hasattr(v, "isoformat") else v) for i, v in enumerate(row) if hdr[i] and v is not None}
        d.pop("id", None)
        await create_record(cid, reg, d, user)
        n += 1
    return {"imported": n}
