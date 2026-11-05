import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API, api, errMsg, openBlob } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { inr, dmy, numf, applyTheme } from "@/lib/fmt";
import { Badge, Btn, inputCls, Kpi } from "@/components/common";
import { toast } from "sonner";
import { CheckCircle2, LogOut, Download } from "lucide-react";

export function VendorLink() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [v, setV] = useState({});
  const [done, setDone] = useState(null);
  useEffect(() => {
    axios.get(`${API}/public/v/${token}`).then((r) => { setD(r.data); applyTheme(r.data.company.theme); setV(r.data.type === "rfq" ? { items: r.data.ref.items.map((i) => ({ ...i, rate: "", gst_pct: 18 })), freight: 0 } : {}); }).catch((e) => setErr(errMsg(e)));
  }, [token]);
  const submit = async () => { try { setDone((await axios.post(`${API}/public/v/${token}`, v)).data.message); } catch (e) { toast.error(errMsg(e)); } };
  if (err) return <div className="p-10 text-center">{err}</div>;
  if (!d) return <div className="p-10 text-center">Loading…</div>;
  const F = (k, l, t = "text") => <label className="block text-[12px]">{l}<input type={t} className={inputCls + " h-10"} value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: t === "number" ? Number(e.target.value) : e.target.value })} data-testid={`vl-${k}`} /></label>;
  const closed = d.expired || d.status !== "Open";
  return (
    <div className="min-h-screen bg-[#F4F6F9]">
      <div className="erp-sidebar px-6 py-4"><div className="max-w-3xl mx-auto flex items-center justify-between"><div className="font-heading font-semibold">{d.company.name}</div><Badge t={closed ? "red" : "green"}>{d.expired ? "Link expired" : d.status === "Open" ? `Valid till ${dmy(d.expires_at)}` : "Already submitted"}</Badge></div></div>
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-white border rounded-xl p-5 space-y-4" data-testid="vendor-link-page">
          <h1 className="text-xl font-heading font-semibold">{{ rfq: `Quotation for RFQ ${d.ref?.number}`, onboarding: "Vendor registration", po_ack: `Acknowledge PO ${d.ref?.number}`, bill: `Submit bill against PO ${d.ref?.number}` }[d.type]}</h1>
          {d.vendor && <p className="text-[13px] text-slate-600">For: <b>{d.vendor.name}</b></p>}
          {done ? <div className="flex items-center gap-2 text-emerald-700" data-testid="vendor-link-done"><CheckCircle2 className="w-5 h-5" />{done}</div> : closed ? <p className="text-slate-600">This secure link can no longer be used. Please contact the buyer for a new link.</p> : (<>
            {d.type === "rfq" && (<>
              <p className="text-[12px] text-slate-500">{d.ref.title} · quote by {dmy(d.ref.due_date)} · delivery at {d.ref.delivery_location || "-"}</p>
              <Btn variant="outline" onClick={() => window.open(`${API}/public/v/${token}/pdf`, "_blank")}><Download className="w-3.5 h-3.5" />Download RFQ PDF</Btn>
              <table className="erp-table w-full"><thead><tr><th>Item</th><th className="n">Qty</th><th>Rate (₹, excl. GST)</th><th>GST %</th></tr></thead>
                <tbody>{v.items.map((it, i) => <tr key={i}><td>{it.desc}</td><td className="n">{it.qty} {it.uom}</td><td><input type="number" className={inputCls + " h-10"} value={it.rate} onChange={(e) => setV({ ...v, items: v.items.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) } : x)) })} data-testid={`vl-rate-${i}`} /></td>
                  <td><input type="number" className={inputCls + " h-10 w-20"} value={it.gst_pct} onChange={(e) => setV({ ...v, items: v.items.map((x, j) => (j === i ? { ...x, gst_pct: Number(e.target.value) } : x)) })} /></td></tr>)}</tbody></table>
              <div className="grid sm:grid-cols-3 gap-3">{F("freight", "Freight (₹)", "number")}{F("payment_terms", "Payment terms")}{F("delivery_period", "Delivery period")}</div>
            </>)}
            {d.type === "onboarding" && <div className="grid sm:grid-cols-2 gap-3">{F("name", "Firm name")}{F("gstin", "GSTIN")}{F("pan", "PAN")}{F("category", "Category")}{F("state", "State")}{F("email", "Email")}{F("phone", "Phone")}{F("contact_person", "Contact person")}{F("bank_account", "Bank account")}{F("ifsc", "IFSC")}</div>}
            {d.type === "po_ack" && <><p className="text-[13px]">PO value {inr(d.ref.total)} · delivery by {dmy(d.ref.delivery_date)}</p><div className="grid sm:grid-cols-2 gap-3">{F("acknowledged_by", "Your name")}{F("committed_delivery", "Committed delivery date", "date")}{F("remarks", "Remarks")}</div></>}
            {d.type === "bill" && <div className="grid sm:grid-cols-2 gap-3">{F("bill_no", "Invoice no")}{F("bill_date", "Invoice date", "date")}{F("amount", "Invoice amount (₹)", "number")}{F("remarks", "Remarks")}</div>}
            <Btn onClick={submit} className="h-10 px-5" data-testid="vl-submit">Submit</Btn>
            <p className="text-[11px] text-slate-500">Your submission goes to a review queue; nothing is final until the buyer confirms it.</p>
          </>)}
        </div>
      </div>
    </div>
  );
}

export function Verify() {
  const { code } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { axios.get(`${API}/public/verify/${code}`).then((r) => setD(r.data)).catch((e) => setErr(errMsg(e))); }, [code]);
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F6F9] p-6">
      <div className="bg-white border rounded-xl p-6 max-w-md w-full text-center" data-testid="verify-page">
        {err ? <><Badge t="red">Not verified</Badge><p className="mt-3">{err}</p></> : !d ? "Checking…" : <><CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" /><h1 className="text-lg font-heading font-semibold mt-2">Genuine document</h1><p className="text-[13px] mt-2">{d.doc_type} <b>{d.number}</b><br />issued by {d.company_name}<br />generated {dmy(d.at)}</p></>}
      </div>
    </div>
  );
}

export function Portal() {
  const { user, logout, loading } = useApp();
  const nav = useNavigate();
  const { cid, pid } = useParams();
  const [list, setList] = useState(null);
  const [d, setD] = useState(null);
  useEffect(() => { if (user) api.get("/portal/projects").then((r) => setList(r.data)); }, [user]);
  useEffect(() => { if (cid && pid) api.get(`/portal/${cid}/projects/${pid}`).then((r) => setD(r.data)).catch((e) => toast.error(errMsg(e))); }, [cid, pid]);
  if (loading) return null;
  if (!user) { nav("/login"); return null; }
  return (
    <div className="min-h-screen bg-[#F4F6F9]">
      <div className="bg-[#0B1220] text-white px-6 py-3 flex items-center justify-between"><div className="font-heading font-semibold">Client portal <Badge t="grey">Read-only</Badge></div><button onClick={logout} className="text-[12px] flex items-center gap-1" data-testid="portal-logout"><LogOut className="w-3.5 h-3.5" />Logout</button></div>
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        {!pid ? (<div className="grid sm:grid-cols-2 gap-3" data-testid="portal-projects">{(list || []).map((p) => (
          <button key={p.id} onClick={() => nav(`/portal/${p.company_id}/${p.id}`)} className="text-left bg-white border rounded-xl p-4 hover:shadow" data-testid={`portal-project-${p.code}`}>
            <div className="text-[11px] text-slate-500">{p.company_name}</div><div className="font-mono text-[12px]">{p.code}</div><div className="font-medium">{p.name}</div>
            <div className="h-2 bg-slate-100 rounded mt-3"><div className="h-2 rounded bg-emerald-600" style={{ width: `${p.physical_pct || 0}%` }} /></div><div className="text-[11px] mt-1">{numf(p.physical_pct)}% complete</div></button>))}
          {list && !list.length && <p className="text-slate-500">No projects shared with you yet.</p>}</div>
        ) : !d ? "Loading…" : (<>
          <button className="text-[12px] underline" onClick={() => nav("/portal")}>← All projects</button>
          <h1 className="text-xl font-heading font-semibold">{d.project.code} · {d.project.name}</h1>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3"><Kpi label="Contract value" value={inr(d.project.contract_value)} /><Kpi label="Progress" value={`${numf(d.project.physical_pct)}%`} /><Kpi label="Billed" value={inr(d.project.billed_value)} /><Kpi label="Completion" value={dmy(d.project.end_date)} /></div>
          <div className="bg-white border rounded-lg"><div className="p-3 font-semibold text-[13px] border-b">Milestones</div><table className="erp-table w-full" data-testid="portal-milestones"><tbody>{d.milestones.map((m) => <tr key={m.code}><td>{m.code}</td><td>{m.name}</td><td className="w-1/3"><div className="h-2 bg-slate-100 rounded"><div className="h-2 rounded bg-emerald-600" style={{ width: `${m.pct}%` }} /></div></td><td className="n">{m.pct}%</td></tr>)}</tbody></table></div>
          <div className="bg-white border rounded-lg"><div className="p-3 font-semibold text-[13px] border-b">RA bills & payment status</div><table className="erp-table w-full" data-testid="portal-bills"><thead><tr><th>Bill</th><th>Date</th><th className="n">Invoice total</th><th className="n">Received</th><th>Status</th><th /></tr></thead>
            <tbody>{d.ra_bills.map((b) => <tr key={b.id}><td>{b.number}</td><td>{dmy(b.bill_date)}</td><td className="n">{inr(b.invoice_total)}</td><td className="n">{inr(b.received)}</td><td><Badge>{b.payment_status}</Badge></td><td><Btn variant="outline" onClick={() => openBlob(`/portal/${cid}/pdf/${b.id}`)}>PDF</Btn></td></tr>)}</tbody></table>
            {!d.ra_bills.length && <p className="p-3 text-[12px] text-slate-500">No certified bills yet.</p>}</div>
        </>)}
      </div>
    </div>
  );
}
