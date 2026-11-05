"""
M1 Pre-Tender full workflow + post-award carry-forward.

State machine (tender.stage):
    Draft -> Pending Director -> (Rejected | Approved - Study)
    Approved - Study -> BOQ & RFQ -> Costing Locked -> Pending MD
    Pending MD -> (Rejected | MD Approved) -> Quoted -> (Won -> Project | Lost)

Design notes
- We keep using the existing `tenders` register for storage. The `stage` field
  is the single source of truth. New fields live inside the same document so
  masking / scoping already applied by `/r/tenders` keep working.
- BOQ Studio uses a dedicated `tender_quotes` collection:
    one doc per (tender_id, item_id, vendor_id, round)
- RFQ dispatch reuses existing vendor_links so that already-wired public pages
  and mailbox match engine (mailbox.py) work with no changes.
"""
from __future__ import annotations

import io
import json
from datetime import datetime, timedelta, timezone
from html import escape

import openpyxl
from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile

from core import (APP_URL, audit, clean, col, current_user, db, email_shell, has_company, mask, now, num,
                  require, send_email, uid)
from registers import create_record, update_record, scope_filter

router = APIRouter(prefix="/api")

# ---------------- stage helpers ---------------- #
STAGES = [
    "Draft", "Pending Director", "Rejected",
    "Approved - Study", "BOQ & RFQ",
    "Costing Locked", "Pending MD", "MD Approved",
    "Quoted", "Won", "Lost",
]


async def _get(cid, tid):
    t = await col(cid, "tenders").find_one({"id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Tender not found")
    return t


async def _company(cid):
    return await db.companies.find_one({"id": cid}, {"_id": 0}) or {}


def _enforce_stage(t, *allowed):
    st = t.get("stage") or "Draft"
    if st not in allowed:
        raise HTTPException(409, f"Action not allowed from stage '{st}'. Allowed: {', '.join(allowed)}")


# ================================================================== #
# 1.1  Basic intake (single + bulk import)                             #
# ================================================================== #
BULK_COLUMNS = ["Tender ID", "Name", "Amount", "EMD", "Closing Date"]


@router.get("/c/{cid}/pretender/import-template")
async def import_template(cid: str, user=Depends(current_user)):
    """Download a sample Excel so admins know which columns to fill."""
    require(user, cid, "M1", "view")
    from fastapi.responses import Response
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Tenders"
    ws.append(BULK_COLUMNS)
    ws.append(["JKEE-TEST-001", "Sample Substation Package", 12500000, 125000, "2026-12-31"])
    ws.append(["JKEE-TEST-002", "Another Sample Package", 8500000, 85000, "2026-12-20"])
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return Response(content=buf.read(),
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"content-disposition": "attachment; filename=tender-import-template.xlsx"})


@router.post("/c/{cid}/pretender/bulk-import")
async def bulk_import(cid: str, file: UploadFile = File(...), user=Depends(current_user)):
    require(user, cid, "M1", "edit")
    data = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
        ws = wb.active
    except Exception as e:
        raise HTTPException(400, f"Could not read Excel: {e}")
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        raise HTTPException(400, "Empty sheet")
    header = [str(c or "").strip() for c in rows[0]]
    idx = {h: header.index(h) for h in BULK_COLUMNS if h in header}
    missing = [c for c in BULK_COLUMNS if c not in idx]
    if missing:
        raise HTTPException(400, f"Missing columns: {', '.join(missing)}")
    created, skipped, errors = 0, 0, []
    for r_i, row in enumerate(rows[1:], start=2):
        try:
            val = lambda k: row[idx[k]]  # noqa
            tender_no = str(val("Tender ID") or "").strip()
            title = str(val("Name") or "").strip()
            if not tender_no or not title:
                skipped += 1; continue
            exists = await col(cid, "tenders").find_one({"tender_no": tender_no}, {"id": 1})
            if exists:
                skipped += 1; continue
            due = val("Closing Date")
            if isinstance(due, datetime):
                due = due.date().isoformat()
            payload = {
                "tender_no": tender_no, "title": title,
                "estimated_value": num(val("Amount")),
                "emd": num(val("EMD")),
                "bid_due_date": str(due or "")[:10] or None,
                "stage": "Draft",
                "source": "Bulk upload",
            }
            await create_record(cid, "tenders", payload, user)
            created += 1
        except Exception as e:
            errors.append(f"Row {r_i}: {e}")
    return {"created": created, "skipped": skipped, "errors": errors[:5]}


# ================================================================== #
# 1.2 / 1.3  Director pre-study approval                               #
# ================================================================== #
async def _open_approval(cid, tid, levels, kind, title, user, amount=None):
    if await db.approvals.find_one({"company_id": cid, "entity": "tenders", "entity_id": tid, "status": "Pending"}):
        raise HTTPException(400, "An approval is already pending on this tender")
    appr = {
        "id": uid(), "company_id": cid, "entity": "tenders", "entity_id": tid, "title": title, "amount": amount,
        "levels": [{"role": r, "status": "Pending", "by": None, "at": None, "remarks": ""} for r in levels],
        "current": 0, "status": "Pending", "submitted_by": user.get("name", ""), "submitted_at": now(), "kind": kind,
    }
    await db.approvals.insert_one(dict(appr))
    return clean(appr)


@router.post("/c/{cid}/pretender/{tid}/submit-for-director")
async def submit_for_director(cid: str, tid: str, user=Depends(current_user)):
    require(user, cid, "M1", "edit")
    t = await _get(cid, tid)
    _enforce_stage(t, "Draft", "Rejected")
    appr = await _open_approval(cid, tid, ["Director"], "pre_study",
                                f"Pre-study approval: {t.get('tender_no')} - {(t.get('title') or '')[:60]}",
                                user, amount=t.get("estimated_value"))
    await update_record(cid, "tenders", tid, {"stage": "Pending Director", "approval_id": appr["id"]}, user, force=True)
    await audit(cid, user, "submit_for_director", "tenders", tid)
    return appr


@router.post("/c/{cid}/pretender/{tid}/director-decision")
async def director_decision(cid: str, tid: str, body: dict = Body(...), user=Depends(current_user)):
    t = await _get(cid, tid)
    _enforce_stage(t, "Pending Director")
    action = (body.get("action") or "").lower()
    reason = (body.get("reason") or "").strip()
    if action not in ("approve", "reject"):
        raise HTTPException(400, "action must be approve or reject")
    if action == "reject" and not reason:
        raise HTTPException(400, "Reason is mandatory when rejecting")
    # Only Director (or Super) may act
    if not user.get("is_super") and "Director" not in (user.get("acting_roles") or []):
        raise HTTPException(403, "Only a Director can take this action")
    appr = await db.approvals.find_one({"id": t.get("approval_id")}, {"_id": 0})
    if not appr or appr["status"] != "Pending":
        raise HTTPException(409, "No pending approval for this tender")
    appr["levels"][0].update(status="Approved" if action == "approve" else "Rejected",
                              by=user.get("name"), at=now(), remarks=reason)
    appr["status"] = "Approved" if action == "approve" else "Rejected"
    await db.approvals.replace_one({"id": appr["id"]}, appr)
    new_stage = "Approved - Study" if action == "approve" else "Rejected"
    patch = {"stage": new_stage, "director_decision_at": now(), "director_remarks": reason}
    if action == "reject":
        patch["reject_reason"] = reason
    await update_record(cid, "tenders", tid, patch, user, force=True)
    await audit(cid, user, f"director_{action}", "tenders", tid, note=reason)
    return {"ok": True, "stage": new_stage}


# ================================================================== #
# 1.4 / 1.5  Document upload + AI extraction                           #
# ================================================================== #
@router.post("/c/{cid}/pretender/{tid}/upload-nit")
async def upload_nit(cid: str, tid: str, file: UploadFile = File(...), user=Depends(current_user)):
    require(user, cid, "M1", "edit")
    t = await _get(cid, tid)
    _enforce_stage(t, "Approved - Study", "BOQ & RFQ", "Costing Locked", "Pending MD", "MD Approved")
    # Delegate extraction to the existing /ai/extract endpoint via a direct call
    from flows_a import ai_extract
    extracted = await ai_extract(cid, file=file, doc_type="nit", user=user)
    fields = {f["key"]: f["value"] for f in (extracted.get("fields") or []) if f.get("value") not in (None, "")}
    # Parse eligibility / required docs into structured lists
    tech, fin, docs = _parse_eligibility(fields)
    patch = {
        "nit_file_id": extracted["file"]["id"],
        "nit_file_name": extracted["file"].get("name"),
        "nit_fields": fields,
        "eligibility_tech": _merge_rules(t.get("eligibility_tech"), tech),
        "eligibility_fin": _merge_rules(t.get("eligibility_fin"), fin),
        "docs_required": _merge_rules(t.get("docs_required"), docs),
    }
    # Carry a few essential NIT fields to the tender head for convenience
    for k in ("department", "location", "state", "bid_due_date", "prebid_date", "opening_date", "estimated_value", "emd", "tender_fee", "completion_period", "tender_portal_url"):
        if fields.get(k) and not t.get(k):
            patch[k] = fields[k] if k not in ("estimated_value", "emd", "tender_fee") else num(fields[k])
    await update_record(cid, "tenders", tid, patch, user, force=True)
    await audit(cid, user, "upload_nit", "tenders", tid)
    return {"ok": True, "extracted": extracted, "patch": patch}


def _parse_eligibility(fields: dict):
    """Split NIT eligibility text into tech / financial / documents lists."""
    tech, fin, docs = [], [], []
    txt = str(fields.get("eligibility") or "")
    # Heuristic: lines containing turnover/financial/networth → fin; cert/documents → docs; rest → tech
    for raw in filter(None, [p.strip(" •-\u2022") for p in txt.replace(";", "\n").splitlines() if p.strip()]):
        low = raw.lower()
        if any(k in low for k in ("turnover", "networth", "net worth", "financial", "profit", "balance sheet")):
            fin.append(raw)
        elif any(k in low for k in ("certificate", "registration", "license", "licence", "iso", "gst", "pan", "udyam")):
            docs.append(raw)
        else:
            tech.append(raw)
    for raw in filter(None, [p.strip(" •-\u2022") for p in str(fields.get("required_documents") or "").replace(";", "\n").splitlines() if p.strip()]):
        docs.append(raw)
    return (
        [{"id": uid()[:8], "requirement": t, "compliant": False, "notes": ""} for t in tech],
        [{"id": uid()[:8], "requirement": t, "compliant": False, "notes": ""} for t in fin],
        [{"id": uid()[:8], "requirement": t, "compliant": False, "notes": ""} for t in docs],
    )


def _merge_rules(existing: list | None, new_items: list):
    existing = existing or []
    seen = {(x.get("requirement") or "").lower() for x in existing}
    for n in new_items:
        if (n.get("requirement") or "").lower() not in seen:
            existing.append(n)
    return existing


@router.post("/c/{cid}/pretender/{tid}/upload-boq")
async def upload_boq(cid: str, tid: str, file: UploadFile = File(...), user=Depends(current_user)):
    require(user, cid, "M1", "edit")
    t = await _get(cid, tid)
    _enforce_stage(t, "Approved - Study", "BOQ & RFQ", "Costing Locked", "Pending MD", "MD Approved")
    from flows_a import ai_extract
    extracted = await ai_extract(cid, file=file, doc_type="boq", user=user)
    items = []
    for it in (extracted.get("items") or []):
        items.append({
            "id": uid()[:8],
            "code": it.get("code") or "",
            "desc": it.get("desc") or "",
            "uom": it.get("uom") or "",
            "qty": num(it.get("qty")),
            "est_rate": num(it.get("rate")),
            "locked_rate": None,
            "locked_vendor_id": None,
        })
    patch = {"boq_file_id": extracted["file"]["id"], "boq_file_name": extracted["file"].get("name"), "boq": items}
    await update_record(cid, "tenders", tid, patch, user, force=True)
    await audit(cid, user, "upload_boq", "tenders", tid)
    return {"ok": True, "items": items, "extracted_rows": len(items)}


@router.put("/c/{cid}/pretender/{tid}/boq")
async def edit_boq(cid: str, tid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M1", "edit")
    t = await _get(cid, tid)
    items = body.get("items") or []
    # Preserve ids where provided; add ids for new rows
    clean_items = []
    for it in items:
        clean_items.append({
            "id": it.get("id") or uid()[:8],
            "code": it.get("code") or "", "desc": it.get("desc") or "",
            "uom": it.get("uom") or "", "qty": num(it.get("qty")),
            "est_rate": num(it.get("est_rate")),
            "locked_rate": num(it.get("locked_rate")) if it.get("locked_rate") not in (None, "") else None,
            "locked_vendor_id": it.get("locked_vendor_id"),
        })
    await update_record(cid, "tenders", tid, {"boq": clean_items}, user, force=True)
    return {"ok": True, "items": clean_items}


@router.put("/c/{cid}/pretender/{tid}/eligibility")
async def edit_eligibility(cid: str, tid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M1", "edit")
    patch = {}
    for k in ("eligibility_tech", "eligibility_fin", "docs_required"):
        if k in body:
            patch[k] = [{"id": r.get("id") or uid()[:8], "requirement": r.get("requirement") or "",
                         "compliant": bool(r.get("compliant")), "notes": r.get("notes") or ""} for r in (body[k] or [])]
    if patch:
        await update_record(cid, "tenders", tid, patch, user, force=True)
    return {"ok": True, "patch": patch}


# ================================================================== #
# 1.6  BOQ Studio — multi-vendor RFQ + dynamic matrix                  #
# ================================================================== #
async def _rounds_count(cid, tid):
    """Highest round number sent on this tender so far."""
    doc = await col(cid, "tender_quotes").find_one({"tender_id": tid}, {"_id": 0, "round": 1}, sort=[("round", -1)])
    return doc["round"] if doc else 0


@router.post("/c/{cid}/pretender/{tid}/boq/send-rfq")
async def boq_send_rfq(cid: str, tid: str, body: dict = Body(...), user=Depends(current_user)):
    """Send an RFQ for selected BOQ items to selected vendors.

    body = {
        item_ids: ["..."]  # subset of tender.boq ids
        vendor_ids: ["..."]
        due_date: "YYYY-MM-DD"
        notes: str
        send_email: bool (default True)
        round: int (optional; defaults to next round)
    }
    """
    require(user, cid, "M1", "edit")
    t = await _get(cid, tid)
    _enforce_stage(t, "Approved - Study", "BOQ & RFQ")
    boq = t.get("boq") or []
    if not boq:
        raise HTTPException(400, "No BOQ items on this tender yet")
    pick_ids = set(body.get("item_ids") or [])
    pick_items = [i for i in boq if i["id"] in pick_ids] if pick_ids else boq
    vendor_ids = body.get("vendor_ids") or []
    if not vendor_ids:
        raise HTTPException(400, "Choose at least one vendor")
    round_no = int(body.get("round") or (await _rounds_count(cid, tid) + 1))

    # Create one RFQ (shared) and vendor links for each vendor
    from flows_b import make_link, items_table
    from core import next_number
    rfq_items = [{"desc": it["desc"], "uom": it["uom"], "qty": it["qty"], "code": it.get("code")} for it in pick_items]
    rfq_no = await next_number(cid, "rfqs", "", d=now()[:10], prefix="RFQ")
    rfq_doc = {
        "id": uid(), "number": rfq_no, "tender_id": tid, "title": t.get("title"),
        "items": rfq_items, "due_date": body.get("due_date"), "status": "Sent",
        "sent_at": now(), "notes": body.get("notes") or "", "vendor_ids": vendor_ids, "round": round_no,
    }
    await col(cid, "rfqs").insert_one({**rfq_doc, "created_at": now(), "updated_at": now(), "created_by": user.get("name", "")})

    comp = await _company(cid)
    sent = []
    for vid in vendor_ids:
        v = await col(cid, "vendors").find_one({"id": vid}, {"_id": 0})
        if not v:
            continue
        link = await make_link(cid, "rfq", rfq_doc["id"], vid, user)
        row = {"vendor_id": vid, "vendor_name": v.get("name"), "url": link["url"], "token": link["token"], "email_status": None}
        if body.get("send_email", True) and v.get("email"):
            html = email_shell(
                comp,
                f"RFQ {rfq_no} · Round {round_no} · {t.get('tender_no')}",
                f"<p>Dear {escape(v.get('name',''))},</p>"
                f"<p>We invite your best quotation for the following items of tender <b>{escape(t.get('tender_no') or '')}</b> — "
                f"{escape(t.get('title') or '')}. Please quote by <b>{escape(str(body.get('due_date') or ''))}</b>.</p>"
                + items_table(rfq_items)
                + f"<p>Reply to this email with your rates, or <a href=\"{link['url']}\">submit online</a>. "
                  f"Please keep the RFQ number <b>{rfq_no}</b> in your reply subject so we can match it automatically.</p>"
                  f"<p>{escape(body.get('notes') or '')}</p>"
            )
            em = await send_email(cid, to=v["email"], subject=f"RFQ {rfq_no} - {comp.get('name')}",
                                   html=html, entity="rfqs", entity_id=rfq_doc["id"], vendor_id=vid, user=user)
            row["email_status"] = em["status"]; row["email_error"] = em.get("error")
        # Seed empty tender_quotes so matrix shows the invited vendor column
        for it in pick_items:
            await col(cid, "tender_quotes").update_one(
                {"tender_id": tid, "item_id": it["id"], "vendor_id": vid, "round": round_no},
                {"$setOnInsert": {"id": uid(), "tender_id": tid, "item_id": it["id"], "vendor_id": vid,
                                   "vendor_name": v.get("name"), "round": round_no, "rate": None,
                                   "rfq_id": rfq_doc["id"], "status": "Invited", "created_at": now()}},
                upsert=True,
            )
        sent.append(row)

    await update_record(cid, "tenders", tid,
                        {"stage": "BOQ & RFQ", "last_rfq_at": now(), "last_rfq_round": round_no},
                        user, force=True)
    await audit(cid, user, "boq_send_rfq", "tenders", tid,
                note=f"RFQ {rfq_no} · round {round_no} · {len(pick_items)} items · {len(vendor_ids)} vendors")
    return {"ok": True, "rfq_id": rfq_doc["id"], "rfq_number": rfq_no, "round": round_no, "vendors": sent}


@router.get("/c/{cid}/pretender/{tid}/boq/matrix")
async def boq_matrix(cid: str, tid: str, user=Depends(current_user)):
    """Return the items × vendor × round matrix for BOQ Studio."""
    require(user, cid, "M1", "view")
    t = await _get(cid, tid)
    boq = t.get("boq") or []
    quotes = await col(cid, "tender_quotes").find({"tender_id": tid}, {"_id": 0}).to_list(5000)
    # Collect vendor + round combinations in a stable order
    rounds = sorted({q["round"] for q in quotes})
    vendor_order = []  # list of (vendor_id, vendor_name) in first-seen order
    seen_vendor = set()
    for q in sorted(quotes, key=lambda x: (x["round"], x.get("created_at") or "")):
        vk = q["vendor_id"]
        if vk not in seen_vendor:
            seen_vendor.add(vk)
            vendor_order.append({"vendor_id": vk, "vendor_name": q.get("vendor_name")})
    # Build quick lookup
    qmap = {(q["item_id"], q["vendor_id"], q["round"]): q for q in quotes}
    columns = [{"key": f"{v['vendor_id']}:{rnd}", "vendor_id": v["vendor_id"],
                "vendor_name": v["vendor_name"], "round": rnd, "label": f"{v['vendor_name']} · V{rnd}"}
               for rnd in rounds for v in vendor_order]
    rows = []
    for it in boq:
        row = {"item": it, "cells": {}}
        for c in columns:
            q = qmap.get((it["id"], c["vendor_id"], c["round"]))
            row["cells"][c["key"]] = {"rate": q.get("rate") if q else None,
                                       "status": (q or {}).get("status", "-"),
                                       "source": (q or {}).get("source", ""),
                                       "quote_id": (q or {}).get("id")}
        rows.append(row)
    return {"items": boq, "columns": columns, "rows": rows, "rounds": rounds, "vendors": vendor_order}


@router.post("/c/{cid}/pretender/{tid}/boq/quote")
async def set_quote(cid: str, tid: str, body: dict = Body(...), user=Depends(current_user)):
    """Manual entry or override of a vendor's rate for a BOQ item in a round."""
    require(user, cid, "M1", "edit")
    item_id = body.get("item_id"); vendor_id = body.get("vendor_id")
    rnd = int(body.get("round") or 1); rate = num(body.get("rate"))
    if not item_id or not vendor_id:
        raise HTTPException(400, "item_id and vendor_id required")
    v = await col(cid, "vendors").find_one({"id": vendor_id}, {"_id": 0}) or {}
    await col(cid, "tender_quotes").update_one(
        {"tender_id": tid, "item_id": item_id, "vendor_id": vendor_id, "round": rnd},
        {"$set": {"rate": rate, "status": "Received", "source": body.get("source") or "manual",
                   "vendor_name": v.get("name"), "updated_at": now()},
          "$setOnInsert": {"id": uid(), "tender_id": tid, "item_id": item_id,
                             "vendor_id": vendor_id, "round": rnd, "created_at": now()}},
        upsert=True,
    )
    await audit(cid, user, "boq_quote", "tenders", tid,
                note=f"item={item_id} vendor={vendor_id} rnd={rnd} rate={rate}")
    return {"ok": True}


@router.post("/c/{cid}/pretender/{tid}/boq/pick")
async def pick_vendor(cid: str, tid: str, body: dict = Body(...), user=Depends(current_user)):
    """Lock the chosen vendor+rate on a BOQ item (pre-lock preview)."""
    require(user, cid, "M1", "edit")
    t = await _get(cid, tid)
    item_id = body.get("item_id")
    vendor_id = body.get("vendor_id")
    rate = num(body.get("rate"))
    boq = t.get("boq") or []
    changed = False
    for it in boq:
        if it["id"] == item_id:
            it["locked_vendor_id"] = vendor_id
            it["locked_rate"] = rate
            changed = True
            break
    if not changed:
        raise HTTPException(404, "BOQ item not found")
    await update_record(cid, "tenders", tid, {"boq": boq}, user, force=True)
    return {"ok": True}


@router.post("/c/{cid}/pretender/{tid}/boq/auto-fill")
async def auto_fill(cid: str, tid: str, user=Depends(current_user)):
    """Scan the inbox for RFQ replies matched to this tender and parse rates via AI."""
    require(user, cid, "M1", "edit")
    t = await _get(cid, tid)
    # Find RFQs that belong to this tender
    rfqs = await col(cid, "rfqs").find({"tender_id": tid}, {"_id": 0}).to_list(50)
    rfq_ids = {r["id"] for r in rfqs}
    rfq_numbers = {r.get("number"): r for r in rfqs}
    # Find candidate emails
    emails = await col(cid, "inbox_emails").find(
        {"$or": [{"rfq_id": {"$in": list(rfq_ids)}}, {"rfq_number": {"$in": list(rfq_numbers.keys())}}]},
        {"_id": 0}
    ).to_list(200)
    if not emails:
        return {"ok": True, "processed": 0, "message": "No matching inbox emails yet"}

    # Use the existing LLM helper to parse rates from each email body
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    import os
    processed, filled = 0, 0
    boq = t.get("boq") or []
    item_catalog = [{"id": it["id"], "desc": it["desc"], "uom": it.get("uom"), "qty": it["qty"]} for it in boq]
    for em in emails:
        if not em.get("vendor_id") or not em.get("body"):
            continue
        rfq = next((r for r in rfqs if r["id"] == em.get("rfq_id") or r.get("number") == em.get("rfq_number")), None)
        if not rfq:
            continue
        rnd = rfq.get("round") or 1
        prompt = (
            "You are extracting a vendor's quoted rates from an email reply.\n"
            "Items catalog (JSON):\n" + json.dumps(item_catalog)[:6000] + "\n\n"
            "Email body:\n" + (em.get("body") or "")[:8000] + "\n\n"
            "Return ONLY JSON of shape {\"quotes\":[{\"item_id\":\"..\",\"rate\":<number>}]}. "
            "Match items by description and UOM. If a rate is missing, do not include that item."
        )
        chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=f"autofill-{uid()}",
                        system_message="You are a precise rate-extraction engine.").with_model("gemini", "gemini-2.5-flash")
        try:
            out = await chat.send_message(UserMessage(text=prompt))
            parsed = json.loads(out[out.find("{"): out.rfind("}") + 1])
            for q in parsed.get("quotes") or []:
                iid = q.get("item_id"); rate = num(q.get("rate"))
                if iid and rate:
                    await col(cid, "tender_quotes").update_one(
                        {"tender_id": tid, "item_id": iid, "vendor_id": em["vendor_id"], "round": rnd},
                        {"$set": {"rate": rate, "status": "Received", "source": "email",
                                   "email_id": em["id"], "vendor_name": em.get("vendor_name"), "updated_at": now()},
                          "$setOnInsert": {"id": uid(), "tender_id": tid, "item_id": iid,
                                             "vendor_id": em["vendor_id"], "round": rnd, "created_at": now()}},
                        upsert=True,
                    )
                    filled += 1
            processed += 1
        except Exception as e:
            await audit(cid, user, "boq_autofill_err", "tenders", tid, note=f"{em['id']}: {str(e)[:120]}")
    return {"ok": True, "processed": processed, "cells_filled": filled}


# ================================================================== #
# 1.7 / 1.8  Lock costing, MD approval, Quote                          #
# ================================================================== #
def _summary(boq):
    total = sum(num(it.get("locked_rate")) * num(it.get("qty")) for it in boq)
    picked = sum(1 for it in boq if it.get("locked_rate") not in (None, 0, ""))
    return {"total_locked_cost": round(total, 2), "picked": picked, "total_items": len(boq)}


@router.post("/c/{cid}/pretender/{tid}/costing/lock")
async def lock_costing(cid: str, tid: str, body: dict = Body(default={}), user=Depends(current_user)):
    require(user, cid, "M1", "edit")
    t = await _get(cid, tid)
    _enforce_stage(t, "BOQ & RFQ")
    boq = t.get("boq") or []
    if not boq:
        raise HTTPException(400, "BOQ is empty")
    missing = [i["id"] for i in boq if i.get("locked_rate") in (None, 0, "")]
    if missing:
        raise HTTPException(400, f"Pick a vendor rate for all BOQ items before locking ({len(missing)} missing)")
    summary = _summary(boq)
    margin_pct = num(body.get("margin_pct") or 10)
    overheads_pct = num(body.get("overheads_pct") or 5)
    bid_value = round(summary["total_locked_cost"] * (1 + (margin_pct + overheads_pct) / 100), 2)
    patch = {"stage": "Costing Locked", "locked_at": now(), "locked_by": user.get("name"),
             "total_locked_cost": summary["total_locked_cost"],
             "margin_pct": margin_pct, "overheads_pct": overheads_pct, "bid_value": bid_value}
    await update_record(cid, "tenders", tid, patch, user, force=True)
    # Submit MD approval
    appr = await _open_approval(cid, tid, ["Director"], "md_approval",
                                 f"MD approval: {t.get('tender_no')} - bid ₹{bid_value:,.0f}",
                                 user, amount=bid_value)
    await update_record(cid, "tenders", tid,
                        {"stage": "Pending MD", "approval_id": appr["id"]}, user, force=True)
    await audit(cid, user, "lock_costing", "tenders", tid, note=f"bid={bid_value}")
    return {"ok": True, "bid_value": bid_value, "approval_id": appr["id"]}


@router.post("/c/{cid}/pretender/{tid}/md-decision")
async def md_decision(cid: str, tid: str, body: dict = Body(...), user=Depends(current_user)):
    t = await _get(cid, tid)
    _enforce_stage(t, "Pending MD")
    if not user.get("is_super") and "Director" not in (user.get("acting_roles") or []):
        raise HTTPException(403, "Only a Director / MD can take this action")
    action = (body.get("action") or "").lower()
    reason = (body.get("reason") or "").strip()
    if action not in ("approve", "reject"):
        raise HTTPException(400, "action must be approve or reject")
    if action == "reject" and not reason:
        raise HTTPException(400, "Reason is mandatory when rejecting")
    appr = await db.approvals.find_one({"id": t.get("approval_id")}, {"_id": 0})
    if not appr:
        raise HTTPException(404, "Approval not found")
    appr["levels"][0].update(status="Approved" if action == "approve" else "Rejected",
                              by=user.get("name"), at=now(), remarks=reason)
    appr["status"] = "Approved" if action == "approve" else "Rejected"
    await db.approvals.replace_one({"id": appr["id"]}, appr)
    patch = {"md_decision_at": now(), "md_remarks": reason}
    if action == "approve":
        patch["stage"] = "MD Approved"
    else:
        patch["stage"] = "BOQ & RFQ"  # back to studio to rework
        patch["reject_reason"] = reason
    await update_record(cid, "tenders", tid, patch, user, force=True)
    await audit(cid, user, f"md_{action}", "tenders", tid, note=reason)
    return {"ok": True, "stage": patch["stage"]}


@router.post("/c/{cid}/pretender/{tid}/quote")
async def mark_quoted(cid: str, tid: str, body: dict = Body(default={}), user=Depends(current_user)):
    require(user, cid, "M1", "edit")
    t = await _get(cid, tid)
    _enforce_stage(t, "MD Approved")
    bid_value = num(body.get("bid_value") or t.get("bid_value"))
    if not bid_value:
        raise HTTPException(400, "Bid value is required")
    patch = {"stage": "Quoted", "quoted_at": now(), "bid_value": bid_value,
             "quoted_reference": body.get("reference") or "", "quoted_by": user.get("name")}
    await update_record(cid, "tenders", tid, patch, user, force=True)
    await audit(cid, user, "quote", "tenders", tid, note=f"bid={bid_value}")
    return {"ok": True, "stage": "Quoted"}


# ================================================================== #
# 2.  Won → Project (carry forward BOQ + vendor picks) / Lost          #
# ================================================================== #
@router.post("/c/{cid}/pretender/{tid}/won")
async def mark_won(cid: str, tid: str, body: dict = Body(...), user=Depends(current_user)):
    """Convert a Quoted tender into a Project. Carries BOQ + vendor picks."""
    require(user, cid, "M2", "edit")
    t = await _get(cid, tid)
    _enforce_stage(t, "Quoted")
    if t.get("project_id"):
        raise HTTPException(400, "Tender already linked to a project")
    # Delegate to existing /award flow for baseline project + budget + BG etc.
    from flows_b import tender_award
    proj = await tender_award(cid, tid, body=body, user=user)
    # Carry BOQ + vendor picks to the project — stored on project doc + copy into a project_boq collection
    boq = t.get("boq") or []
    carried = []
    for it in boq:
        carried.append({
            "id": uid()[:8], "project_id": proj["id"], "tender_item_id": it["id"],
            "code": it.get("code"), "desc": it.get("desc"), "uom": it.get("uom"), "qty": it.get("qty"),
            "tender_rate": it.get("locked_rate"), "tender_vendor_id": it.get("locked_vendor_id"),
            "neg_rate": None, "neg_vendor_id": None,
            "status": "Open",  # Open | Negotiating | Awarded | Ordered
        })
    if carried:
        await col(cid, "project_boq").insert_many(carried)
    await col(cid, "projects").update_one({"id": proj["id"]}, {"$set": {"has_project_boq": True}})
    await audit(cid, user, "pretender_won", "tenders", tid, note=f"project={proj['id']}")
    return proj


@router.post("/c/{cid}/pretender/{tid}/lost")
async def mark_lost(cid: str, tid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M1", "edit")
    t = await _get(cid, tid)
    _enforce_stage(t, "Quoted")
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(400, "Reason is required")
    patch = {"stage": "Lost", "lost_reason": reason, "competitor": body.get("competitor"),
             "l1_value": num(body.get("l1_value")), "l1_rates": body.get("l1_rates")}
    await update_record(cid, "tenders", tid, patch, user, force=True)
    await audit(cid, user, "pretender_lost", "tenders", tid, note=reason)
    return {"ok": True}


# ================================================================== #
# Pipeline summary                                                     #
# ================================================================== #
@router.get("/c/{cid}/pretender/pipeline")
async def pipeline(cid: str, user=Depends(current_user)):
    require(user, cid, "M1", "view")
    f = scope_filter(user, "tenders")
    rows = await col(cid, "tenders").find(f, {"_id": 0, "stage": 1}).to_list(5000)
    counts = {s: 0 for s in STAGES}
    for r in rows:
        counts[r.get("stage") or "Draft"] = counts.get(r.get("stage") or "Draft", 0) + 1
    return {"stages": STAGES, "counts": counts}


# ================================================================== #
# Post-award: project BOQ Studio (re-use for second-round negotiation) #
# ================================================================== #
@router.get("/c/{cid}/projects/{pid}/boq-studio/matrix")
async def project_matrix(cid: str, pid: str, user=Depends(current_user)):
    require(user, cid, "M4", "view")
    items = await col(cid, "project_boq").find({"project_id": pid}, {"_id": 0}).to_list(2000)
    quotes = await col(cid, "project_quotes").find({"project_id": pid}, {"_id": 0}).to_list(5000)
    rounds = sorted({q["round"] for q in quotes}) or [1]
    vendor_order = []
    seen = set()
    for q in sorted(quotes, key=lambda x: (x["round"], x.get("created_at") or "")):
        if q["vendor_id"] not in seen:
            seen.add(q["vendor_id"])
            vendor_order.append({"vendor_id": q["vendor_id"], "vendor_name": q.get("vendor_name")})
    qmap = {(q["item_id"], q["vendor_id"], q["round"]): q for q in quotes}
    columns = [{"key": f"{v['vendor_id']}:{rnd}", "vendor_id": v["vendor_id"],
                "vendor_name": v["vendor_name"], "round": rnd, "label": f"{v['vendor_name']} · N{rnd}"}
               for rnd in rounds for v in vendor_order]
    rows = []
    for it in items:
        row = {"item": it, "cells": {}}
        for c in columns:
            q = qmap.get((it["id"], c["vendor_id"], c["round"]))
            row["cells"][c["key"]] = {"rate": q.get("rate") if q else None,
                                       "status": (q or {}).get("status", "-")}
        rows.append(row)
    return {"items": items, "columns": columns, "rows": rows, "rounds": rounds, "vendors": vendor_order}


@router.post("/c/{cid}/projects/{pid}/boq-studio/send-rfq")
async def project_send_rfq(cid: str, pid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M4", "edit")
    proj = await col(cid, "projects").find_one({"id": pid}, {"_id": 0})
    if not proj:
        raise HTTPException(404, "Project not found")
    items_ids = set(body.get("item_ids") or [])
    all_items = await col(cid, "project_boq").find({"project_id": pid}, {"_id": 0}).to_list(2000)
    pick = [i for i in all_items if i["id"] in items_ids] if items_ids else all_items
    vendor_ids = body.get("vendor_ids") or []
    if not vendor_ids:
        raise HTTPException(400, "Choose at least one vendor")
    last = await col(cid, "project_quotes").find_one({"project_id": pid}, {"_id": 0, "round": 1}, sort=[("round", -1)])
    rnd = int(body.get("round") or ((last["round"] + 1) if last else 1))
    from flows_b import make_link, items_table
    from core import next_number
    rfq_no = await next_number(cid, "rfqs", "", d=now()[:10], prefix="RFQ")
    rfq_items = [{"desc": i["desc"], "uom": i["uom"], "qty": i["qty"]} for i in pick]
    rfq_doc = {"id": uid(), "number": rfq_no, "project_id": pid, "tender_id": proj.get("tender_id"),
               "title": proj.get("name"), "items": rfq_items, "due_date": body.get("due_date"),
               "status": "Sent", "sent_at": now(), "vendor_ids": vendor_ids, "round": rnd, "negotiation": True}
    await col(cid, "rfqs").insert_one({**rfq_doc, "created_at": now(), "updated_at": now(), "created_by": user.get("name", "")})
    comp = await _company(cid)
    out = []
    for vid in vendor_ids:
        v = await col(cid, "vendors").find_one({"id": vid}, {"_id": 0}) or {}
        link = await make_link(cid, "rfq", rfq_doc["id"], vid, user)
        row = {"vendor_id": vid, "vendor_name": v.get("name"), "url": link["url"], "token": link["token"]}
        if body.get("send_email", True) and v.get("email"):
            html = email_shell(comp, f"Negotiation RFQ {rfq_no} · {proj.get('name')}",
                               f"<p>Dear {escape(v.get('name',''))},</p>"
                               f"<p>Please share your <b>revised</b> best quote for project <b>{escape(proj.get('name') or '')}</b>. Keep subject reference <b>{rfq_no}</b>.</p>"
                               + items_table(rfq_items)
                               + f"<p><a href=\"{link['url']}\">Submit online</a></p>")
            await send_email(cid, to=v["email"], subject=f"{rfq_no} - Negotiation", html=html,
                             entity="rfqs", entity_id=rfq_doc["id"], vendor_id=vid, user=user)
        for i in pick:
            await col(cid, "project_quotes").update_one(
                {"project_id": pid, "item_id": i["id"], "vendor_id": vid, "round": rnd},
                {"$setOnInsert": {"id": uid(), "project_id": pid, "item_id": i["id"], "vendor_id": vid,
                                   "vendor_name": v.get("name"), "round": rnd, "rate": None,
                                   "rfq_id": rfq_doc["id"], "status": "Invited", "created_at": now()}},
                upsert=True,
            )
        out.append(row)
    return {"ok": True, "rfq_id": rfq_doc["id"], "round": rnd, "vendors": out}


@router.post("/c/{cid}/projects/{pid}/boq-studio/quote")
async def project_set_quote(cid: str, pid: str, body: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "M4", "edit")
    item_id = body.get("item_id"); vendor_id = body.get("vendor_id")
    rnd = int(body.get("round") or 1); rate = num(body.get("rate"))
    if not item_id or not vendor_id:
        raise HTTPException(400, "item_id and vendor_id required")
    v = await col(cid, "vendors").find_one({"id": vendor_id}, {"_id": 0}) or {}
    await col(cid, "project_quotes").update_one(
        {"project_id": pid, "item_id": item_id, "vendor_id": vendor_id, "round": rnd},
        {"$set": {"rate": rate, "status": "Received", "source": body.get("source") or "manual",
                   "vendor_name": v.get("name"), "updated_at": now()},
          "$setOnInsert": {"id": uid(), "project_id": pid, "item_id": item_id,
                             "vendor_id": vendor_id, "round": rnd, "created_at": now()}},
        upsert=True,
    )
    return {"ok": True}


@router.post("/c/{cid}/projects/{pid}/boq-studio/award")
async def project_award(cid: str, pid: str, body: dict = Body(...), user=Depends(current_user)):
    """Mark a vendor+rate as the awarded choice for a project_boq item (pre-PO)."""
    require(user, cid, "M4", "edit")
    item_id = body.get("item_id"); vendor_id = body.get("vendor_id")
    rate = num(body.get("rate"))
    r = await col(cid, "project_boq").update_one(
        {"id": item_id, "project_id": pid},
        {"$set": {"neg_rate": rate, "neg_vendor_id": vendor_id, "status": "Awarded",
                   "awarded_at": now(), "awarded_by": user.get("name")}},
    )
    if not r.matched_count:
        raise HTTPException(404, "Project BOQ item not found")
    return {"ok": True}


@router.post("/c/{cid}/projects/{pid}/boq-studio/create-po")
async def project_create_po(cid: str, pid: str, body: dict = Body(...), user=Depends(current_user)):
    """Draft a PO from all Awarded BOQ items of a single vendor."""
    require(user, cid, "M4", "edit")
    vendor_id = body.get("vendor_id")
    if not vendor_id:
        raise HTTPException(400, "vendor_id required")
    items = await col(cid, "project_boq").find(
        {"project_id": pid, "neg_vendor_id": vendor_id, "status": "Awarded"}, {"_id": 0}
    ).to_list(500)
    if not items:
        raise HTTPException(400, "No awarded items for this vendor on this project")
    v = await col(cid, "vendors").find_one({"id": vendor_id}, {"_id": 0}) or {}
    po_items = []
    subtotal = 0
    for it in items:
        amt = round(num(it["qty"]) * num(it["neg_rate"]), 2)
        subtotal += amt
        po_items.append({"desc": it["desc"], "uom": it["uom"], "qty": num(it["qty"]),
                          "rate": num(it["neg_rate"]), "amount": amt,
                          "project_boq_item_id": it["id"]})
    gst_rate = num(body.get("gst_rate") or 18)
    gst_amount = round(subtotal * gst_rate / 100, 2)
    total = round(subtotal + gst_amount, 2)
    po_doc = {"vendor_id": vendor_id, "vendor_name": v.get("name"), "project_id": pid,
              "items": po_items, "subtotal": subtotal, "gst_rate": gst_rate,
              "gst_amount": gst_amount, "total": total,
              "payment_terms": body.get("payment_terms") or "30 days",
              "delivery_date": body.get("delivery_date"), "status": "Draft",
              "source": "BOQ Studio"}
    po = await create_record(cid, "pos", po_doc, user)
    for it in items:
        await col(cid, "project_boq").update_one(
            {"id": it["id"], "project_id": pid},
            {"$set": {"status": "Ordered", "po_id": po["id"]}},
        )
    await audit(cid, user, "boq_studio_po", "projects", pid, note=f"PO {po['id']} to vendor {vendor_id}")
    return po


# ================================================================== #
# Project timeline — chain of linked entities                          #
# ================================================================== #
@router.get("/c/{cid}/projects/{pid}/timeline")
async def project_timeline(cid: str, pid: str, user=Depends(current_user)):
    """Chain: tender → NIT/BOQ → RFQs → inbox emails → POs → GRNs → RA bills."""
    require(user, cid, "M2", "view")
    events = []
    proj = await col(cid, "projects").find_one({"id": pid}, {"_id": 0}) or {}
    tid = proj.get("tender_id")
    if tid:
        t = await col(cid, "tenders").find_one({"id": tid}, {"_id": 0})
        if t:
            events.append({"at": t.get("created_at"), "kind": "tender_created",
                           "title": f"Tender {t.get('tender_no')} created", "ref": f"/tenders/{tid}"})
            for k, label in [("nit_file_id", "NIT uploaded"), ("boq_file_id", "BOQ uploaded"),
                              ("locked_at", "Costing locked"), ("quoted_at", "Tender quoted")]:
                if t.get(k):
                    events.append({"at": t.get(k) if "_at" in k else t.get("updated_at"),
                                    "kind": k, "title": label, "ref": f"/tenders/{tid}"})
    for reg, icon, title_fn in [("rfqs", "mail", lambda r: f"RFQ {r.get('number')}"),
                                  ("pos", "shopping-cart", lambda r: f"PO {r.get('number')} · ₹{num(r.get('total')):,.0f}"),
                                  ("grns", "package", lambda r: f"GRN {r.get('number')}"),
                                  ("ra_bills", "receipt", lambda r: f"RA Bill {r.get('number')} · ₹{num(r.get('total')):,.0f}"),
                                  ("invoices", "file-text", lambda r: f"Invoice {r.get('number')}")]:
        cur = col(cid, reg).find({"project_id": pid}, {"_id": 0}).sort("created_at", 1)
        async for r in cur:
            events.append({"at": r.get("created_at"), "kind": reg, "title": title_fn(r), "ref": f"/m/{reg}", "id": r.get("id")})
    # Inbox emails matched to this project or to any of its RFQs
    emails = await col(cid, "inbox_emails").find({"project_id": pid}, {"_id": 0, "body": 0}).to_list(200)
    for e in emails:
        events.append({"at": e.get("received_at"), "kind": "inbox_email",
                        "title": f"Email · {e.get('from')} · {(e.get('subject') or '')[:50]}",
                        "ref": None, "id": e.get("id")})
    events.sort(key=lambda x: x.get("at") or "")
    return {"events": events}
