import React, { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { PageHeader, Btn, Badge } from "@/components/common";
import { toast } from "sonner";
import * as I from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export default function Rollback() {
  const { user } = useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api.get("/admin/rollback/recent?limit=100").then((r) => setItems(r.data)).catch((e) => toast.error(errMsg(e))).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  if (!user?.is_super) {
    return <div className="p-6" data-testid="rollback-denied"><PageHeader title="Cascading rollback" subtitle="Super Admin only" /><div className="bg-white border rounded-lg p-10 text-center text-slate-500"><I.ShieldAlert className="w-10 h-10 mx-auto mb-2 text-amber-500" />Only the Super Admin can access rollback.</div></div>;
  }

  const openPreview = async (seq) => {
    try {
      setPreviewing(seq); setPreview(null); setReason("");
      const r = (await api.get(`/admin/rollback/preview/${seq}`)).data;
      setPreview(r);
    } catch (e) { toast.error(errMsg(e)); setPreviewing(null); }
  };
  const execute = async () => {
    if (!previewing) return;
    if (!reason.trim()) return toast.error("Please add a reason for the audit trail");
    setBusy(true);
    try {
      const r = (await api.post(`/admin/rollback/execute/${previewing}`, { reason })).data;
      toast.success(`Rolled back · ${r.reversed?.join(", ")}`);
      setPreviewing(null); setPreview(null); load();
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };

  const actColor = (a) => a === "create" ? "bg-emerald-100 text-emerald-700" : a === "update" ? "bg-blue-100 text-blue-700" : a === "delete" ? "bg-red-100 text-red-700" : a === "approve" ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-700";
  const minsAgo = (iso) => { try { return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); } catch { return "?"; } };

  return (
    <div className="fade-up p-4" data-testid="rollback-page">
      <PageHeader title="Cascading rollback" subtitle="Reverse any action from the last 24 hours — including stock, budget and linked records" />
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[12px] text-amber-800 mb-3 flex items-start gap-2"><I.Info className="w-4 h-4 mt-0.5 shrink-0" /><div>Rollback is irreversible. Each run is itself audited. Posted vouchers, approved tally syncs and closed periods are preserved for compliance.</div></div>

      {loading ? <div className="text-center py-10 text-slate-500">Loading…</div> : items.length === 0 ? (
        <div className="bg-white border rounded-lg p-10 text-center text-slate-500"><I.History className="w-8 h-8 mx-auto mb-2 text-slate-400" />No reversible activity in the last 24 hours.</div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="erp-table w-full" data-testid="rollback-table">
            <thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Record</th><th>By</th><th className="text-right">&nbsp;</th></tr></thead>
            <tbody>{items.map((it) => (
              <tr key={it.seq}>
                <td className="text-[12px]">{minsAgo(it.at)} min ago<div className="text-[10px] text-slate-500">{it.at?.slice(0,19)?.replace("T"," ")}</div></td>
                <td><span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${actColor(it.action)}`}>{it.action}</span></td>
                <td className="text-[12px]">{it.entity}</td>
                <td className="text-[12px] font-mono">{it.entity_id?.slice(0,10)}</td>
                <td className="text-[12px]">{it.user_name}</td>
                <td className="text-right"><Btn variant="outline" size="sm" onClick={() => openPreview(it.seq)} data-testid={`rollback-preview-${it.seq}`}><I.Undo2 className="w-3.5 h-3.5 mr-1" />Preview rollback</Btn></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      <Dialog open={!!previewing} onOpenChange={(o) => { if (!o) { setPreviewing(null); setPreview(null); } }}>
        <DialogContent className="max-w-xl bg-white">
          <DialogHeader><DialogTitle>Preview rollback · seq #{previewing}</DialogTitle></DialogHeader>
          {!preview ? <div className="py-6 text-center text-slate-500">Loading preview…</div> : (<div className="space-y-3">
            <div className="text-[12px] text-slate-500">The following will be reversed:</div>
            <ul className="space-y-1 text-[13px]" data-testid="rollback-summary">{(preview.summary || []).map((s, i) => <li key={i} className="flex items-start gap-2"><I.CornerDownLeft className="w-4 h-4 mt-0.5 text-slate-400" />{s}</li>)}</ul>
            <div className="grid grid-cols-4 gap-2 text-center text-[11px] bg-slate-50 rounded p-2">
              <div><div className="font-semibold text-[16px]">{preview.chain?.length || 0}</div>records</div>
              <div><div className="font-semibold text-[16px]">{preview.linked?.stock_ledger_rows || 0}</div>stock</div>
              <div><div className="font-semibold text-[16px]">{preview.linked?.cost_postings_rows || 0}</div>budget</div>
              <div><div className="font-semibold text-[16px]">{preview.linked?.vouchers_rows || 0}</div>vouchers</div>
            </div>
            <label className="text-[12px] font-semibold">Reason (audited)</label>
            <input className="w-full border rounded px-2 py-1.5 text-[13px]" placeholder="e.g. wrong vendor on PO" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rollback-reason" />
          </div>)}
          <DialogFooter><Btn variant="outline" onClick={() => { setPreviewing(null); setPreview(null); }} data-testid="rollback-cancel">Cancel</Btn><Btn onClick={execute} disabled={busy || !preview} data-testid="rollback-execute">{busy ? "Reversing…" : "Execute rollback"}</Btn></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
