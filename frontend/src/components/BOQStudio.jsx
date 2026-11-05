import React, { useEffect, useMemo, useState } from "react";
import { api, errMsg, BASE } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { Btn, Badge, inputCls, Kpi } from "@/components/common";
import { toast } from "sonner";
import * as I from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { inr } from "@/lib/fmt";

const STATUS_COLORS = {
  Invited: "bg-slate-100 text-slate-700",
  Received: "bg-emerald-100 text-emerald-700",
  "-": "bg-slate-50 text-slate-400",
};

/**
 * BOQStudio — dynamic BOQ × vendor × round matrix.
 *
 * Props:
 *   matrixUrl:    GET endpoint returning {items, columns, rows}
 *   quoteUrl:     POST endpoint to upsert a single quote
 *   sendRfqUrl:   POST endpoint to send an RFQ round
 *   pickUrl:      POST endpoint to lock the chosen vendor+rate
 *   autoFillUrl:  (optional) POST endpoint to parse inbox emails
 *   vendorFetch:  async () => [{id,name,email}]   (list of pickable vendors)
 *   lockedKey:    field on the BOQ item that stores the picked vendor id  (e.g. 'locked_vendor_id' or 'neg_vendor_id')
 *   rateKey:      field on the BOQ item that stores the picked rate        (e.g. 'locked_rate' or 'neg_rate')
 *   canEdit:      boolean
 *   roundPrefix:  'V' for tender bidding, 'N' for negotiation
 */
export default function BOQStudio({ matrixUrl, quoteUrl, sendRfqUrl, pickUrl, autoFillUrl, vendorFetch, lockedKey, rateKey, canEdit = true, roundPrefix = "V" }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [sel, setSel] = useState({ item_ids: [], vendor_ids: [], due_date: "", notes: "" });
  const load = async () => {
    try { setData((await api.get(matrixUrl)).data); }
    catch (e) { toast.error(errMsg(e)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [matrixUrl]);
  useEffect(() => { vendorFetch?.().then(setVendors); /* eslint-disable-next-line */ }, []);

  if (!data) return <div className="text-slate-500 text-center py-10">Loading BOQ Studio…</div>;

  const setCell = async (item_id, c, rate) => {
    if (!canEdit) return;
    try {
      await api.post(quoteUrl, { item_id, vendor_id: c.vendor_id, round: c.round, rate: Number(rate) || 0 });
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const pick = async (item_id, c, rate) => {
    if (!canEdit) return;
    try {
      await api.post(pickUrl, { item_id, vendor_id: c.vendor_id, rate: Number(rate) || 0 });
      toast.success("Vendor + rate locked for this item");
      load();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const openSend = () => {
    setSel({ item_ids: data.items.map((i) => i.id), vendor_ids: [], due_date: "", notes: "" });
    setSendOpen(true);
  };
  const sendRfq = async () => {
    if (!sel.vendor_ids.length) return toast.error("Pick at least one vendor");
    setBusy(true);
    try {
      const r = (await api.post(sendRfqUrl, sel)).data;
      toast.success(`RFQ sent to ${r.vendors?.length || 0} vendor(s) · round ${r.round}`);
      setSendOpen(false); load();
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  const autoFill = async () => {
    setBusy(true);
    try {
      const r = (await api.post(autoFillUrl)).data;
      toast.success(`Auto-filled ${r.cells_filled || 0} cell(s) from ${r.processed || 0} email(s)`);
      load();
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };

  const cheapestForItem = (row) => {
    const rates = Object.entries(row.cells).map(([k, v]) => [k, Number(v.rate)]).filter(([, r]) => r > 0);
    if (!rates.length) return null;
    rates.sort((a, b) => a[1] - b[1]);
    return rates[0][0];
  };

  return (
    <div className="space-y-3" data-testid="boq-studio">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[13px] text-slate-600"><b>{data.items.length}</b> BOQ items · <b>{data.vendors.length}</b> vendor(s) · rounds <b>{data.rounds.join(", ") || "—"}</b></div>
        <div className="ml-auto flex gap-2">
          {canEdit && autoFillUrl && <Btn variant="outline" onClick={autoFill} disabled={busy} data-testid="boq-autofill"><I.Sparkles className="w-3.5 h-3.5 mr-1" />Auto-fill from mailbox</Btn>}
          {canEdit && <Btn onClick={openSend} disabled={busy} data-testid="boq-send-rfq"><I.Send className="w-3.5 h-3.5 mr-1" />Send RFQ to vendors</Btn>}
        </div>
      </div>

      {data.items.length === 0 ? (
        <div className="bg-white border rounded-lg p-10 text-center text-slate-500"><I.ListChecks className="w-8 h-8 mx-auto mb-2 text-slate-400" />No BOQ items yet. Upload the BOQ document to populate this table.</div>
      ) : (
        <div className="bg-white border rounded-lg overflow-x-auto">
          <table className="erp-table w-full" data-testid="boq-studio-table">
            <thead>
              <tr>
                <th className="text-left sticky left-0 bg-white z-10">#</th>
                <th className="text-left sticky left-[32px] bg-white z-10 min-w-[260px]">Item</th>
                <th>UOM</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Est. rate</th>
                {data.columns.map((c) => (
                  <th key={c.key} className="text-right min-w-[110px]">
                    <div className="text-[11px] font-semibold truncate" title={c.vendor_name}>{c.vendor_name}</div>
                    <div className="text-[10px] text-slate-500 font-normal">{roundPrefix}{c.round}</div>
                  </th>
                ))}
                <th className="text-right min-w-[140px]">Picked</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, idx) => {
                const best = cheapestForItem(row);
                const picked_vid = row.item[lockedKey];
                const picked_rate = row.item[rateKey];
                return (
                  <tr key={row.item.id}>
                    <td className="text-[11px] text-slate-400 sticky left-0 bg-white">{idx + 1}</td>
                    <td className="sticky left-[32px] bg-white">
                      <div className="text-[12px] font-medium">{row.item.desc}</div>
                      {row.item.code && <div className="text-[10px] text-slate-500 font-mono">{row.item.code}</div>}
                    </td>
                    <td className="text-[12px]">{row.item.uom}</td>
                    <td className="text-right text-[12px]">{row.item.qty}</td>
                    <td className="text-right text-[12px] text-slate-500">{row.item.est_rate ? inr(row.item.est_rate) : "—"}</td>
                    {data.columns.map((c) => {
                      const cell = row.cells[c.key] || {};
                      const r = cell.rate;
                      const isBest = best === c.key;
                      const isPicked = picked_vid === c.vendor_id && Number(picked_rate) === Number(r);
                      return (
                        <td key={c.key} className={`text-right p-1 ${isBest ? "bg-emerald-50" : ""} ${isPicked ? "ring-2 ring-indigo-300" : ""}`}>
                          <input
                            type="number" step="any" defaultValue={r ?? ""}
                            disabled={!canEdit}
                            onBlur={(e) => { const nv = Number(e.target.value) || 0; if (nv !== Number(r || 0)) setCell(row.item.id, c, nv); }}
                            className={`w-[100px] text-right text-[12px] border rounded px-1 py-0.5 ${cell.status === "Invited" ? "bg-slate-50" : "bg-white"}`}
                            data-testid={`boq-cell-${row.item.id}-${c.key}`}
                            title={cell.source ? `source: ${cell.source}` : cell.status}
                          />
                          {r > 0 && canEdit && (
                            <button className="block text-[10px] text-indigo-600 mt-0.5 hover:underline mx-auto" onClick={() => pick(row.item.id, c, r)} data-testid={`boq-pick-${row.item.id}-${c.key}`}>pick</button>
                          )}
                        </td>
                      );
                    })}
                    <td className="text-right">
                      {picked_vid && picked_rate ? (
                        <div><div className="text-[12px] font-semibold text-indigo-700">{inr(picked_rate)}</div><div className="text-[10px] text-slate-500 truncate">{data.vendors.find(v => v.vendor_id === picked_vid)?.vendor_name || "—"}</div></div>
                      ) : <span className="text-[11px] text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold">
              <tr>
                <td colSpan={5 + data.columns.length} className="text-right text-[12px] py-2">Total locked cost</td>
                <td className="text-right text-[13px]" data-testid="boq-total-locked">{inr(data.items.reduce((s, it) => s + ((it[rateKey] || 0) * (it.qty || 0)), 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="bg-white max-w-2xl">
          <DialogHeader><DialogTitle>Send RFQ to vendors</DialogTitle></DialogHeader>
          <div className="space-y-3 text-[13px]">
            <label className="block">
              <span className="text-[11px] font-medium text-slate-600">Vendors</span>
              <div className="border rounded p-2 max-h-56 overflow-y-auto grid grid-cols-2 gap-1">
                {vendors.length === 0 ? <div className="text-[12px] text-slate-500">No vendors available</div> :
                  vendors.map((v) => (
                    <label key={v.id} className="flex items-center gap-2 text-[12px]">
                      <input type="checkbox" checked={sel.vendor_ids.includes(v.id)} onChange={(e) => setSel((s) => ({ ...s, vendor_ids: e.target.checked ? [...s.vendor_ids, v.id] : s.vendor_ids.filter((x) => x !== v.id) }))} data-testid={`rfq-vendor-${v.id}`} />
                      <span className="truncate">{v.name} <span className="text-slate-400">{v.email ? "•" : "(no email)"}</span></span>
                    </label>))}
              </div>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-600">Items (default: all)</span>
              <div className="border rounded p-2 max-h-40 overflow-y-auto">
                {data.items.map((it) => (
                  <label key={it.id} className="flex items-center gap-2 text-[12px]">
                    <input type="checkbox" checked={sel.item_ids.includes(it.id)} onChange={(e) => setSel((s) => ({ ...s, item_ids: e.target.checked ? [...s.item_ids, it.id] : s.item_ids.filter((x) => x !== it.id) }))} />
                    <span className="truncate">{it.desc} ({it.qty} {it.uom})</span>
                  </label>))}
              </div>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-600">Reply due date</span>
              <input type="date" className={inputCls} value={sel.due_date} onChange={(e) => setSel({ ...sel, due_date: e.target.value })} data-testid="rfq-due" />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-600">Notes (shown in email)</span>
              <textarea className="w-full border rounded px-2 py-1.5 text-[13px]" rows={2} value={sel.notes} onChange={(e) => setSel({ ...sel, notes: e.target.value })} />
            </label>
          </div>
          <DialogFooter>
            <Btn variant="outline" onClick={() => setSendOpen(false)}>Cancel</Btn>
            <Btn onClick={sendRfq} disabled={busy} data-testid="rfq-send-confirm">{busy ? "Sending…" : "Send RFQ"}</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
