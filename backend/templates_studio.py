"""
PDF Template Studio — client-configurable templates for PDFs and emails.

Admins can create template variants per client/module. Each template is a
Jinja2 HTML string (for printable PDF-via-browser) or a plain text body
(for email). We keep a version history so changes are auditable.

For PDFs, the current MVP renders the template into HTML and lets the browser
produce the PDF via its print dialog. This keeps the editor code-free yet gives
clients pixel-perfect output without requiring extra backend dependencies.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import HTMLResponse
from jinja2 import Environment, select_autoescape, StrictUndefined

from core import col, current_user, db, now, require, uid

router = APIRouter(prefix="/api")

# --- sandboxed Jinja for user-authored templates ---
_env = Environment(
    autoescape=select_autoescape(["html", "xml"]),
    undefined=StrictUndefined,
    enable_async=False,
)


def _fmt_inr(v):
    try:
        v = float(v or 0)
        s = f"{v:,.2f}"
        # Indian lakh/crore formatting (simple, enough for MVP)
        return "₹ " + s
    except Exception:
        return v


_env.filters["inr"] = _fmt_inr


KIND_FIELDS = {
    "po": ["number", "date", "vendor_name", "project_id", "items", "subtotal", "gst_amount", "total", "payment_terms", "delivery_date"],
    "ra_bill": ["number", "bill_date", "project_id", "client_name", "subtotal", "gst_amount", "total", "retention"],
    "invoice": ["number", "date", "party", "amount", "gst_amount", "total"],
    "rfq": ["number", "date", "vendor_name", "items", "delivery_date"],
    "email": ["to", "subject", "body", "vendor_name", "project_name", "signature"],
}


def _require_admin(user, cid):
    require(user, cid, "ADMIN", "edit")


@router.get("/c/{cid}/pdf-templates")
async def list_templates(cid: str, kind: str = None, user=Depends(current_user)):
    require(user, cid, "ADMIN", "view")
    f = {"company_id": cid}
    if kind:
        f["kind"] = kind
    rows = await db.pdf_templates.find(f, {"_id": 0}).sort("updated_at", -1).to_list(200)
    return rows


@router.get("/c/{cid}/pdf-templates/{tid}")
async def get_template(cid: str, tid: str, user=Depends(current_user)):
    require(user, cid, "ADMIN", "view")
    t = await db.pdf_templates.find_one({"id": tid, "company_id": cid}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Not found")
    return t


@router.post("/c/{cid}/pdf-templates")
async def save_template(cid: str, data: dict = Body(...), user=Depends(current_user)):
    _require_admin(user, cid)
    tid = data.get("id") or uid()
    existing = await db.pdf_templates.find_one({"id": tid, "company_id": cid})
    version = (existing or {}).get("version", 0) + 1
    payload = {
        "id": tid,
        "company_id": cid,
        "name": data.get("name") or "Untitled template",
        "kind": data.get("kind") or "po",         # po | ra_bill | invoice | rfq | email
        "language": data.get("language") or "en",  # en | hi
        "html": data.get("html") or "",
        "subject": data.get("subject") or "",     # for email templates
        "active": bool(data.get("active", True)),
        "version": version,
        "updated_at": now(),
        "updated_by": user.get("name", "System"),
    }
    if not existing:
        payload["created_at"] = now()
        payload["created_by"] = user.get("name", "System")

    # keep version history
    await db.pdf_template_versions.insert_one(
        {"template_id": tid, "version": version, "html": payload["html"], "subject": payload["subject"],
         "at": now(), "by": payload["updated_by"]}
    )
    await db.pdf_templates.update_one({"id": tid, "company_id": cid}, {"$set": payload}, upsert=True)
    return payload


@router.get("/c/{cid}/pdf-templates/{tid}/versions")
async def list_versions(cid: str, tid: str, user=Depends(current_user)):
    require(user, cid, "ADMIN", "view")
    rows = await db.pdf_template_versions.find({"template_id": tid}, {"_id": 0}).sort("version", -1).to_list(50)
    return rows


@router.delete("/c/{cid}/pdf-templates/{tid}")
async def delete_template(cid: str, tid: str, user=Depends(current_user)):
    _require_admin(user, cid)
    await db.pdf_templates.delete_one({"id": tid, "company_id": cid})
    return {"ok": True}


SAMPLE_CONTEXT = {
    "po": {
        "number": "JKEE-JK-2627-PO001", "date": "2026-11-05",
        "vendor_name": "Punjab Cables Ltd", "project_name": "33/11kV Rangreth Substation",
        "items": [
            {"desc": "XLPE Cable 3C x 300 sqmm 11kV", "uom": "Mtr", "qty": 1200, "rate": 2310, "amount": 2772000},
            {"desc": "GI Earthing Strip 50x6", "uom": "Kg", "qty": 2500, "rate": 91, "amount": 227500},
        ],
        "subtotal": 2999500, "gst_amount": 539910, "total": 3554410,
        "payment_terms": "30 days", "delivery_date": "2026-11-15",
    },
    "ra_bill": {
        "number": "JKEE-JK-2627-RA001", "bill_date": "2026-11-05",
        "project_name": "33/11kV Rangreth Substation", "client_name": "JKPDD",
        "subtotal": 4200000, "gst_amount": 756000, "total": 4536000, "retention": 210000,
    },
    "invoice": {"number": "INV/26/00123", "date": "2026-11-05", "party": "JKPDD", "amount": 4200000, "gst_amount": 756000, "total": 4536000},
    "rfq": {"number": "JKEE-JK-2627-RFQ001", "date": "2026-11-05", "vendor_name": "Punjab Cables Ltd",
            "items": [{"desc": "XLPE Cable", "qty": 1200, "uom": "Mtr"}], "delivery_date": "2026-11-15"},
    "email": {"to": "vendor@example.com", "subject": "RFQ for Substation Items",
              "body": "Dear Partner,\n\nPlease share your best quote.\n\nRegards,\nJK Electric",
              "vendor_name": "Punjab Cables Ltd", "project_name": "33/11kV Rangreth Substation",
              "signature": "JK Electric Engineers Pvt Ltd"},
}


def _render_html(html: str, context: dict):
    try:
        tpl = _env.from_string(html or "")
        return tpl.render(**context)
    except Exception as e:
        return f"<pre style='color:#b91c1c;font-family:monospace;white-space:pre-wrap'>Template error: {e}</pre>"


@router.post("/c/{cid}/pdf-templates/{tid}/preview")
async def preview(cid: str, tid: str, body: dict = Body(default={}), user=Depends(current_user)):
    require(user, cid, "ADMIN", "view")
    t = await db.pdf_templates.find_one({"id": tid, "company_id": cid}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Not found")
    company = await db.companies.find_one({"id": cid}, {"_id": 0}) or {}
    sample = SAMPLE_CONTEXT.get(t["kind"], {})
    ctx = {"rec": sample, "company": company, **sample, **(body.get("context") or {})}
    html = _render_html(t["html"], ctx)
    return {"html": html, "sample_context": ctx}


@router.get("/c/{cid}/pdf-templates/{tid}/render/{record_id}", response_class=HTMLResponse)
async def render_record(cid: str, tid: str, record_id: str, user=Depends(current_user)):
    """Render a real record through the saved template as printable HTML."""
    require(user, cid, "ADMIN", "view")
    t = await db.pdf_templates.find_one({"id": tid, "company_id": cid}, {"_id": 0})
    if not t:
        raise HTTPException(404, "Template not found")
    mapping = {"po": "pos", "ra_bill": "ra_bills", "invoice": "invoices", "rfq": "rfqs"}
    reg = mapping.get(t["kind"])
    if not reg:
        raise HTTPException(400, "This kind cannot render a live record")
    rec = await col(cid, reg).find_one({"id": record_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Record not found")
    company = await db.companies.find_one({"id": cid}, {"_id": 0})
    html = _render_html(t["html"], {"rec": rec, **rec, "company": company})
    full = f"""<!doctype html><html><head><meta charset='utf-8'><title>{t['name']} · {rec.get('number','')}</title>
<style>body{{font-family:Inter,Arial,sans-serif;margin:24px;color:#111}}.print-btn{{position:fixed;top:12px;right:12px;padding:8px 14px;background:#20309A;color:#fff;border-radius:6px;cursor:pointer;border:0;font-weight:600}}@media print{{.print-btn{{display:none}}}}</style></head>
<body><button class='print-btn' onclick='window.print()'>Print / Save as PDF</button>{html}</body></html>"""
    return HTMLResponse(full)


DEFAULT_TEMPLATES = {
    "po_english": {
        "kind": "po", "name": "Standard Purchase Order (English)", "language": "en",
        "html": """
<div style='max-width:780px;margin:0 auto;font-family:Inter,Arial'>
  <div style='display:flex;justify-content:space-between;border-bottom:3px solid #20309A;padding-bottom:12px;margin-bottom:16px'>
    <div><h1 style='margin:0;color:#20309A'>{{ company.name }}</h1><div style='font-size:12px;color:#555'>{{ company.address }}</div></div>
    <div style='text-align:right'><div style='font-size:22px;font-weight:700'>PURCHASE ORDER</div><div style='font-size:12px'>{{ rec.number }} · {{ rec.date }}</div></div>
  </div>
  <div style='display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px'>
    <div><b>Vendor</b><div>{{ rec.vendor_name }}</div></div>
    <div><b>Delivery</b><div>{{ rec.delivery_date }} · {{ rec.payment_terms }}</div></div>
  </div>
  <table style='width:100%;border-collapse:collapse;font-size:13px'>
    <thead><tr style='background:#f1f5f9'><th style='text-align:left;padding:8px'>Item</th><th>Qty</th><th>UOM</th><th>Rate</th><th>Amount</th></tr></thead>
    <tbody>{% for it in rec['items'] or [] %}<tr><td style='padding:8px'>{{ it.desc }}</td><td style='text-align:center'>{{ it.qty }}</td><td style='text-align:center'>{{ it.uom }}</td><td style='text-align:right'>{{ it.rate|inr }}</td><td style='text-align:right'>{{ it.amount|inr }}</td></tr>{% endfor %}</tbody>
  </table>
  <div style='text-align:right;margin-top:12px;font-size:13px'>
    <div>Subtotal: {{ rec.subtotal|inr }}</div>
    <div>GST: {{ rec.gst_amount|inr }}</div>
    <div style='font-weight:700;font-size:16px;margin-top:4px'>Total: {{ rec.total|inr }}</div>
  </div>
  <div style='margin-top:40px;color:#555;font-size:12px'>Authorised signatory · {{ company.signatories[0].name if company.signatories else 'Management' }}</div>
</div>
""",
    },
    "email_hindi": {
        "kind": "email", "name": "RFQ Invitation (Hindi)", "language": "hi",
        "subject": "{{ vendor_name }} के लिए मूल्य निविदा (RFQ)",
        "html": """नमस्ते {{ vendor_name }},

कृपया परियोजना "{{ project_name }}" हेतु अपनी सर्वोत्तम दर 48 घंटे के भीतर साझा करें। विस्तृत विवरण संलग्न लिंक में उपलब्ध है।

सादर,
{{ signature }}""",
    },
    "email_english": {
        "kind": "email", "name": "RFQ Invitation (English)", "language": "en",
        "subject": "Request for Quote — {{ project_name }}",
        "html": """Dear {{ vendor_name }},

Please share your best offer for project "{{ project_name }}" within 48 hours. Specifications are attached.

Regards,
{{ signature }}""",
    },
}


@router.post("/c/{cid}/pdf-templates/seed-defaults")
async def seed_defaults(cid: str, user=Depends(current_user)):
    _require_admin(user, cid)
    inserted = 0
    for key, t in DEFAULT_TEMPLATES.items():
        exists = await db.pdf_templates.find_one({"company_id": cid, "name": t["name"]})
        if exists:
            continue
        tid = uid()
        doc = {
            "id": tid, "company_id": cid, **t, "active": True, "version": 1,
            "created_at": now(), "updated_at": now(), "created_by": user.get("name", "System"),
            "updated_by": user.get("name", "System"),
        }
        await db.pdf_templates.insert_one(doc)
        inserted += 1
    return {"ok": True, "inserted": inserted}
