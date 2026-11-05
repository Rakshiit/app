import React, { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import BOQStudio from "@/components/BOQStudio";
import { Btn, Badge, inputCls } from "@/components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { inr, dmy } from "@/lib/fmt";
import * as I from "lucide-react";

/**
 *  Post-award procurement studio for a Project.
 *  - Loads project_boq items + project_quotes matrix.
 *  - Supports negotiation rounds (N1, N2, ...).
 *  - Awards a vendor+rate per item; creates PO from all awarded items of a vendor.
 */
export function ProjectBOQStudio({ projectId }) {
  const { cid, user } = useApp();
  const [boq, setBoq] = useState([]);
  const [awardOpen, setAwardOpen] = useState(false);
  const [poOpen, setPoOpen] = useState(false);
  const [sel, setSel] = useState({});
  const canEdit = user?.is_super || (user?.modules?.M4 === "edit");
  const refresh = async () => {
    try {
      const m = (await api.get(`/c/${cid}/projects/${projectId}/boq-studio/matrix`)).data;
      setBoq(m.items || []);
    } catch (e) { /* ignore */ }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [projectId]);

  // Vendor summary — for the Create PO dialog
  const vendorsAwarded = Array.from(new Map(boq.filter(b => b.status === "Awarded" && b.neg_vendor_id).map(b => [b.neg_vendor_id, b])).values());

  const createPO = async (vendor_id) => {
    try {
      const po = (await api.post(`/c/${cid}/projects/${projectId}/boq-studio/create-po`, { vendor_id })).data;
      toast.success(`PO ${po.number || po.id?.slice(0, 8)} created with ${po.items?.length} line(s)`);
      setPoOpen(false); refresh();
    } catch (e) { toast.error(errMsg(e)); }
  };

  return (<div className="space-y-3">
    <div className="flex items-center justify-between">
      <div className="text-[12px] text-slate-600">Carry-forward BOQ from the winning tender. Run additional negotiation rounds and award per item.</div>
      <div className="flex gap-2">
        {canEdit && <Btn onClick={() => setAwardOpen(true)} variant="outline" data-testid="proj-award-list"><I.Award className="w-3.5 h-3.5 mr-1" />Review awards</Btn>}
        {canEdit && vendorsAwarded.length > 0 && <Btn onClick={() => setPoOpen(true)} data-testid="proj-create-po"><I.FileCheck className="w-3.5 h-3.5 mr-1" />Create PO</Btn>}
      </div>
    </div>
    <BOQStudio
      matrixUrl={`/c/${cid}/projects/${projectId}/boq-studio/matrix`}
      quoteUrl={`/c/${cid}/projects/${projectId}/boq-studio/quote`}
      sendRfqUrl={`/c/${cid}/projects/${projectId}/boq-studio/send-rfq`}
      pickUrl={`/c/${cid}/projects/${projectId}/boq-studio/award`}
      vendorFetch={async () => (await api.get(`/c/${cid}/r/vendors`)).data.map(v => ({ id: v.id, name: v.name, email: v.email }))}
      lockedKey="neg_vendor_id" rateKey="neg_rate" canEdit={canEdit} roundPrefix="N"
    />

    <Dialog open={awardOpen} onOpenChange={setAwardOpen}>
      <DialogContent className="bg-white max-w-2xl">
        <DialogHeader><DialogTitle>Awarded items</DialogTitle></DialogHeader>
        {boq.filter(b => b.status === "Awarded").length === 0 ? <div className="text-center text-slate-500 py-6">No awards yet</div> : (
          <table className="erp-table w-full text-[12px]"><thead><tr><th>Item</th><th>Qty</th><th>Vendor</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{boq.filter(b => b.status === "Awarded").map(b => (
              <tr key={b.id}><td>{b.desc}</td><td>{b.qty} {b.uom}</td><td>{b.neg_vendor_id?.slice(0, 8)}</td><td className="text-right">{inr(b.neg_rate)}</td><td className="text-right">{inr((b.neg_rate || 0) * (b.qty || 0))}</td></tr>
            ))}</tbody></table>
        )}
      </DialogContent>
    </Dialog>

    <Dialog open={poOpen} onOpenChange={setPoOpen}>
      <DialogContent className="bg-white max-w-md">
        <DialogHeader><DialogTitle>Create PO from awards</DialogTitle></DialogHeader>
        <div className="space-y-2 text-[13px]">
          <div className="text-[12px] text-slate-500">Pick a vendor. A draft PO will be created with all awarded items for that vendor.</div>
          {vendorsAwarded.length === 0 ? <div className="text-center text-slate-500 py-3">No vendor-awarded items yet</div> :
            vendorsAwarded.map((b) => (
              <button key={b.neg_vendor_id} onClick={() => createPO(b.neg_vendor_id)} className="w-full text-left border rounded p-2 hover:border-indigo-400" data-testid={`proj-po-vendor-${b.neg_vendor_id}`}>
                <b>Vendor {b.neg_vendor_id?.slice(0, 8)}</b>
                <div className="text-[11px] text-slate-500">{boq.filter(x => x.status === "Awarded" && x.neg_vendor_id === b.neg_vendor_id).length} item(s)</div>
              </button>))}
        </div>
      </DialogContent>
    </Dialog>
  </div>);
}

/** Project Timeline — tender -> RFQs -> emails -> PO -> GRN -> RA bill */
export function ProjectTimeline({ projectId }) {
  const { cid } = useApp();
  const [events, setEvents] = useState([]);
  useEffect(() => {
    api.get(`/c/${cid}/projects/${projectId}/timeline`).then((r) => setEvents(r.data.events || [])).catch(() => {});
  }, [cid, projectId]);
  const iconFor = (kind) => ({
    tender_created: I.FileText, nit_file_id: I.FileSearch, boq_file_id: I.Calculator,
    locked_at: I.Lock, quoted_at: I.Send, rfqs: I.Mail, pos: I.ShoppingCart,
    grns: I.Package, ra_bills: I.Receipt, invoices: I.FileText, inbox_email: I.Mail,
  })[kind] || I.Circle;
  return (<div className="bg-white border rounded-lg p-4">
    {events.length === 0 ? <div className="text-center text-slate-500 py-8">No events yet</div> :
      <ul className="relative" data-testid="project-timeline">
        <div className="absolute left-[14px] top-0 bottom-0 w-px bg-slate-200" />
        {events.map((e, i) => { const Ic = iconFor(e.kind); return (
          <li key={i} className="relative pl-10 pb-4">
            <div className="absolute left-[7px] top-0 w-[16px] h-[16px] rounded-full bg-white border-2 border-indigo-400 flex items-center justify-center"><Ic className="w-2.5 h-2.5 text-indigo-500" /></div>
            <div className="text-[12px] text-slate-500">{dmy(e.at)}</div>
            <div className="text-[13px] font-medium">{e.title}</div>
          </li>);
        })}
      </ul>}
  </div>);
}
