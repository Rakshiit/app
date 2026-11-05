"""Cross-module automation: stock, budget actuals, Tally vouchers, DPR->RA bill, etc."""
from datetime import date, timedelta
from fastapi import HTTPException
from core import db, col, uid, now, today, num, next_number

HEADS = ["Labour", "Material", "Subcontractor", "Equipment", "Overheads"]


async def post_cost(cid, project_id, head, amount, ref):
    if not project_id or not amount:
        return
    p = await col(cid, "projects").find_one({"id": project_id}, {"_id": 0, "budget": 1, "code": 1})
    if not p:
        return
    budget = p.get("budget") or {h: {"budget": 0, "actual": 0} for h in HEADS}
    budget.setdefault(head, {"budget": 0, "actual": 0})
    budget[head]["actual"] = round(num(budget[head].get("actual")) + num(amount), 2)
    await col(cid, "projects").update_one({"id": project_id}, {"$set": {"budget": budget}})
    await col(cid, "cost_postings").insert_one({"id": uid(), "project_id": project_id, "head": head, "amount": num(amount), "ref": ref, "at": now()})
    b = num(budget[head].get("budget"))
    if b and budget[head]["actual"] > b:
        await raise_alert(cid, f"Budget overrun: {head} on {p.get('code')}", f"Actual {budget[head]['actual']:.0f} exceeds budget {b:.0f}", "danger", "projects", project_id)


async def raise_alert(cid, title, message, severity="warning", entity=None, entity_id=None):
    key = f"{title}|{entity_id}"
    if await col(cid, "alerts").find_one({"key": key, "read": False}):
        return
    await col(cid, "alerts").insert_one({"id": uid(), "key": key, "title": title, "message": message, "severity": severity,
                                         "entity": entity, "entity_id": entity_id, "at": now(), "read": False})


async def add_voucher(cid, vtype, amount, ref_entity, ref_id, ref_no, project_id=None, party=None, narration=""):
    await col(cid, "vouchers").insert_one({
        "id": uid(), "voucher_type": vtype, "amount": round(num(amount), 2), "ref_entity": ref_entity, "ref_id": ref_id,
        "ref_no": ref_no, "project_id": project_id, "party": party, "narration": narration, "date": today(),
        "status": "Pending", "created_at": now(), "created_by": "System"})


async def stock_balance(cid, product_id, location):
    agg = await col(cid, "stock_ledger").aggregate([
        {"$match": {"product_id": product_id, "location": location}},
        {"$group": {"_id": None, "i": {"$sum": "$qty_in"}, "o": {"$sum": "$qty_out"}}}]).to_list(1)
    return (agg[0]["i"] - agg[0]["o"]) if agg else 0


async def stock_move(cid, product_id, location, qty_in=0, qty_out=0, rate=0, ref="", project_id=None, location_name=None):
    prod = await col(cid, "products").find_one({"id": product_id}, {"_id": 0}) or {}
    if qty_out:
        bal = await stock_balance(cid, product_id, location)
        if bal < qty_out:
            raise HTTPException(400, f"Insufficient stock of {prod.get('name', product_id)} at {location_name or location}: available {bal}, required {qty_out}")
    await col(cid, "stock_ledger").insert_one({
        "id": uid(), "product_id": product_id, "product_name": prod.get("name"), "uom": prod.get("uom"), "location": location,
        "location_name": location_name or ("Central Store" if location == "CENTRAL" else location), "qty_in": num(qty_in),
        "qty_out": num(qty_out), "rate": num(rate) or num(prod.get("std_rate")), "ref": ref, "project_id": project_id,
        "date": today(), "created_at": now()})
    if qty_out and location == "CENTRAL" and num(prod.get("reorder_level")):
        bal = await stock_balance(cid, product_id, "CENTRAL")
        if bal <= num(prod["reorder_level"]):
            open_req = await col(cid, "requisitions").find_one({"auto": True, "product_id": product_id, "status": {"$in": ["Draft", "Submitted"]}})
            if not open_req:
                await col(cid, "requisitions").insert_one({
                    "id": uid(), "number": await next_number(cid, "requisitions", prefix="MR"), "auto": True, "product_id": product_id,
                    "title": f"Auto reorder: {prod.get('name')}", "items": [{"product_id": product_id, "desc": prod.get("name"), "qty": num(prod.get("reorder_qty")) or num(prod["reorder_level"]) * 2, "uom": prod.get("uom")}],
                    "location": "CENTRAL", "date": today(), "status": "Draft", "created_at": now(), "created_by": "System (low stock)"})
                await raise_alert(cid, f"Low stock: {prod.get('name')}", f"Central balance {bal} at/below reorder level. Auto requisition created.", "warning", "products", product_id)


async def site_name(cid, site_id):
    s = await col(cid, "sites").find_one({"id": site_id}, {"_id": 0, "name": 1})
    return (s or {}).get("name", site_id)


async def project_progress(cid, pid):
    items = await col(cid, "wbs").find({"project_id": pid}, {"_id": 0}).to_list(2000)
    tw = tp = 0
    for w in items:
        q = num(w.get("qty"))
        if q <= 0:
            continue
        wt = num(w.get("weight")) or q * num(w.get("rate")) or 1
        tw += wt
        tp += wt * min(num(w.get("done_qty")) / q, 1)
    pct = round(tp * 100 / tw, 2) if tw else 0
    await col(cid, "projects").update_one({"id": pid}, {"$set": {"physical_pct": pct}})
    return pct


# ---------------- RA bill computation ----------------
async def compute_ra(cid, bill):
    pid = bill.get("project_id")
    proj = await col(cid, "projects").find_one({"id": pid}, {"_id": 0}) or {}
    errors, gross = [], 0.0
    for ln in bill.get("lines") or []:
        w = await col(cid, "wbs").find_one({"id": ln.get("wbs_id")}, {"_id": 0}) or {}
        prev = 0.0
        async for b in col(cid, "ra_bills").find({"project_id": pid, "id": {"$ne": bill.get("id")}, "status": {"$nin": ["Draft", "Rejected"]}}, {"_id": 0, "lines": 1}):
            prev += sum(num(x.get("current_qty")) for x in b.get("lines") or [] if x.get("wbs_id") == ln.get("wbs_id"))
        cur = num(ln.get("current_qty"))
        ln.update(description=w.get("name"), uom=w.get("uom"), rate=num(w.get("rate")), wo_qty=num(w.get("qty")),
                  certified_qty=num(w.get("done_qty")), previous_qty=prev, cumulative_qty=prev + cur, amount=round(cur * num(w.get("rate")), 2))
        if prev + cur > num(w.get("done_qty")) + 1e-6:
            errors.append(f"{w.get('code')} {w.get('name')}: cumulative {prev + cur} exceeds certified (DPR-approved) qty {num(w.get('done_qty'))}")
        if prev + cur > num(w.get("qty")) + 1e-6:
            errors.append(f"{w.get('code')} {w.get('name')}: cumulative {prev + cur} exceeds WO qty {num(w.get('qty'))}")
        gross += ln["amount"]
    esc = round(gross * num(bill.get("escalation_pct")) / 100, 2)
    billed_before = 0.0
    async for b in col(cid, "ra_bills").find({"project_id": pid, "id": {"$ne": bill.get("id")}, "status": {"$nin": ["Draft", "Rejected"]}}, {"_id": 0, "gross": 1}):
        billed_before += num(b.get("gross"))
    wo_value = num(proj.get("contract_value"))
    if wo_value and billed_before + gross > wo_value + 1:
        errors.append(f"Cumulative billing {billed_before + gross:,.0f} exceeds WO value (incl. approved change orders) {wo_value:,.0f}")
    taxable = gross + esc
    gst = round(taxable * num(bill.get("gst_pct", 18)) / 100, 2)
    ded = {k: round(gross * num(bill.get(k + "_pct")) / 100, 2) for k in ("retention", "mob_recovery", "tds", "gst_tds", "labour_cess")}
    total_ded = sum(ded.values()) + num(bill.get("other_deductions")) + num(bill.get("ld_amount"))
    bill.update(gross=round(gross, 2), escalation=esc, taxable=round(taxable, 2), gst=gst, invoice_total=round(taxable + gst, 2),
                **{k + "_amt": v for k, v in ded.items()}, total_deductions=round(total_ded, 2),
                net_payable=round(taxable + gst - total_ded, 2), previous_billed=round(billed_before, 2), errors=errors)
    return bill


async def before_save(cid, reg, d, before, user):
    items = d.get("items") or []
    if reg in ("pos", "quotes", "invoices", "work_orders", "requisitions", "rfqs"):
        sub = gst = 0.0
        for it in items:
            amt = num(it.get("qty")) * num(it.get("rate"))
            it["amount"] = round(amt, 2)
            sub += amt
            gst += amt * num(it.get("gst_pct", d.get("gst_pct", 18))) / 100
        d.update(subtotal=round(sub, 2), gst_amount=round(gst, 2), total=round(sub + gst + num(d.get("freight")), 2))
        if reg == "quotes":
            d["landed_total"] = d["total"]
    elif reg == "ra_bills":
        await compute_ra(cid, d)
    elif reg == "sub_bills":
        g = sum(num(i.get("qty")) * num(i.get("rate")) for i in items)
        ret = g * num(d.get("retention_pct")) / 100
        d.update(gross=round(g, 2), retention_amt=round(ret, 2),
                 net_amount=round(g - ret - num(d.get("advance_recovery")) - num(d.get("other_deductions")), 2))
    elif reg == "costings":
        tot = {h: 0.0 for h in HEADS}
        sell = 0.0
        for it in items:
            q = num(it.get("qty"))
            c = 0.0
            for h in HEADS:
                v = num(it.get(h.lower())) * q
                tot[h] += v
                c += v
            it["cost"] = round(c, 2)
            it["sell"] = round(c * (1 + num(it.get("margin_pct", d.get("margin_pct", 10))) / 100), 2)
            sell += it["sell"]
        cost = sum(tot.values())
        d.update(head_totals={k: round(v, 2) for k, v in tot.items()}, total_cost=round(cost, 2), bid_value=round(sell, 2),
                 margin_amt=round(sell - cost, 2), margin_pct_effective=round((sell - cost) * 100 / sell, 2) if sell else 0)
    elif reg == "wbs":
        d["amount"] = round(num(d.get("qty")) * num(d.get("rate")), 2)
    elif reg == "equipment_usage":
        eq = await col(cid, "equipment").find_one({"id": d.get("equipment_id")}, {"_id": 0}) or {}
        d["cost"] = round(num(d.get("hours")) * num(eq.get("hourly_cost")), 2)
    elif reg == "trips":
        d["cost"] = round(num(d.get("fuel_cost")) + num(d.get("toll_other")), 2)
    elif reg == "attendance" and d.get("date"):
        lk = await col(cid, "attendance_locks").find_one({"project_id": d.get("project_id") or "OFFICE", "month": d["date"][:7]})
        if lk:
            raise HTTPException(423, f"Attendance for {d['date'][:7]} is locked by {lk.get('locked_by')}")


async def validate_submit(cid, reg, rec):
    if reg == "ra_bills":
        rec = await compute_ra(cid, rec)
        await col(cid, "ra_bills").update_one({"id": rec["id"]}, {"$set": rec})
        if rec["errors"]:
            raise HTTPException(400, "Billing blocked: " + "; ".join(rec["errors"]))
        if not rec.get("lines"):
            raise HTTPException(400, "RA bill has no lines")
    if reg == "dprs" and not (rec.get("items") or rec.get("materials")):
        raise HTTPException(400, "DPR has no work items")
    if reg == "pos" and not rec.get("items"):
        raise HTTPException(400, "PO has no items")


async def after_create(cid, reg, d, user):
    pid = d.get("project_id")
    if reg == "grns":
        loc = d.get("site_id") or "CENTRAL"
        lname = await site_name(cid, loc) if loc != "CENTRAL" else "Central Store"
        val = 0.0
        for it in d.get("items") or []:
            q = num(it.get("qty_received", it.get("qty")))
            await stock_move(cid, it["product_id"], loc, qty_in=q, rate=it.get("rate"), ref=d.get("number"), project_id=pid, location_name=lname)
            val += q * num(it.get("rate"))
        if pid:
            await post_cost(cid, pid, "Material", val, d.get("number"))
        await add_voucher(cid, "Purchase", val * 1.18, "grns", d["id"], d.get("number"), pid, d.get("vendor_name"), "GRN purchase incl. GST")
        if d.get("po_id"):
            po = await col(cid, "pos").find_one({"id": d["po_id"]}, {"_id": 0})
            if po:
                for pit in po.get("items") or []:
                    for git in d.get("items") or []:
                        if git.get("product_id") == pit.get("product_id"):
                            pit["received_qty"] = num(pit.get("received_qty")) + num(git.get("qty_received", git.get("qty")))
                full = all(num(i.get("received_qty")) >= num(i.get("qty")) for i in po.get("items") or [])
                await col(cid, "pos").update_one({"id": po["id"]}, {"$set": {"items": po["items"], "delivery_status": "Delivered" if full else "Partially Delivered"}})
    elif reg == "equipment_usage":
        await post_cost(cid, pid, "Equipment", d.get("cost"), f"EQ usage {d.get('date')}")
    elif reg == "trips":
        await post_cost(cid, pid, "Equipment", d.get("cost"), f"Trip {d.get('date')}")
    elif reg == "insurance":
        await post_cost(cid, pid, "Overheads", d.get("premium"), f"Insurance {d.get('policy_no')}")
        await add_voucher(cid, "Journal", d.get("premium"), "insurance", d["id"], d.get("policy_no"), pid, d.get("insurer"), "Insurance premium")
    elif reg == "petty_cash":
        await post_cost(cid, pid, "Overheads", d.get("amount"), "Petty cash")
    elif reg == "receipts":
        for k in ("ra_bills", "invoices"):
            rid = d.get("ra_bill_id") if k == "ra_bills" else d.get("invoice_id")
            if rid:
                await col(cid, k).update_one({"id": rid}, {"$inc": {"received": num(d.get("amount"))}})
        await add_voucher(cid, "Receipt", d.get("amount"), "receipts", d["id"], d.get("number"), pid, d.get("client"), "Client receipt")
    elif reg == "sub_payments":
        if d.get("sub_bill_id"):
            await col(cid, "sub_bills").update_one({"id": d["sub_bill_id"]}, {"$inc": {"paid": num(d.get("amount"))}})
        await add_voucher(cid, "Payment", d.get("amount"), "sub_payments", d["id"], d.get("ref_no"), pid, d.get("subcontractor_name"), "Subcontractor payment")
    elif reg == "credit_notes":
        await add_voucher(cid, d.get("note_type") or "Credit Note", d.get("amount"), "credit_notes", d["id"], d.get("number"), pid, d.get("party"), d.get("reason", ""))
    elif reg in ("drawings", "vault_docs"):
        key = "drawing_no" if reg == "drawings" else "doc_key"
        if d.get(key):
            await col(cid, reg).update_many({key: d[key], "id": {"$ne": d["id"]}, "superseded": {"$ne": True}},
                                            {"$set": {"superseded": True, "locked": True, "status": "Superseded"}})
    elif reg == "attendance":
        pass


async def after_update(cid, reg, d, before, user):
    if reg == "bgs" and before and before.get("status") != d.get("status") and d.get("status") == "Released":
        pass


async def on_rejected(cid, reg, rid, remarks, user):
    if reg == "tenders":
        await col(cid, "tenders").update_one({"id": rid}, {"$set": {"stage": "No-Go", "nogo_reason": remarks}})


async def on_approved(cid, reg, d, user):
    pid = d.get("project_id")
    if reg == "tenders":
        await col(cid, "tenders").update_one({"id": d["id"]}, {"$set": {"stage": "Go", "go_approved_by": user.get("name")}})
    elif reg == "stock_transfers":
        fname = "Central Store" if d.get("from_location") == "CENTRAL" else await site_name(cid, d.get("from_location"))
        tname = "Central Store" if d.get("to_location") == "CENTRAL" else await site_name(cid, d.get("to_location"))
        for it in d.get("items") or []:
            await stock_move(cid, it["product_id"], d["from_location"], qty_out=num(it.get("qty")), ref=d.get("number"), project_id=pid, location_name=fname)
            await stock_move(cid, it["product_id"], d["to_location"], qty_in=num(it.get("qty")), ref=d.get("number"), project_id=pid, location_name=tname)
    elif reg == "dprs":
        sname = await site_name(cid, d.get("site_id"))
        for m in d.get("materials") or []:
            if m.get("product_id") and num(m.get("qty")):
                await stock_move(cid, m["product_id"], d.get("site_id"), qty_out=num(m["qty"]), ref=d.get("number"), project_id=pid, location_name=sname)
        lines = []
        for it in d.get("items") or []:
            if it.get("wbs_id") and num(it.get("qty")):
                await col(cid, "wbs").update_one({"id": it["wbs_id"]}, {"$inc": {"done_qty": num(it["qty"])}})
                lines.append(it)
        await project_progress(cid, pid)
        if lines:
            draft = await col(cid, "ra_bills").find_one({"project_id": pid, "status": "Draft"}, {"_id": 0})
            if not draft:
                proj = await col(cid, "projects").find_one({"id": pid}, {"_id": 0}) or {}
                n = await col(cid, "ra_bills").count_documents({"project_id": pid})
                draft = {"id": uid(), "number": await next_number(cid, "ra_bills", proj.get("state"), prefix="RA"), "project_id": pid,
                         "title": f"RA Bill {n + 1} - {proj.get('code')}", "ra_seq": n + 1, "bill_date": today(), "lines": [], "status": "Draft",
                         "gst_pct": 18, "retention_pct": proj.get("retention_pct", 5), "mob_recovery_pct": proj.get("mob_recovery_pct", 10 if proj.get("mob_advance") else 0),
                         "tds_pct": 2, "gst_tds_pct": 2, "labour_cess_pct": 1, "escalation_pct": 0, "client": proj.get("client"),
                         "created_at": now(), "created_by": "System (DPR approval)", "auto": True}
                await col(cid, "ra_bills").insert_one(dict(draft))
            for ln in lines:
                ex = next((x for x in draft["lines"] if x["wbs_id"] == ln["wbs_id"]), None)
                if ex:
                    ex["current_qty"] = num(ex["current_qty"]) + num(ln["qty"])
                    ex.setdefault("dpr_refs", []).append(d.get("number"))
                else:
                    draft["lines"].append({"wbs_id": ln["wbs_id"], "current_qty": num(ln["qty"]), "dpr_refs": [d.get("number")]})
            await compute_ra(cid, draft)
            await col(cid, "ra_bills").replace_one({"id": draft["id"]}, draft)
    elif reg == "sub_dprs":
        wo = await col(cid, "work_orders").find_one({"id": d.get("work_order_id")}, {"_id": 0})
        if wo:
            for it in d.get("items") or []:
                for w in wo.get("items") or []:
                    if w.get("desc") == it.get("desc"):
                        w["done_qty"] = num(w.get("done_qty")) + num(it.get("qty"))
            await col(cid, "work_orders").update_one({"id": wo["id"]}, {"$set": {"items": wo["items"]}})
    elif reg == "sub_bills":
        await post_cost(cid, pid, "Subcontractor", d.get("gross"), d.get("number"))
        await add_voucher(cid, "Purchase", d.get("net_amount"), "sub_bills", d["id"], d.get("number"), pid, d.get("subcontractor_name"), "Subcontractor bill")
    elif reg == "ra_bills":
        for ln in d.get("lines") or []:
            await col(cid, "wbs").update_one({"id": ln["wbs_id"]}, {"$set": {"billed_qty": num(ln.get("cumulative_qty"))}})
        proj = await col(cid, "projects").find_one({"id": pid}, {"_id": 0}) or {}
        inv = {"id": uid(), "number": await next_number(cid, "invoices", proj.get("state"), prefix="INV"), "project_id": pid, "ra_bill_id": d["id"],
               "date": today(), "client": proj.get("client"), "client_gstin": proj.get("client_gstin"), "taxable": d.get("taxable"), "gst_amount": d.get("gst"),
               "total": d.get("invoice_total"), "retention": d.get("retention_amt"), "mob_recovery": d.get("mob_recovery_amt"),
               "net_receivable": d.get("net_payable"), "status": "Issued", "submission_status": "Not Submitted", "created_at": now(), "created_by": "System"}
        await col(cid, "invoices").insert_one(dict(inv))
        await col(cid, "ra_bills").update_one({"id": d["id"]}, {"$set": {"invoice_id": inv["id"], "invoice_no": inv["number"]}})
        for k, lbl in (("tds_amt", "TDS"), ("gst_tds_amt", "GST TDS"), ("labour_cess_amt", "Labour Cess"), ("retention_amt", "Security Deposit / Retention")):
            if num(d.get(k)):
                await col(cid, "deductions").insert_one({"id": uid(), "project_id": pid, "ra_bill_id": d["id"], "ra_no": d.get("number"), "type": lbl,
                                                         "amount": d.get(k), "date": today(), "status": "Deducted", "created_at": now()})
        if num(d.get("mob_recovery_amt")):
            await col(cid, "mob_advances").update_many({"project_id": pid, "status": {"$ne": "Recovered"}}, {"$inc": {"recovered": num(d["mob_recovery_amt"])}})
            async for m in col(cid, "mob_advances").find({"project_id": pid}, {"_id": 0}):
                if num(m.get("recovered")) >= num(m.get("amount")):
                    await col(cid, "mob_advances").update_one({"id": m["id"]}, {"$set": {"status": "Recovered"}})
        await col(cid, "projects").update_one({"id": pid}, {"$inc": {"billed_value": num(d.get("gross"))}})
        await add_voucher(cid, "Sales", d.get("invoice_total"), "invoices", inv["id"], inv["number"], pid, proj.get("client"), f"RA bill {d.get('number')}")
    elif reg == "claims":
        await post_cost(cid, pid, "Overheads", d.get("amount"), d.get("number"))
        await add_voucher(cid, "Payment", d.get("amount"), "claims", d["id"], d.get("number"), pid, d.get("employee_name"), "Expense claim")
    elif reg in ("advances", "vendor_advances"):
        await add_voucher(cid, "Payment", d.get("amount"), reg, d["id"], d.get("number"), pid, d.get("employee_name") or d.get("vendor_name"), "Advance")
    elif reg == "change_orders":
        proj = await col(cid, "projects").find_one({"id": pid}, {"_id": 0}) or {}
        upd = {"contract_value": num(proj.get("contract_value")) + num(d.get("value_change"))}
        if num(d.get("time_extension_days")) and proj.get("end_date"):
            upd["end_date"] = (date.fromisoformat(proj["end_date"][:10]) + timedelta(days=int(num(d["time_extension_days"])))).isoformat()
        budget = proj.get("budget") or {}
        head = d.get("budget_head") or "Material"
        budget.setdefault(head, {"budget": 0, "actual": 0})
        budget[head]["budget"] = num(budget[head]["budget"]) + num(d.get("budget_change"))
        upd["budget"] = budget
        await col(cid, "projects").update_one({"id": pid}, {"$set": upd})
    elif reg == "payroll_runs":
        async for s in col(cid, "payslips").find({"payroll_run_id": d["id"]}, {"_id": 0}):
            for sp in s.get("project_split") or [{"project_id": s.get("project_id"), "pct": 100}]:
                await post_cost(cid, sp.get("project_id"), "Labour", num(s.get("gross")) * num(sp.get("pct")) / 100, d.get("number"))
        await col(cid, "payslips").update_many({"payroll_run_id": d["id"]}, {"$set": {"status": "Approved", "locked": True}})
        await add_voucher(cid, "Payroll", d.get("total_gross"), "payroll_runs", d["id"], d.get("number"), None, "Salaries & Wages", f"Payroll {d.get('month')}")
    elif reg == "costings":
        await col(cid, "costings").update_many({"tender_id": d.get("tender_id"), "id": {"$ne": d["id"]}}, {"$set": {"superseded": True}})
        await col(cid, "tenders").update_one({"id": d.get("tender_id")}, {"$set": {"costing_approved": True, "approved_costing_id": d["id"],
                                                                                    "bid_value": d.get("bid_value"), "stage": "Costing Approved"}})
    elif reg == "work_orders":
        await col(cid, "work_orders").update_one({"id": d["id"]}, {"$set": {"wo_status": "Active"}})
