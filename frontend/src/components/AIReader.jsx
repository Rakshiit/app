import React, { useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Btn, inputCls, Badge } from "@/components/common";
import { toast } from "sonner";
import { Sparkles, Upload, Loader2, Trash2 } from "lucide-react";

const conf = (c) => { const v = Number(c); return v >= 0.85 ? ["green", "High"] : v >= 0.6 ? ["amber", "Medium"] : ["red", "Low"]; };

/** Split-screen AI reader. onConfirm({fields:{key:value}, items:[...], file}) is called only on Confirm & Save. */
export default function AIReader({ open, onClose, docType = "nit", onConfirm, title }) {
  const { cid } = useApp();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [fileUrl, setFileUrl] = useState(null);
  const [fileType, setFileType] = useState("");
  const [dt, setDt] = useState(docType);
  const run = async (f) => {
    if (!f) return;
    setBusy(true); setRes(null);
    setFileType(f.type); setFileUrl(URL.createObjectURL(f));
    const fd = new FormData(); fd.append("file", f); fd.append("doc_type", dt);
    try { setRes((await api.post(`/c/${cid}/ai/extract`, fd, { timeout: 180000 })).data); }
    catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  const setField = (i, v) => setRes({ ...res, fields: res.fields.map((f, j) => (j === i ? { ...f, value: v } : f)) });
  const setItem = (i, k, v) => setRes({ ...res, items: res.items.map((f, j) => (j === i ? { ...f, [k]: v } : f)) });
  const confirm = async () => {
    const fields = Object.fromEntries(res.fields.filter((f) => f.value !== null && f.value !== "").map((f) => [f.key, f.value]));
    try { await onConfirm({ fields, items: res.items, file: res.file }); toast.success("Confirmed & saved"); setRes(null); setFileUrl(null); onClose(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[96vw] w-[1300px] h-[88vh] flex flex-col bg-white p-4" data-testid="ai-reader">
        <DialogHeader><DialogTitle className="flex items-center gap-2 font-heading"><Sparkles className="w-4 h-4 brand-text" />{title || "AI document reader"}</DialogTitle></DialogHeader>
        <div className="flex items-center gap-2">
          <select className={`${inputCls} w-48`} value={dt} onChange={(e) => setDt(e.target.value)} data-testid="ai-doc-type">
            <option value="nit">NIT / Tender notice</option><option value="boq">BOQ</option><option value="corrigendum">Corrigendum</option>
            <option value="vendor_quote">Vendor quotation</option><option value="invoice">Invoice</option>
          </select>
          <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium brand-btn cursor-pointer" data-testid="ai-upload">
            <Upload className="w-3.5 h-3.5" />Upload PDF / Word / Excel (.xlsx/.xlsm) / image
            <input type="file" className="hidden" accept=".pdf,.docx,.xlsx,.xlsm,.png,.jpg,.jpeg,.txt,.csv" onChange={(e) => run(e.target.files?.[0])} />
          </label>
          <span className="text-[11px] text-slate-500">Nothing is saved until you click Confirm & Save. Every field is editable.</span>
        </div>
        <div className="grid grid-cols-2 gap-3 flex-1 min-h-0 mt-2">
          <div className="border rounded-md overflow-auto bg-slate-50" data-testid="ai-original">
            {!fileUrl ? <div className="h-full flex items-center justify-center text-slate-400">Original document appears here</div>
              : fileType === "application/pdf" ? <iframe title="doc" src={fileUrl} className="w-full h-full" />
              : fileType.startsWith("image/") ? <img src={fileUrl} alt="doc" className="max-w-full" />
              : res?.preview_rows ? <table className="erp-table text-[11px]"><tbody>{res.preview_rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
              : res?.preview_text ? <pre className="text-[11px] whitespace-pre-wrap p-3">{res.preview_text}</pre>
              : <div className="p-4 text-slate-500">Preview will be shown after reading…</div>}
          </div>
          <div className="border rounded-md overflow-auto p-3" data-testid="ai-extracted">
            {busy && <div className="flex items-center gap-2 text-slate-600"><Loader2 className="w-4 h-4 animate-spin" />Reading document with AI… (may take up to a minute)</div>}
            {!busy && !res && <div className="text-slate-400">Extracted fields appear here with confidence badges</div>}
            {res && (
              <div className="space-y-2">
                {res.fields.map((f, i) => {
                  const [t, l] = conf(f.confidence);
                  return (
                    <label key={f.key + i} className="block">
                      <span className="flex items-center justify-between text-[11px] font-medium text-slate-600 mb-0.5">{f.label || f.key}<Badge t={t}>{l} {Math.round((f.confidence || 0) * 100)}%</Badge></span>
                      {String(f.value ?? "").length > 80 ? <textarea className={`${inputCls} h-16 py-1`} value={f.value ?? ""} onChange={(e) => setField(i, e.target.value)} />
                        : <input className={inputCls} value={f.value ?? ""} onChange={(e) => setField(i, e.target.value)} data-testid={`ai-field-${f.key}`} />}
                    </label>
                  );
                })}
                {res.items?.length > 0 && (
                  <div>
                    <div className="text-[12px] font-semibold mt-3 mb-1">Items ({res.items.length})</div>
                    <table className="erp-table w-full text-[11px]">
                      <thead><tr><th>Description</th><th>UOM</th><th>Qty</th><th>Rate</th><th>Conf.</th><th /></tr></thead>
                      <tbody>{res.items.map((it, i) => (
                        <tr key={i}>
                          <td><input className={inputCls} value={it.desc || ""} onChange={(e) => setItem(i, "desc", e.target.value)} /></td>
                          <td className="w-16"><input className={inputCls} value={it.uom || ""} onChange={(e) => setItem(i, "uom", e.target.value)} /></td>
                          <td className="w-20"><input className={inputCls} type="number" value={it.qty ?? ""} onChange={(e) => setItem(i, "qty", Number(e.target.value))} /></td>
                          <td className="w-24"><input className={inputCls} type="number" value={it.rate ?? ""} onChange={(e) => setItem(i, "rate", Number(e.target.value))} /></td>
                          <td><Badge t={conf(it.confidence)[0]}>{Math.round((it.confidence || 0) * 100)}%</Badge></td>
                          <td><button onClick={() => setRes({ ...res, items: res.items.filter((_, j) => j !== i) })}><Trash2 className="w-3 h-3" /></button></td>
                        </tr>))}</tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Btn variant="outline" onClick={onClose}>Cancel</Btn>
          <Btn onClick={confirm} disabled={!res} data-testid="ai-confirm-save">Confirm & Save</Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}
