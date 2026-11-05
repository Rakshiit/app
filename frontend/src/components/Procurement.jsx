import React, { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Btn, Badge, useRef_ } from "@/components/common";
import { inr } from "@/lib/fmt";
import { toast } from "sonner";
import { Copy, Mail, Send, Scale, Sparkles } from "lucide-react";
import AIReader from "@/components/AIReader";

export function SendRfq({ rfq, open, onClose, onDone }) {
  const { cid } = useApp();
  const vendors = useRef_(cid, "vendors");
  const [sel, setSel] = useState([]);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSel(rfq?.vendor_ids || []); setRes(null); }, [rfq]);
  const go = async (send_email) => {
    setBusy(true);
    try { setRes((await api.post(`/c/${cid}/rfqs/${rfq.id}/send`, { vendor_ids: sel, send_email })).data); onDone?.(); }
    catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white max-w-2xl" data-testid="send-rfq-dialog">
        <DialogHeader><DialogTitle>Send RFQ {rfq?.number}</DialogTitle></DialogHeader>
        {!res ? (<>
          <div className="max-h-64 overflow-auto border rounded">{vendors.map((v) => (
            <label key={v.id} className="flex items-center gap-2 px-3 py-1.5 border-b text-[13px]"><input type="checkbox" checked={sel.includes(v.id)} onChange={(e) => setSel(e.target.checked ? [...sel, v.id] : sel.filter((x) => x !== v.id))} data-testid={`rfq-vendor-${v.id}`} />{v.name}<span className="text-slate-400 text-[11px]">{v.email}</span></label>))}</div>
          <p className="text-[11px] text-slate-500">Each vendor gets a secure, expiring, single-purpose price-entry link. The email includes the full item list and an RFQ PDF download link.</p>
          <div className="flex gap-2"><Btn onClick={() => go(true)} loading={busy} disabled={!sel.length} data-testid="rfq-send-email"><Mail className="w-3.5 h-3.5" />Send by email</Btn><Btn variant="outline" onClick={() => go(false)} loading={busy} disabled={!sel.length} data-testid="rfq-copy-links"><Copy className="w-3.5 h-3.5" />Only create links (WhatsApp / own email)</Btn></div>
        </>) : (
          <div className="space-y-2" data-testid="rfq-send-results">{res.map((r) => (
            <div key={r.vendor_id} className="border rounded p-2 text-[12px]">
              <div className="flex items-center justify-between"><b>{r.vendor_name}</b>{r.email_status && <Badge t={r.email_status === "Sent" ? "green" : "red"}>Email {r.email_status}</Badge>}</div>
              {r.email_error && <div className="text-red-600 text-[11px]">{r.email_error}</div>}
              <div className="flex items-center gap-2 mt-1"><code className="truncate flex-1 bg-slate-50 px-1">{r.url}</code>
                <Btn variant="outline" onClick={() => { navigator.clipboard.writeText(r.url); toast.success("Link copied"); }}><Copy className="w-3 h-3" />Copy</Btn>
                <a className="text-[12px] text-emerald-700 underline" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent("Please submit your quotation: " + r.url)}`}>WhatsApp</a></div>
            </div>))}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RfqCompare({ rfq, open, onClose, onPo }) {
  const { cid } = useApp();
  const [d, setD] = useState(null);
  const [ai, setAi] = useState(false);
  const vendors = useRef_(cid, "vendors");
  const [vid, setVid] = useState("");
  const load = () => rfq && api.get(`/c/${cid}/rfqs/${rfq.id}/compare`).then((r) => setD(r.data));
  useEffect(() => { if (open) load(); }, [open, rfq]); // eslint-disable-line
  const po = async (quote_id) => {
    try { const r = await api.post(`/c/${cid}/rfqs/${rfq.id}/create-po`, { quote_id }); toast.success(`PO ${r.data.number} drafted — submit it for approval`); onPo?.(); onClose(); } catch (e) { toast.error(errMsg(e)); }
  };
  const fromAi = async ({ fields, items }) => {
    if (!vid) throw new Error("Select the vendor first");
    const v = vendors.find((x) => x.id === vid);
    const prev = (d?.vendors || []).find((x) => x.vendor_id === vid);
    await api.post(`/c/${cid}/r/quotes`, { rfq_id: rfq.id, vendor_id: vid, vendor_name: v?.name, revision: (prev?.revision || 0) + 1, freight: Number(fields.freight) || 0, payment_terms: fields.payment_terms, delivery_period: fields.delivery_period, status: "Confirmed", source: "AI reader",
      items: (rfq.items || []).map((it, i) => ({ product_id: it.product_id, desc: it.desc, qty: it.qty, rate: Number(items[i]?.rate) || 0, gst_pct: Number(items[i]?.gst_pct) || 18 })) });
    load();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white max-w-[95vw] w-[1200px]" data-testid="compare-dialog">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Scale className="w-4 h-4" />Landed-cost comparison · {rfq?.number}</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2 text-[12px]">Add a quote received by email:
          <select className="h-8 border rounded px-2" value={vid} onChange={(e) => setVid(e.target.value)} data-testid="compare-ai-vendor"><option value="">Vendor…</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
          <Btn variant="outline" onClick={() => setAi(true)} disabled={!vid} data-testid="compare-ai-btn"><Sparkles className="w-3.5 h-3.5" />Read quote with AI</Btn></div>
        {!d ? "Loading…" : !d.vendors.length ? <div className="p-6 text-slate-500">No confirmed quotes yet. Vendor link submissions appear in "Vendor submissions" for confirmation.</div> : (
          <div className="overflow-auto max-h-[60vh]">
            <table className="erp-table w-full text-[12px]">
              <thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Benchmark (hist. avg / last PO)</th>{d.vendors.map((v) => <th key={v.vendor_id} className="n">{v.vendor_name} <span className="normal-case">V{v.revision}{v.revisions.length > 1 && ` (of ${v.revisions.join("/")})`}</span></th>)}</tr></thead>
              <tbody>
                {d.matrix.map((r, i) => (
                  <tr key={i}><td>{r.desc}</td><td className="n">{r.qty} {r.uom}</td><td className="n">{inr(r.benchmark?.avg)} / {inr(r.benchmark?.last_po)}</td>
                    {d.vendors.map((v) => { const c = r.vendors[v.vendor_id]; return <td key={v.vendor_id} className={`n ${r.l1 === v.vendor_id ? "bg-emerald-50 font-semibold" : ""}`}>{c ? <>{inr(c.rate, 2)}<div className="text-[10px] text-slate-500">landed {inr(c.landed)}</div></> : "-"}</td>; })}</tr>))}
                <tr className="font-semibold"><td colSpan={3}>Freight / terms</td>{d.vendors.map((v) => <td key={v.vendor_id} className="n text-[11px] font-normal">{inr(v.freight)} · {v.payment_terms} · {v.delivery_period}</td>)}</tr>
                <tr className="font-semibold"><td colSpan={3}>Total landed cost</td>{d.vendors.map((v, i) => <td key={v.vendor_id} className="n">{inr(v.landed_total)} {i === 0 && <Badge t="green">L1</Badge>}</td>)}</tr>
                <tr><td colSpan={3} />{d.vendors.map((v) => <td key={v.vendor_id} className="n"><Btn onClick={() => po(v.quote_id)} data-testid={`create-po-${v.vendor_id}`}>Create PO</Btn></td>)}</tr>
              </tbody>
            </table>
          </div>
        )}
        <AIReader open={ai} onClose={() => setAi(false)} docType="vendor_quote" onConfirm={fromAi} title="Read vendor quotation" />
      </DialogContent>
    </Dialog>
  );
}

export function RfqActions({ r, load }) {
  const [s, setS] = useState(false);
  const [c, setC] = useState(false);
  return (<>
    <button title="Send to vendors" className="p-1 rounded hover:bg-slate-100" onClick={() => setS(true)} data-testid={`rfq-send-${r.id}`}><Send className="w-3.5 h-3.5 text-emerald-700" /></button>
    <button title="Compare quotes" className="p-1 rounded hover:bg-slate-100" onClick={() => setC(true)} data-testid={`rfq-compare-${r.id}`}><Scale className="w-3.5 h-3.5 text-indigo-700" /></button>
    <SendRfq rfq={r} open={s} onClose={() => setS(false)} onDone={load} />
    <RfqCompare rfq={r} open={c} onClose={() => setC(false)} onPo={load} />
  </>);
}

export function PoActions({ r, load }) {
  const { cid } = useApp();
  const send = async (kind) => {
    try {
      const x = (await api.post(`/c/${cid}/pos/${r.id}/send`, { kind })).data;
      navigator.clipboard?.writeText(x.url).catch(() => {});
      toast.success(`${kind === "po" ? "PO sent" : "Reminder sent"} — email ${x.email_status || "not sent"}; ack link copied`, { description: x.email_error });
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  if (r.status !== "Approved") return null;
  return (<>
    <button title="Email PO + ack link" className="p-1 rounded hover:bg-slate-100" onClick={() => send("po")} data-testid={`po-send-${r.id}`}><Mail className="w-3.5 h-3.5 text-emerald-700" /></button>
    <button title="Delivery reminder" className="p-1 rounded hover:bg-slate-100 text-[10px] font-semibold" onClick={() => send("reminder")}>REM</button>
  </>);
}
