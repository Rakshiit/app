"""Demo seed: 2 companies, roles, users per role, seeded 33/11kV substation project. All records carry demo=True."""
from datetime import date, timedelta
from core import db, col, uid, now, hash_pw, build_ctx, logger
import registers as RG
import flows_b as FB

MODS = [f"M{i}" for i in range(1, 16)] + ["ADMIN"]
SENS = ["salary", "basic", "daily_wage", "rate", "margin_pct", "margin_amt", "bid_value", "total_cost", "landed_total", "gross", "net_pay", "total", "subtotal", "gst_amount", "std_rate", "last_po_rate", "hourly_cost", "sell", "cost", "amount_value", "amount", "freight", "net_amount", "grand_total", "taxable_value", "igst_amount", "cgst_amount", "sgst_amount"]


def lv(**kw):
    return {m: kw.get(m, "none") for m in MODS}


ROLES = {
    "Super Admin": ({m: "admin" for m in MODS}, []),
    "Admin": ({**{m: "edit" for m in MODS}, "ADMIN": "admin"}, []),
    "Director": ({**{m: "approve" for m in MODS}, "ADMIN": "view"}, []),
    "Tender Executive": (lv(M1="edit", M4="view", M13="edit", M14="view", M15="edit"), ["salary", "basic", "daily_wage", "gross", "net_pay"]),
    "Project Manager": (lv(M1="view", M2="approve", M3="edit", M4="approve", M5="approve", M6="approve", M7="approve", M8="view", M9="view", M10="edit", M11="view", M13="edit", M14="view", M15="edit"), ["salary", "basic", "gross", "net_pay"]),
    "Planning Engineer": (lv(M2="edit", M6="edit", M9="view", M13="edit", M14="view"), SENS),
    "Site Engineer": (lv(M2="view", M3="edit", M4="edit", M5="edit", M6="edit", M7="edit", M10="edit", M13="edit", M15="view"), SENS),
    "Accounts Head": (lv(M2="view", M3="approve", M4="view", M5="view", M7="approve", M8="approve", M9="approve", M11="view", M12="admin", M13="edit", M14="edit", M15="edit"), []),
    "Accounts Executive": (lv(M2="view", M4="view", M8="edit", M9="edit", M12="edit", M13="edit", M14="view"), ["salary", "basic", "margin_pct", "margin_amt"]),
    "HR Manager": (lv(M2="view", M3="approve", M13="edit", M14="edit", M15="edit"), ["rate", "margin_pct", "margin_amt", "bid_value", "total_cost", "landed_total"]),
    "Procurement": (lv(M1="view", M2="view", M4="edit", M5="edit", M13="edit", M14="view", M15="edit"), ["salary", "basic", "daily_wage", "gross", "net_pay", "margin_pct", "margin_amt"]),
    "Store": (lv(M2="view", M4="edit", M5="edit", M13="edit"), SENS),
    "Legal": (lv(M2="view", M10="edit", M13="edit", M14="view"), SENS),
    "Safety": (lv(M2="view", M6="view", M10="edit", M13="edit"), SENS),
    "Subcontractor Read-Only": (lv(M7="view"), SENS),
    "Client": (lv(), SENS),
    "Employee": (lv(M3="view", M13="view"), ["rate", "margin_pct", "margin_amt", "bid_value", "total_cost", "landed_total"]),
}
USERS = [("admin@jkeepl.in", "Arjun Kaul (Super Admin)", "Super Admin", "Admin@2026#"), ("director@jkeepl.in", "Rakesh Koul (MD)", "Director", None),
         ("tender@jkeepl.in", "Neha Raina (Tender)", "Tender Executive", None), ("pm@jkeepl.in", "Vikram Singh (PM)", "Project Manager", None),
         ("planning@jkeepl.in", "Asha Bhat (Planning)", "Planning Engineer", None), ("site@jkeepl.in", "Imran Lone (Site Engr)", "Site Engineer", None),
         ("accounts@jkeepl.in", "Sunil Gupta (Accounts Head)", "Accounts Head", None), ("accexec@jkeepl.in", "Ritu Sharma (Accounts Exec)", "Accounts Executive", None),
         ("hr@jkeepl.in", "Meena Dhar (HR)", "HR Manager", None), ("procurement@jkeepl.in", "Karan Mehta (Procurement)", "Procurement", None),
         ("store@jkeepl.in", "Bashir Ahmad (Store)", "Store", None), ("legal@jkeepl.in", "Adv. P. Sharma (Legal)", "Legal", None),
         ("safety@jkeepl.in", "Tariq Mir (Safety)", "Safety", None), ("client@demo.in", "JKPDD Client Officer", "Client", "Demo@2026#")]
DEMO_PW = "Demo@2026#"


def d(n):
    return (date.today() + timedelta(days=n)).isoformat()


async def seed():
    if await db.companies.count_documents({}) > 0:
        return
    logger.info("Seeding demo data ...")
    role_ids = {}
    for name, (mods, masked) in ROLES.items():
        rid = uid(); role_ids[name] = rid
        await db.roles.insert_one({"id": rid, "name": name, "modules": mods, "masked_fields": masked, "hidden_tabs": [], "system": True})
    A = {"id": uid(), "name": "JK Electric Engineers Pvt Ltd", "short_code": "JKEE", "default_state": "JK", "pan": "AABCJ1234K", "cin": "U31100JK2009PTC003012",
         "address": "Plot 14, Industrial Estate Rangreth, Srinagar, J&K 190007", "gstins": [{"state": "JK", "gstin": "01AABCJ1234K1Z5", "address": "Srinagar"},
                                                                                         {"state": "PB", "gstin": "03AABCJ1234K1Z1", "address": "Jalandhar"}, {"state": "HP", "gstin": "02AABCJ1234K1Z3", "address": "Shimla"}],
         "epf_no": "JKSRN0012345000", "esic_no": "19000123450001001", "pt_no": "-", "banks": [{"bank": "J&K Bank", "account": "0110010100001234", "ifsc": "JAKA0RANGRT", "bg_limit": 50000000},
                                                                                            {"bank": "State Bank of India", "account": "30012345678", "ifsc": "SBIN0004567", "bg_limit": 30000000}],
         "signatories": [{"name": "Rakesh Koul", "designation": "Managing Director"}], "tally_company": "JK Electric Engineers Pvt Ltd (2026-27)",
         "reply_to": "", "avg_turnover": 250000000, "theme": {"preset": "ocean-instinct", "primary": "#20309A", "surface": "#FFFFFF", "accent": "#BB232B"},
         "closed_periods": [], "demo": True, "created_at": now()}
    B = {"id": uid(), "name": "JK Infra & Civil Projects Pvt Ltd", "short_code": "JKIC", "default_state": "PB", "pan": "AACCJ5678L", "cin": "U45200PB2014PTC038811",
         "address": "SCO 22, Model Town, Jalandhar, Punjab 144003", "gstins": [{"state": "PB", "gstin": "03AACCJ5678L1Z9", "address": "Jalandhar"}],
         "epf_no": "PBJAL0067890000", "esic_no": "-", "banks": [{"bank": "Punjab National Bank", "account": "4433000100012345", "ifsc": "PUNB0443300", "bg_limit": 20000000}],
         "signatories": [{"name": "Harpreet Singh", "designation": "Director"}], "tally_company": "JK Infra & Civil (2026-27)", "avg_turnover": 90000000,
         "theme": {"preset": "higher-perspective", "primary": "#0B3048", "surface": "#F2F0E9", "accent": "#B9F12F"}, "closed_periods": [], "demo": True, "created_at": now()}
    await db.companies.insert_many([dict(A), dict(B)])
    users = {}
    for email, name, role, pw in USERS:
        u = {"id": uid(), "email": email, "name": name, "password_hash": hash_pw(pw or DEMO_PW), "roles": [role_ids[role]],
             "company_ids": ["*"] if role in ("Super Admin", "Director") else [A["id"], B["id"]] if role != "Client" else [], "scope": {},
             "is_super": role == "Super Admin", "delegations": [], "demo": True, "created_at": now()}
        users[role] = u
        await db.users.insert_one(dict(u))
    admin = await build_ctx(users["Super Admin"])
    cid = A["id"]
    C = lambda reg, data: RG.create_record(cid, reg, {**data, "demo": True}, admin)  # noqa

    async def approve(reg, rid, cc=cid):
        a = await RG.submit(cc, reg, rid, user=admin)
        for _ in a["levels"]:
            await RG.act(cc, a["id"], {"action": "approve", "remarks": "Demo approval"}, user=admin)

    # vault
    for cat, name, key, exp, ver in [("Registrations & Tax", "GST Registration Certificate", "gst", None, True), ("Registrations & Tax", "PAN Card", "pan", None, True),
                                     ("Licences", "Electrical Contractor Licence Class A", "elic", d(240), True), ("Licences", "ISO 9001:2015 Certificate", "iso", d(20), True),
                                     ("Registrations & Tax", "EPF Registration", "epf", None, True), ("Financial & Eligibility", "Audited Balance Sheet FY 2024-25 Turnover", "bs", None, True),
                                     ("Financial & Eligibility", "Solvency Certificate", "solv", d(6), False), ("Authorisations", "Power of Attorney - Tender Signing", "poa", d(150), True)]:
        await C("vault_docs", {"category": cat, "name": name, "doc_key": key, "version": 1, "issue_date": d(-300), "expiry_date": exp, "verified": ver})
    await C("vault_docs", {"category": "Licences", "name": "Electrical Contractor Licence Class A", "doc_key": "elic_old", "version": 0, "issue_date": d(-800), "expiry_date": d(-60), "verified": True, "superseded": True, "status": "Superseded"})
    for st, sk, r in [("JK", "Unskilled", 420), ("JK", "Semi-skilled", 520), ("JK", "Skilled", 620), ("JK", "Highly Skilled", 720), ("PB", "Unskilled", 450), ("PB", "Skilled", 560)]:
        await C("min_wages", {"state": st, "skill": sk, "daily_rate": r, "effective_from": "2026-04-01"})
    prods = {}
    for code, name, uom, rate, cat, rl in [("TRF-10", "Power Transformer 10 MVA 33/11kV", "Nos", 8500000, "Electrical", 0), ("VCB-33", "33kV Outdoor VCB", "Nos", 650000, "Electrical", 0),
                                          ("CTPT-33", "33kV CT/PT Set", "Set", 180000, "Electrical", 0), ("XLPE-300", "XLPE Cable 3C x 300 sqmm 11kV", "Mtr", 2400, "Cable", 200),
                                          ("ACSR-DOG", "ACSR Dog Conductor", "Km", 145000, "Conductor", 2), ("CRP-11", "Control & Relay Panel", "Nos", 420000, "Electrical", 0),
                                          ("GI-ES", "GI Earthing Strip 50x6", "Kg", 95, "Earthing", 300), ("CEM-43", "Cement OPC 43 Grade", "Bag", 410, "Civil", 100),
                                          ("TMT-12", "TMT Steel Fe500D 12mm", "MT", 62000, "Civil", 2), ("TWR-DA", "Lattice Tower DA Type", "Nos", 380000, "Structure", 0)]:
        p = await C("products", {"code": code, "name": name, "uom": uom, "std_rate": rate, "category": cat, "hsn": "8504", "gst_pct": 18, "reorder_level": rl, "reorder_qty": rl * 3})
        prods[code] = p
    vendors = []
    for name, gst, cat, st in [("Kashmir Power Equipments", "01AAACK1111A1Z1", "Electrical", "JK"), ("Punjab Cables Ltd", "03AAACP2222B1Z2", "Cable", "PB"),
                               ("Himalayan Steel Traders", "02AAACH3333C1Z3", "Civil", "HP"), ("Delhi Switchgear Co", "07AAACD4444D1Z4", "Electrical", "DL")]:
        vendors.append(await C("vendors", {"name": name, "gstin": gst, "category": cat, "state": st, "email": "delivered@resend.dev", "phone": "9876500000", "contact_person": "Sales Manager",
                                           "pan": gst[2:12], "bank_account": "XXXX1234", "ifsc": "HDFC0000123", "msme": "Yes", "rating": 4}))
    # tenders
    t1 = await C("tenders", {"tender_no": "JKPDD/EM-II/2026/045", "title": "Construction of 33/11kV, 2x10 MVA Substation at Ganderbal incl. 33kV line", "department": "JKPDD - Electric Maintenance & RE Wing",
                             "state": "JK", "location": "Ganderbal", "category": "EPC", "estimated_value": 28500000, "emd": 570000, "tender_fee": 5000, "bid_due_date": d(-75),
                             "prebid_date": d(-90), "min_turnover": 150000000, "required_documents": "GST certificate; PAN; Electrical contractor licence; ISO 9001; Audited balance sheet; Solvency certificate; Power of attorney",
                             "eligibility": "Class A electrical contractor, avg turnover 15 Cr (3 yrs), similar work 40%", "stage": "Identified", "source": "jktenders.gov.in",
                             "boq": [{"desc": "Supply & erection of 10 MVA power transformer", "uom": "Nos", "qty": 2, "rate": 8500000, "product_id": prods["TRF-10"]["id"]},
                                     {"desc": "33kV outdoor VCB with structure", "uom": "Nos", "qty": 4, "rate": 650000, "product_id": prods["VCB-33"]["id"]},
                                     {"desc": "Control & relay panels", "uom": "Nos", "qty": 3, "rate": 420000, "product_id": prods["CRP-11"]["id"]},
                                     {"desc": "11kV XLPE cable laying", "uom": "Mtr", "qty": 1200, "rate": 2400, "product_id": prods["XLPE-300"]["id"]},
                                     {"desc": "33kV line with ACSR Dog", "uom": "Km", "qty": 8, "rate": 145000, "product_id": prods["ACSR-DOG"]["id"]},
                                     {"desc": "Civil works - foundations & control room", "uom": "LS", "qty": 1, "rate": 3500000},
                                     {"desc": "Earthing system", "uom": "Kg", "qty": 2500, "rate": 95, "product_id": prods["GI-ES"]["id"]}],
                             "checklist": [{"name": "Technical bid", "done": True}, {"name": "Financial bid", "done": True}, {"name": "EMD", "done": True}]})
    await col(cid, "tenders").update_one({"id": t1["id"]}, {"$set": {"stage": "Go"}})
    cost = await FB.new_costing(cid, t1["id"], {"cost_type": "EPC"}, user=admin)
    items = cost["items"]
    for it in items:
        m = it["material"]; it.update(material=round(m * 0.62), labour=round(m * 0.08), subcontractor=round(m * 0.06), equipment=round(m * 0.03), overheads=round(m * 0.05), margin_pct=12)
    await RG.update_record(cid, "costings", cost["id"], {"items": items}, admin)
    await approve("costings", cost["id"])
    await FB.submit_bid(cid, t1["id"], {"emd_ref": "EMD/JKB/2026/118", "emd_bank": "J&K Bank"}, user=admin)
    proj = await FB.tender_award(cid, t1["id"], {"loa_no": "JKPDD/LOA/2026/221", "loa_date": d(-60), "wo_value": 26500000, "start_date": d(-60), "end_date": d(300),
                                                "state": "JK", "client": "JKPDD - Electric Maintenance & RE Wing", "client_gstin": "01AAAGJ0001A1ZX",
                                                "sites": ["Ganderbal Substation Yard", "33kV Line Section A (Kangan)"], "mob_advance": 1325000, "retention_pct": 5}, user=admin)
    pid = proj["id"]
    await col(cid, "projects").update_one({"id": pid}, {"$set": {"demo": True}})
    sites = await col(cid, "sites").find({"project_id": pid}, {"_id": 0}).to_list(10)
    wbs = await col(cid, "wbs").find({"project_id": pid, "level": 2}, {"_id": 0}).sort("code", 1).to_list(50)
    # extra WBS depth (levels 3) under civil
    civil = next((w for w in wbs if "Civil" in (w.get("name") or "")), wbs[0])
    for i, (nm, q, u) in enumerate([("Transformer plinth foundations", 2, "Nos"), ("Control room building", 1, "LS")], 1):
        await C("wbs", {"project_id": pid, "parent_id": civil["id"], "level": 3, "code": f"{civil['code']}.{i}", "name": nm, "uom": u, "qty": 0, "rate": 0, "start_date": d(-60), "end_date": d(120)})
    # other tenders
    t2 = await C("tenders", {"tender_no": "PSTCL/132kV/2026/17", "title": "132kV D/C Transmission Line Jalandhar - Kartarpur (18 km)", "department": "PSTCL", "state": "PB", "location": "Jalandhar",
                             "category": "EPC", "estimated_value": 126000000, "emd": 2520000, "bid_due_date": d(12), "prebid_date": d(3), "stage": "Identified", "min_turnover": 200000000,
                             "required_documents": "GST certificate; PAN; ISO 9001; Audited balance sheet; Tower erection experience certificate"})
    await FB.gonogo_request(cid, t2["id"], user=admin)
    await C("tenders", {"tender_no": "HPSEBL/OM/2026/08", "title": "O&M manpower for 12 nos 33/11kV substations, Shimla circle (2 yrs)", "department": "HPSEBL", "state": "HP",
                        "category": "O&M Manpower", "estimated_value": 18500000, "emd": 370000, "bid_due_date": d(25), "stage": "Identified"})
    await C("tenders", {"tender_no": "JKPDD/AMC/2026/12", "title": "AMC of 33kV switchyards Anantnag division", "department": "JKPDD", "state": "JK", "category": "AMC",
                        "estimated_value": 6400000, "emd": 128000, "bid_due_date": d(6), "stage": "Go"})
    await C("tenders", {"tender_no": "JKPDD/EM/2025/311", "title": "Augmentation of 66/11kV Substation Budgam", "department": "JKPDD", "state": "JK", "category": "EPC",
                        "estimated_value": 31000000, "emd": 620000, "bid_due_date": d(-120), "stage": "Lost", "lost_reason": "Price - L2", "competitor": "Valley Power Infra", "l1_value": 29150000})
    # employees
    emps = []
    for name, typ, des, sal, dw, skill, email in [("Vikram Singh", "Staff", "Project Manager", 120000, 0, "Highly Skilled", "pm@jkeepl.in"), ("Imran Lone", "Staff", "Site Engineer", 55000, 0, "Skilled", "site@jkeepl.in"),
                                                   ("Ghulam Nabi", "Labour", "Lineman", 0, 650, "Skilled", None), ("Mohd Shafi", "Labour", "Helper", 0, 450, "Unskilled", None),
                                                   ("Rajinder Kumar", "Labour", "Helper", 0, 400, "Unskilled", None), ("Farooq Ahmad", "Staff", "Supervisor", 32000, 0, "Skilled", "farooq@jkeepl.in")]:
        e = await C("employees", {"name": name, "emp_type": typ, "designation": des, "salary": sal, "basic": sal * 0.5, "daily_wage": dw, "state": "JK", "skill": skill, "email": email,
                                  "project_id": pid, "doj": d(-200), "status": "Active", "docs_verified": name != "Farooq Ahmad",
                                  "onboarding_stage": "Verified" if name != "Farooq Ahmad" else "Documents Pending",
                                  "onboarding_docs": [{"name": "Aadhaar", "mandatory": True, "verified": name != "Farooq Ahmad"}, {"name": "PAN", "mandatory": True, "verified": name != "Farooq Ahmad"},
                                                      {"name": "Bank details", "mandatory": True, "verified": name != "Farooq Ahmad"}, {"name": "Education certificates", "mandatory": False, "verified": False}]})
        emps.append(e)
    await db.users.update_one({"email": "pm@jkeepl.in"}, {"$set": {"employee_id": emps[0]["id"]}})
    await db.users.update_one({"email": "site@jkeepl.in"}, {"$set": {"employee_id": emps[1]["id"]}})
    await db.users.insert_one({"id": uid(), "email": "farooq@jkeepl.in", "name": "Farooq Ahmad", "password_hash": hash_pw(DEMO_PW), "roles": [role_ids["Employee"]], "company_ids": [cid],
                               "employee_id": emps[5]["id"], "onboarding_locked": True, "demo": True, "created_at": now()})
    prev_month = (date.today().replace(day=1) - timedelta(days=1))
    for e in emps:
        for day in range(1, 23):
            dt = prev_month.replace(day=day)
            if dt.weekday() == 6:
                continue
            await col(cid, "attendance").insert_one({"id": uid(), "employee_id": e["id"], "employee_name": e["name"], "date": dt.isoformat(), "status": "P" if day % 9 else "A",
                                                     "project_id": pid, "site_id": sites[0]["id"], "mode": "Supervisor", "demo": True, "created_at": now()})
    # procurement: rfq + quotes + PO + GRN
    rfq = await C("rfqs", {"title": "Cable & earthing material - Ganderbal", "project_id": pid, "site_id": sites[0]["id"], "due_date": d(5), "delivery_location": "Ganderbal Substation Yard",
                           "items": [{"product_id": prods["XLPE-300"]["id"], "desc": prods["XLPE-300"]["name"], "uom": "Mtr", "qty": 1200}, {"product_id": prods["GI-ES"]["id"], "desc": prods["GI-ES"]["name"], "uom": "Kg", "qty": 2500}]})
    for v, r1, r2, rev in [(vendors[1], 2350, 92, 1), (vendors[0], 2420, 90, 1), (vendors[1], 2310, 91, 2), (vendors[3], 2480, 97, 1)]:
        await C("quotes", {"rfq_id": rfq["id"], "vendor_id": v["id"], "vendor_name": v["name"], "revision": rev, "freight": 15000, "payment_terms": "30 days", "delivery_period": "3 weeks", "status": "Confirmed",
                           "items": [{"product_id": prods["XLPE-300"]["id"], "desc": prods["XLPE-300"]["name"], "qty": 1200, "rate": r1, "gst_pct": 18}, {"product_id": prods["GI-ES"]["id"], "desc": prods["GI-ES"]["name"], "qty": 2500, "rate": r2, "gst_pct": 18}]})
    await col(cid, "rfqs").update_one({"id": rfq["id"]}, {"$set": {"vendor_ids": [vendors[0]["id"], vendors[1]["id"], vendors[3]["id"]], "status": "Sent"}})
    q = await col(cid, "quotes").find_one({"rfq_id": rfq["id"], "vendor_id": vendors[1]["id"], "revision": 2}, {"_id": 0})
    po = await FB.create_po(cid, rfq["id"], {"quote_id": q["id"], "delivery_date": d(10)}, user=admin)
    await approve("pos", po["id"])
    await C("grns", {"po_id": po["id"], "vendor_id": vendors[1]["id"], "vendor_name": vendors[1]["name"], "project_id": pid, "site_id": None, "date": d(-20),
                     "items": [{"product_id": prods["XLPE-300"]["id"], "desc": prods["XLPE-300"]["name"], "qty_received": 800, "rate": 2310}, {"product_id": prods["GI-ES"]["id"], "desc": prods["GI-ES"]["name"], "qty_received": 2500, "rate": 91}]})
    await C("grns", {"vendor_id": vendors[2]["id"], "vendor_name": vendors[2]["name"], "project_id": pid, "site_id": sites[0]["id"], "date": d(-25),
                     "items": [{"product_id": prods["CEM-43"]["id"], "desc": prods["CEM-43"]["name"], "qty_received": 600, "rate": 410}, {"product_id": prods["TMT-12"]["id"], "desc": prods["TMT-12"]["name"], "qty_received": 12, "rate": 62000}]})
    st = await C("stock_transfers", {"project_id": pid, "from_location": "CENTRAL", "to_location": sites[0]["id"], "date": d(-15),
                                     "items": [{"product_id": prods["XLPE-300"]["id"], "desc": prods["XLPE-300"]["name"], "qty": 650}, {"product_id": prods["GI-ES"]["id"], "desc": prods["GI-ES"]["name"], "qty": 1200}]})
    await approve("stock_transfers", st["id"])
    # DPRs
    cable = next(w for w in wbs if "cable" in w["name"].lower())
    earth = next(w for w in wbs if "Earthing" in w["name"])
    civ = civil
    for k, (days, items, mats) in enumerate([(-12, [(civ, 0.25), (earth, 600)], [("CEM-43", 220), ("TMT-12", 4), ("GI-ES", 500)]), (-6, [(cable, 350), (earth, 400)], [("XLPE-300", 350), ("GI-ES", 400)])]):
        dpr = await C("dprs", {"project_id": pid, "site_id": sites[0]["id"], "date": d(days), "weather": "Clear", "manpower": 24, "remarks": "Work progressing as per plan",
                               "items": [{"wbs_id": w["id"], "wbs_name": w["name"], "qty": q} for w, q in items],
                               "materials": [{"product_id": prods[c]["id"], "desc": prods[c]["name"], "qty": q} for c, q in mats], "photos": []})
        await approve("dprs", dpr["id"])
    await C("dprs", {"project_id": pid, "site_id": sites[1]["id"], "date": d(-1), "manpower": 12, "remarks": "Tower foundation excavation", "items": [{"wbs_id": next(w for w in wbs if "33kV line" in w["name"])["id"], "wbs_name": "33kV line", "qty": 0.8}], "materials": []})
    # subcontractor
    sub = await C("subcontractors", {"name": "Valley Civil Works", "gstin": "01AAFFV5555E1Z5", "trade": "Civil", "email": "delivered@resend.dev", "phone": "9419000000", "state": "JK"})
    wo = await C("work_orders", {"subcontractor_id": sub["id"], "subcontractor_name": sub["name"], "project_id": pid, "date": d(-50), "retention_pct": 5, "advance": 200000, "gst_pct": 18,
                                 "items": [{"desc": "Transformer plinth foundation", "uom": "Nos", "qty": 2, "rate": 350000}, {"desc": "Control room civil works", "uom": "LS", "qty": 1, "rate": 1200000}]})
    await approve("work_orders", wo["id"])
    sb = await C("sub_bills", {"subcontractor_id": sub["id"], "subcontractor_name": sub["name"], "work_order_id": wo["id"], "project_id": pid, "date": d(-5), "retention_pct": 5, "advance_recovery": 50000,
                               "items": [{"desc": "Transformer plinth foundation", "qty": 1, "rate": 350000}]})
    await approve("sub_bills", sb["id"])
    # assets
    await C("equipment", {"name": "Hydra Crane 14T", "asset_code": "EQ-001", "type": "Crane", "hourly_cost": 1800, "project_id": pid, "status": "Deployed", "next_maintenance": d(9)})
    eq = await col(cid, "equipment").find_one({"asset_code": "EQ-001"}, {"_id": 0})
    await C("equipment_usage", {"equipment_id": eq["id"], "project_id": pid, "date": d(-10), "hours": 46})
    veh = await C("vehicles", {"reg_no": "JK01AB4321", "type": "Pickup", "project_id": pid, "status": "Deployed", "insurance_expiry": d(14), "fitness_expiry": d(200), "puc_expiry": d(4), "next_service": d(30)})
    await C("trips", {"vehicle_id": veh["id"], "project_id": pid, "date": d(-3), "from_place": "Srinagar Store", "to_place": "Ganderbal", "km": 42, "fuel_ltr": 6, "fuel_cost": 620, "toll_other": 0})
    await C("insurance", {"policy_no": "CAR/2026/77812", "insurance_type": "CAR", "insurer": "New India Assurance", "project_id": pid, "sum_insured": 26500000, "premium": 53000, "start_date": d(-58), "expiry_date": d(310), "status": "Active"})
    await C("insurance", {"policy_no": "WC/2026/1201", "insurance_type": "Workmen Compensation", "insurer": "ICICI Lombard", "project_id": pid, "sum_insured": 5000000, "premium": 28000, "start_date": d(-58), "expiry_date": d(25), "status": "Active"})
    # change order, NCR, incident, legal
    await C("change_orders", {"project_id": pid, "title": "Additional 11kV feeder bay", "value_change": 1850000, "time_extension_days": 30, "budget_change": 1500000, "budget_head": "Material", "date": d(-4), "reason": "Client request vide letter 112"})
    await C("ncrs", {"project_id": pid, "title": "Honeycombing in transformer plinth concrete", "category": "Quality", "severity": "Major", "subcontractor_id": sub["id"], "raised_by": "QA Engineer", "date": d(-9), "due_date": d(-2), "status": "Open"})
    await C("incidents", {"project_id": pid, "title": "Minor hand injury during cable pulling", "date": d(-8), "severity": "Minor", "injured": "Mohd Shafi", "action_taken": "First aid, toolbox talk held", "status": "Closed"})
    await C("checklists", {"name": "Daily Safety Checklist - Substation", "category": "Safety", "items": ["PPE worn by all", "Work permit displayed", "Earthing of equipment checked", "Fire extinguisher available", "Barricading done"]})
    await C("contracts", {"project_id": pid, "title": "Main EPC Contract - Ganderbal", "party": "JKPDD", "value": 26500000, "start_date": d(-60), "end_date": d(300), "status": "Active"})
    await C("correspondence", {"project_id": pid, "direction": "Inward", "subject": "Approval of transformer GTP and drawings", "party": "SE, JKPDD", "date": d(-5), "reply_due": d(2), "status": "Open"})
    await C("permits", {"project_id": pid, "title": "Forest NOC for 33kV line corridor", "authority": "Forest Dept J&K", "applied_on": d(-40), "expiry_date": d(160), "status": "Approved"})
    await C("drawings", {"project_id": pid, "drawing_no": "JKEE-GND-E-001", "title": "Single Line Diagram", "revision": "R0", "date": d(-50), "status": "Superseded", "superseded": True, "locked": True})
    await C("drawings", {"project_id": pid, "drawing_no": "JKEE-GND-E-001", "title": "Single Line Diagram", "revision": "R1", "date": d(-20), "status": "Approved for Construction"})
    await C("rfis", {"project_id": pid, "title": "Clarification on cable trench depth", "raised_to": "Client", "date": d(-7), "due_date": d(3), "status": "Open"})
    await C("hindrances", {"project_id": pid, "title": "ROW issue at tower location AP-7", "from_date": d(-18), "to_date": None, "impact_days": 18, "responsibility": "Client", "status": "Open"})
    await C("trainings", {"employee_id": emps[2]["id"], "employee_name": emps[2]["name"], "title": "Electrical Supervisor Licence", "issue_date": d(-700), "expiry_date": d(12)})
    await C("tasks", {"title": "Submit transformer GTP to client", "project_id": pid, "assignee_id": users["Project Manager"]["id"], "assignee": "Vikram Singh (PM)", "due_date": d(2), "priority": "High", "status": "Open",
                      "subtasks": [{"title": "Collect GTP from OEM", "done": True}, {"title": "Internal review", "done": False}]})
    await C("tasks", {"title": "Renew solvency certificate", "assignee_id": users["Accounts Head"]["id"], "assignee": "Sunil Gupta", "due_date": d(5), "priority": "Medium", "status": "Open", "subtasks": []})
    await C("claims", {"employee_id": emps[1]["id"], "employee_name": emps[1]["name"], "project_id": pid, "date": d(-2), "category": "Travel", "amount": 3450, "description": "Site visit travel Kangan"})
    for k, v in [("Sales", "Sales - Works Contract 18%"), ("Purchase", "Purchase - Materials 18%"), ("Payment", "J&K Bank Current A/c"), ("Receipt", "J&K Bank Current A/c"), ("Payroll", "Salaries & Wages"), ("Journal", "Insurance Expenses")]:
        await C("tally_mappings", {"map_type": "Voucher ledger", "erp_key": k, "tally_ledger": v})
    await C("tally_mappings", {"map_type": "Cost centre", "erp_key": proj["code"], "tally_ledger": proj["code"]})
    # client portal access
    await db.users.update_one({"email": "client@demo.in"}, {"$set": {"client_projects": [{"company_id": cid, "project_id": pid}]}})
    await db.users.update_one({"email": "site@jkeepl.in"}, {"$set": {"scope": {"project_ids": [pid]}}})
    # company B
    cb = B["id"]
    CB = lambda reg, data: RG.create_record(cb, reg, {**data, "demo": True}, admin)  # noqa
    await CB("tenders", {"tender_no": "PWD-PB/BLD/2026/33", "title": "Construction of Sub-divisional office building, Phagwara", "department": "PWD (B&R) Punjab", "state": "PB", "category": "Civil",
                         "estimated_value": 42000000, "emd": 840000, "bid_due_date": d(18), "stage": "Identified"})
    await CB("tenders", {"tender_no": "NHAI/PB/2026/09", "title": "Culverts and drainage works km 12-28", "department": "NHAI", "state": "PB", "category": "Civil", "estimated_value": 76000000, "emd": 1520000, "bid_due_date": d(9), "stage": "Go"})
    await CB("vendors", {"name": "Punjab Cement Depot", "gstin": "03AAPCD9999F1Z9", "category": "Civil", "state": "PB", "email": "delivered@resend.dev"})
    await CB("vault_docs", {"category": "Registrations & Tax", "name": "GST Registration Certificate", "doc_key": "gst", "version": 1, "verified": True})
    await CB("vault_docs", {"category": "Licences", "name": "PWD Contractor Enlistment Class I", "doc_key": "pwd", "version": 1, "expiry_date": d(28), "verified": True})
    logger.info("Seed complete")
