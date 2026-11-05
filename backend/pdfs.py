import io, hashlib
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet
import qrcode
from reportlab.platypus import Image as RLImage
from core import db, uid, now, APP_URL


def inr(v):
    try:
        v = float(v or 0)
    except (TypeError, ValueError):
        return str(v)
    neg, v = v < 0, abs(v)
    s = f"{v:.2f}"
    whole, dec = s.split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:]); head = head[:-2]
        if head:
            parts.insert(0, head)
        whole = ",".join(parts) + "," + tail
    return ("-" if neg else "") + "Rs " + whole + "." + dec


def ddmmyyyy(d):
    d = (d or "")[:10]
    return f"{d[8:10]}-{d[5:7]}-{d[0:4]}" if len(d) == 10 else d


async def register_doc(company, doc_type, number):
    code = hashlib.sha1(f"{company['id']}{doc_type}{number}{now()}".encode()).hexdigest()[:10].upper()
    await db.doc_verifications.insert_one({"id": uid(), "code": code, "company_id": company["id"], "company_name": company["name"],
                                           "doc_type": doc_type, "number": number, "at": now()})
    return code


def build_pdf(company, title, number, meta, sections, draft=False, verify_code=None, signatory=None):
    """sections: list of ("table", headers, rows, col_widths?) | ("para", text) | ("totals", [(label, value)]) | ("break",)"""
    theme = company.get("theme") or {}
    primary = colors.HexColor(theme.get("primary", "#20309A"))
    accent = colors.HexColor(theme.get("accent", "#BB232B"))
    buf = io.BytesIO()
    ss = getSampleStyleSheet()
    small = ss["BodyText"]; small.fontSize = 8.5; small.leading = 11

    def on_page(c, doc):
        w, h = A4
        c.setFillColor(primary); c.rect(0, h - 26 * mm, w, 26 * mm, fill=1, stroke=0)
        c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 14); c.drawString(15 * mm, h - 12 * mm, company.get("name", ""))
        c.setFont("Helvetica", 8)
        g = (company.get("gstins") or [{}])[0]
        c.drawString(15 * mm, h - 17 * mm, f"{company.get('address', '')}")
        c.drawString(15 * mm, h - 21 * mm, f"GSTIN: {g.get('gstin', '-')}  |  PAN: {company.get('pan', '-')}  |  CIN: {company.get('cin', '-')}")
        c.setFillColor(accent); c.rect(0, h - 27.5 * mm, w, 1.5 * mm, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#667085")); c.setFont("Helvetica", 7)
        c.drawString(15 * mm, 8 * mm, f"{number}  |  Generated {ddmmyyyy(now())} by JKEE EPC ERP  |  Page {doc.page}")
        if verify_code:
            c.drawRightString(w - 15 * mm, 8 * mm, f"Verify: {APP_URL}/verify/{verify_code}")
        if draft:
            c.saveState(); c.setFont("Helvetica-Bold", 90); c.setFillColor(colors.Color(0.85, 0.1, 0.1, alpha=0.12))
            c.translate(w / 2, h / 2); c.rotate(40); c.drawCentredString(0, 0, "DRAFT"); c.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=33 * mm, bottomMargin=16 * mm, leftMargin=15 * mm, rightMargin=15 * mm)
    st = []
    st.append(Paragraph(f"<b><font size=13 color='{theme.get('primary', '#20309A')}'>{title}</font></b>", ss["Title"]))
    mrows = [[Paragraph(f"<b>{k}</b>", small), Paragraph(str(v if v is not None else "-"), small)] for k, v in meta]
    if mrows:
        half = (len(mrows) + 1) // 2
        left, right = mrows[:half], mrows[half:] + [["", ""]] * (half - len(mrows[half:]))
        t = Table([l + r for l, r in zip(left, right)], colWidths=[30 * mm, 60 * mm, 30 * mm, 60 * mm])
        t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD3E1")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F2F4F7")), ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#F2F4F7"))]))
        st += [t, Spacer(1, 6 * mm)]
    for s in sections:
        if s[0] == "para":
            st += [Paragraph(s[1], small), Spacer(1, 3 * mm)]
        elif s[0] == "heading":
            st += [Paragraph(f"<b>{s[1]}</b>", ss["Heading4"])]
        elif s[0] == "break":
            st.append(PageBreak())
        elif s[0] == "table":
            data = [[Paragraph(f"<b>{h}</b>", small) for h in s[1]]] + [[Paragraph(str(c), small) for c in r] for r in s[2]]
            t = Table(data, colWidths=s[3] if len(s) > 3 else None, repeatRows=1)
            t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD3E1")), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEF1F6")),
                                   ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            st += [t, Spacer(1, 4 * mm)]
        elif s[0] == "totals":
            data = [[Paragraph(k, small), Paragraph(f"<b>{v}</b>", small)] for k, v in s[1]]
            t = Table(data, colWidths=[60 * mm, 45 * mm], hAlign="RIGHT")
            t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD3E1")), ("ALIGN", (1, 0), (1, -1), "RIGHT")]))
            st += [t, Spacer(1, 6 * mm)]
    # signature + QR
    sig = signatory or ((company.get("signatories") or [{}])[0].get("name") if company.get("signatories") else "Authorised Signatory")
    qr_cell = ""
    if verify_code:
        q = qrcode.make(f"{APP_URL}/verify/{verify_code}")
        qb = io.BytesIO(); q.save(qb, format="PNG"); qb.seek(0)
        qr_cell = RLImage(qb, width=24 * mm, height=24 * mm)
    stamp = Paragraph(f"For <b>{company.get('name')}</b><br/><br/><font color='{theme.get('primary', '#20309A')}'>[{'DRAFT - NOT SIGNED' if draft else 'Digitally approved'}]</font><br/>{sig}<br/>Authorised Signatory", small)
    t = Table([[qr_cell, stamp]], colWidths=[90 * mm, 90 * mm])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "BOTTOM"), ("ALIGN", (1, 0), (1, 0), "RIGHT")]))
    st += [Spacer(1, 8 * mm), t]
    doc.build(st, onFirstPage=on_page, onLaterPages=on_page)
    return buf.getvalue()
