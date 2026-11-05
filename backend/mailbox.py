"""
Connected vendor mailboxes (IMAP) and inbound email timeline.

Flow:
  1. Admin saves an IMAP config (host, port, user, password, ssl).
  2. Scheduled or manual sync pulls new messages via UID > last_uid.
  3. Each message is parsed, matched to a vendor (by sender domain / email),
     to an RFQ (by token / #JKEE-RFQ-NNN), and to a project (via RFQ or PO).
  4. Matched email is stored in `co_<cid>_inbox_emails` and shows up in the
     project's timeline + the vendor's timeline.

Note: credentials are stored in the mailbox document; this is a self-hosted ERP
so admins control the DB. Passwords are never returned to the API.
"""
from __future__ import annotations

import email
import imaplib
import re
from datetime import datetime, timezone
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException

from core import col, current_user, db, now, require, uid

router = APIRouter(prefix="/api")

RFQ_RX = re.compile(r"(JKEE|JKIC)-[A-Z]{2}-\d{4}-RFQ\d+", re.IGNORECASE)
TOKEN_RX = re.compile(r"\btoken[:=\s]*([A-Za-z0-9]{8,})", re.IGNORECASE)


def _decode(s):
    if not s:
        return ""
    if isinstance(s, bytes):
        try:
            return s.decode("utf-8", errors="replace")
        except Exception:
            return s.decode("latin-1", errors="replace")
    parts = decode_header(s)
    out = []
    for text, enc in parts:
        if isinstance(text, bytes):
            try:
                out.append(text.decode(enc or "utf-8", errors="replace"))
            except Exception:
                out.append(text.decode("utf-8", errors="replace"))
        else:
            out.append(text)
    return "".join(out)


def _body(msg) -> str:
    """Extract a plain-text body. Falls back to HTML stripped of tags."""
    if msg.is_multipart():
        text_parts, html_parts = [], []
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = (part.get("Content-Disposition") or "")
            if "attachment" in disp:
                continue
            try:
                payload = part.get_payload(decode=True)
            except Exception:
                continue
            if not payload:
                continue
            charset = part.get_content_charset() or "utf-8"
            try:
                text = payload.decode(charset, errors="replace")
            except Exception:
                text = payload.decode("utf-8", errors="replace")
            (text_parts if ctype == "text/plain" else html_parts if ctype == "text/html" else []).append(text)
        if text_parts:
            return "\n".join(text_parts)[:20000]
        if html_parts:
            return re.sub(r"<[^>]+>", " ", "\n".join(html_parts))[:20000]
        return ""
    try:
        payload = msg.get_payload(decode=True)
        charset = msg.get_content_charset() or "utf-8"
        return (payload or b"").decode(charset, errors="replace")[:20000]
    except Exception:
        return ""


async def _match(cid: str, sender: str, subject: str, body: str) -> dict:
    sender_email = parseaddr(sender)[1].lower()
    vendor = None
    if sender_email:
        v = await col(cid, "vendors").find_one(
            {"$or": [{"email": {"$regex": f"^{re.escape(sender_email)}$", "$options": "i"}},
                     {"contact_email": {"$regex": f"^{re.escape(sender_email)}$", "$options": "i"}}]},
            {"_id": 0},
        )
        if not v and "@" in sender_email:
            domain = sender_email.split("@", 1)[1]
            v = await col(cid, "vendors").find_one({"email": {"$regex": f"@{re.escape(domain)}$", "$options": "i"}}, {"_id": 0})
        vendor = v
    rfq = None
    rfq_no = None
    m = RFQ_RX.search(f"{subject} {body}")
    if m:
        rfq_no = m.group(0).upper()
        rfq = await col(cid, "rfqs").find_one({"number": rfq_no}, {"_id": 0})
    if not rfq:
        tm = TOKEN_RX.search(f"{subject} {body}")
        if tm:
            link = await db.vendor_links.find_one({"token": tm.group(1)}, {"_id": 0})
            if link and link.get("rfq_id"):
                rfq = await col(cid, "rfqs").find_one({"id": link["rfq_id"]}, {"_id": 0})
    project_id = (rfq or {}).get("project_id") or None
    if not project_id and vendor:
        po = await col(cid, "pos").find_one({"vendor_id": vendor.get("id")}, {"_id": 0, "project_id": 1},
                                             sort=[("created_at", -1)])
        if po:
            project_id = po.get("project_id")
    return {"vendor_id": (vendor or {}).get("id"), "vendor_name": (vendor or {}).get("name"),
            "rfq_id": (rfq or {}).get("id"), "rfq_number": rfq_no or (rfq or {}).get("number"),
            "project_id": project_id}


async def _mailbox_safe(mb):
    return {k: mb[k] for k in mb if k not in ("password", "_id")}


# ---------------- API ---------------- #

@router.get("/c/{cid}/mailboxes")
async def list_mailboxes(cid: str, user=Depends(current_user)):
    require(user, cid, "ADMIN", "view")
    items = await db.mailboxes.find({"company_id": cid}, {"_id": 0, "password": 0}).to_list(50)
    return items


@router.post("/c/{cid}/mailboxes")
async def save_mailbox(cid: str, data: dict = Body(...), user=Depends(current_user)):
    require(user, cid, "ADMIN", "edit")
    payload = {
        "id": data.get("id") or uid(),
        "company_id": cid,
        "name": data.get("name") or "Vendor inbox",
        "host": data["host"],
        "port": int(data.get("port") or 993),
        "user": data["user"],
        "password": data.get("password") or data.get("app_password") or "",
        "ssl": bool(data.get("ssl", True)),
        "folder": data.get("folder") or "INBOX",
        "active": bool(data.get("active", True)),
        "last_uid": data.get("last_uid") or 0,
        "status": "Configured",
        "last_error": None,
        "updated_at": now(),
    }
    await db.mailboxes.update_one({"id": payload["id"], "company_id": cid}, {"$set": payload}, upsert=True)
    return await _mailbox_safe(payload)


@router.delete("/c/{cid}/mailboxes/{mid}")
async def delete_mailbox(cid: str, mid: str, user=Depends(current_user)):
    require(user, cid, "ADMIN", "edit")
    await db.mailboxes.delete_one({"id": mid, "company_id": cid})
    return {"ok": True}


@router.post("/c/{cid}/mailboxes/{mid}/sync")
async def sync_mailbox(cid: str, mid: str, limit: int = 50, user=Depends(current_user)):
    require(user, cid, "ADMIN", "edit")
    mb = await db.mailboxes.find_one({"id": mid, "company_id": cid})
    if not mb:
        raise HTTPException(404, "Mailbox not found")
    if not mb.get("active"):
        return {"ok": False, "reason": "Mailbox paused", "ingested": 0}
    ingested, errors = await _run_sync(mb, limit=limit)
    await db.mailboxes.update_one(
        {"_id": mb["_id"]},
        {"$set": {"last_sync_at": now(), "status": "Error" if errors else "Idle",
                  "last_error": errors[0] if errors else None}},
    )
    return {"ok": not errors, "ingested": ingested, "errors": errors[:3]}


@router.get("/c/{cid}/inbox")
async def list_inbox(cid: str, project_id: Optional[str] = None, vendor_id: Optional[str] = None,
                     limit: int = 200, user=Depends(current_user)):
    require(user, cid, "ADMIN", "view")
    f = {}
    if project_id:
        f["project_id"] = project_id
    if vendor_id:
        f["vendor_id"] = vendor_id
    rows = await col(cid, "inbox_emails").find(f, {"_id": 0, "body": 0}).sort("received_at", -1).to_list(limit)
    return rows


@router.get("/c/{cid}/inbox/{eid}")
async def get_inbox(cid: str, eid: str, user=Depends(current_user)):
    require(user, cid, "ADMIN", "view")
    r = await col(cid, "inbox_emails").find_one({"id": eid}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Not found")
    return r


# ---------------- IMAP worker ---------------- #

async def _run_sync(mb: dict, limit: int = 50):
    """Pull up to `limit` new messages after mb.last_uid and store them."""
    cid = mb["company_id"]
    ingested, errors = 0, []
    try:
        if mb.get("ssl", True):
            imap = imaplib.IMAP4_SSL(mb["host"], int(mb.get("port") or 993), timeout=15)
        else:
            imap = imaplib.IMAP4(mb["host"], int(mb.get("port") or 143), timeout=15)
        imap.login(mb["user"], mb["password"])
        imap.select(mb.get("folder", "INBOX"))
        last_uid = int(mb.get("last_uid") or 0)
        # UID SEARCH from last+1
        search = f"UID {last_uid + 1}:*" if last_uid else "ALL"
        typ, data = imap.uid("SEARCH", None, search)
        uids = (data[0] or b"").split()
        # Latest first, capped at `limit`
        uids = [int(u) for u in uids if int(u) > last_uid][-limit:]
        highest = last_uid
        for u in uids:
            typ, raw = imap.uid("FETCH", str(u), "(RFC822)")
            if typ != "OK" or not raw or not raw[0]:
                continue
            msg = email.message_from_bytes(raw[0][1])
            subject = _decode(msg.get("Subject"))
            sender = _decode(msg.get("From"))
            body = _body(msg)
            try:
                rcv = parsedate_to_datetime(msg.get("Date")).astimezone(timezone.utc).isoformat()
            except Exception:
                rcv = datetime.now(timezone.utc).isoformat()
            match = await _match(cid, sender, subject, body)
            doc = {
                "id": uid(),
                "mailbox_id": mb["id"],
                "uid": u,
                "from": sender,
                "subject": subject,
                "preview": (body or "")[:300],
                "body": body,
                "received_at": rcv,
                "created_at": now(),
                **match,
            }
            await col(cid, "inbox_emails").insert_one(doc)
            ingested += 1
            highest = max(highest, u)
        imap.close(); imap.logout()
        if highest > last_uid:
            await db.mailboxes.update_one({"_id": mb["_id"]}, {"$set": {"last_uid": highest}})
    except Exception as e:
        errors.append(str(e))
    return ingested, errors
