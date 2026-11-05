import React, { useCallback, useEffect, useState } from "react";
import { api, reg as R, errMsg, openBlob } from "@/lib/api";
import { REG, fieldsOf, colsOf } from "@/config/registers";
import { useApp } from "@/context/AppContext";
import { Btn, Cell, Empty, inputCls, RefSelect, LocSelect, FileField, ItemsEditor, clearRefCache, Badge } from "@/components/common";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { Plus, Search, Download, Upload, FileText, Send, Pencil, Trash2, Unlock, History, Loader2 } from "lucide-react";
import { dmy } from "@/lib/fmt";

export function RecordForm({ reg, value, onChange, cid, readOnly }) {
  const fields = fieldsOf(reg);
  const set = (k, v) => onChange({ ...value, [k]: v });
  const geoStamp = async () => {
    const ts = new Date().toLocaleString("en-IN");
    try {
      const p = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 4000 }));
      return `${ts} | GPS ${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`;
    } catch { return `${ts} | GPS unavailable`; }
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {fields.map((f) => {
        const v = value[f.k];
        const masked = v === "••••";
        const wide = ["items", "ta", "files", "lines"].includes(f.t);
        const tid = `field-${f.k}`;
        let input;
        if (f.t === "items") input = <ItemsEditor cid={cid} cols={f.cols} value={v} onChange={(x) => set(f.k, x)} testid={tid} projectId={value.project_id} disabled={readOnly} />;
        else if (f.t === "r") input = <RefSelect cid={cid} reg={f.x} value={v} onChange={(x, ref) => { const n = { ...value, [f.k]: x }; if (f.k === "vendor_id" && ref) n.vendor_name = ref.name; if (f.k === "employee_id" && ref) n.employee_name = ref.name; if (f.k === "subcontractor_id" && ref) n.subcontractor_name = ref.name; onChange(n); }} filter={["sites", "wbs"].includes(f.x) && value.project_id ? { project_id: value.project_id } : null} testid={tid} disabled={readOnly} />;
        else if (f.t === "loc") input = <LocSelect cid={cid} value={v} onChange={(x) => set(f.k, x)} testid={tid} />;
        else if (f.t === "s") input = <select className={inputCls} value={v || ""} onChange={(e) => set(f.k, e.target.value)} data-testid={tid} disabled={readOnly}><option value="">—</option>{f.x.split("|").map((o) => <option key={o}>{o}</option>)}</select>;
        else if (f.t === "ta") input = <textarea className={`${inputCls} h-20 py-1`} value={v || ""} onChange={(e) => set(f.k, e.target.value)} data-testid={tid} disabled={readOnly} />;
        else if (f.t === "lines") input = <textarea className={`${inputCls} h-24 py-1`} value={(v || []).join("\n")} onChange={(e) => set(f.k, e.target.value.split("\n"))} data-testid={tid} />;
        else if (f.t === "b") input = <input type="checkbox" className="w-4 h-4" checked={!!v} onChange={(e) => set(f.k, e.target.checked)} data-testid={tid} disabled={readOnly} />;
        else if (f.t === "f") input = <FileField cid={cid} value={v} onChange={(x) => set(f.k, x)} testid={tid} />;
        else if (f.t === "files") input = <FileField cid={cid} value={v} onChange={(x) => set(f.k, x)} testid={tid} multiple stamp={geoStamp} />;
        else input = <input className={inputCls} type={["n", "m"].includes(f.t) ? "number" : f.t === "d" ? "date" : "text"} value={v ?? ""} disabled={readOnly || masked}
          onChange={(e) => set(f.k, ["n", "m"].includes(f.t) && e.target.value !== "" ? Number(e.target.value) : e.target.value)} data-testid={tid} />;
        return (
          <label key={f.k} className={`block ${wide ? "sm:col-span-2" : ""}`}>
            <span className="block text-[11px] font-medium text-slate-600 mb-1">{f.l}{masked && <span className="ml-1 text-slate-400">(masked)</span>}</span>
            {input}
          </label>
        );
      })}
    </div>
  );
}

function AuditList({ cid, reg, id }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get(`/c/${cid}/audit`, { params: { entity: reg, entity_id: id } }).then((r) => setRows(r.data)); }, [cid, reg, id]);
  if (!rows) return <Loader2 className="w-4 h-4 animate-spin" />;
  return (
    <div className="space-y-2" data-testid="record-audit">
      {rows.map((a) => (
        <div key={a.id} className="text-[12px] border-l-2 pl-2 border-slate-300">
          <div><b>{a.action}</b> by {a.user_name} · {dmy(a.at)} {a.at.slice(11, 16)} {a.note && `· ${a.note}`}</div>
          {Object.entries(a.changes || {}).filter(([k]) => !["created_at", "created_by"].includes(k)).slice(0, 8).map(([k, c]) => (
            <div key={k} className="text-slate-500 truncate">{k}: <span className="line-through">{JSON.stringify(c.old)?.slice(0, 40)}</span> → {JSON.stringify(c.new)?.slice(0, 60)}</div>
          ))}
        </div>
      ))}
      {!rows.length && <div className="text-slate-500 text-[12px]">No history</div>}
    </div>
  );
}

export function RecordSheet({ open, onClose, reg, record, cid, onSaved, defaults }) {
  const [v, setV] = useState({});
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("form");
  const { hasRole } = useApp();
  useEffect(() => { setV(record || { ...(defaults || {}) }); setTab("form"); }, [record, open, defaults]);
  const cfg = REG[reg];
  const locked = record?.locked;
  const save = async () => {
    setBusy(true);
    try {
      const api_ = R(cid, reg);
      const out = record?.id ? await api_.update(record.id, v) : await api_.create(v);
      clearRefCache(cid, reg);
      toast.success("Saved");
      onSaved?.(out); onClose();
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  const reopen = async () => {
    const reason = window.prompt("Reason for reopening this locked entry (logged):");
    if (!reason) return;
    try { await api.post(`/c/${cid}/r/${reg}/${record.id}/reopen`, { reason }); toast.success("Reopened"); onSaved?.(); onClose(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto bg-white" data-testid="record-sheet">
        <SheetHeader>
          <SheetTitle className="font-heading">{record?.id ? `${cfg?.title}: ${record.number || record.name || record.title || record.code || ""}` : `New — ${cfg?.title}`}</SheetTitle>
        </SheetHeader>
        {record?.id && (
          <div className="flex gap-2 my-3 text-[12px]">
            {["form", "history"].map((t) => <button key={t} onClick={() => setTab(t)} className={`px-2 py-1 rounded ${tab === t ? "brand-btn" : "bg-slate-100"}`} data-testid={`sheet-tab-${t}`}>{t === "form" ? "Details" : "Audit history"}</button>)}
            {record.status && <Badge>{record.status}</Badge>}{locked && <Badge t="red">Locked</Badge>}
          </div>
        )}
        {locked && tab === "form" && <div className="text-[12px] bg-amber-50 border border-amber-200 rounded p-2 mb-3">This entry is locked (approved / synced / period closed). Corrections must be made via reversal or credit/debit note, or reopened by Accounts Head with a logged reason.</div>}
        {record?.errors?.length > 0 && <div className="text-[12px] bg-red-50 border border-red-200 rounded p-2 mb-3" data-testid="record-errors">{record.errors.map((e) => <div key={e}>⚠ {e}</div>)}</div>}
        {record?.reject_reason && <div className="text-[12px] bg-red-50 border border-red-200 rounded p-2 mb-3">Rejected: {record.reject_reason}</div>}
        <div className="mt-3">
          {tab === "form" ? <RecordForm reg={reg} value={v} onChange={setV} cid={cid} readOnly={locked || cfg?.readonly} /> : <AuditList cid={cid} reg={reg} id={record.id} />}
        </div>
        {tab === "form" && (
          <div className="flex gap-2 mt-5 sticky bottom-0 bg-white py-3 border-t">
            {!locked && !cfg?.readonly && <Btn onClick={save} loading={busy} data-testid="record-save-btn">Save</Btn>}
            {locked && hasRole("Accounts Head") && <Btn variant="outline" onClick={reopen} data-testid="record-reopen-btn"><Unlock className="w-3.5 h-3.5" />Reopen</Btn>}
            <Btn variant="outline" onClick={onClose}>Close</Btn>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function RegisterTable({ reg, filter = {}, defaults, title, actions, onRow, hideAdd, compact, reloadKey }) {
  const { cid, can } = useApp();
  const cfg = REG[reg];
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null);
  const [open, setOpen] = useState(false);
  const fkey = JSON.stringify(filter);
  const load = useCallback(() => {
    if (!cid) return;
    api.get(`/c/${cid}/r/${reg}`, { params: JSON.parse(fkey) }).then((r) => setRows(r.data)).catch((e) => { setRows([]); toast.error(errMsg(e)); });
  }, [cid, reg, fkey]);
  useEffect(() => { load(); }, [load, reloadKey]);
  const cols = colsOf(reg);
  const filtered = (rows || []).filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  const submit = async (r) => {
    try { await R(cid, reg).submit(r.id); toast.success("Submitted for approval"); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const del = async (r) => {
    if (!window.confirm("Delete this record?")) return;
    try { await R(cid, reg).remove(r.id); toast.success("Deleted"); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const imp = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    try { const r = await api.post(`/c/${cid}/r/${reg}/import/xlsx`, fd); toast.success(`Imported ${r.data.imported} rows`); load(); } catch (er) { toast.error(errMsg(er)); }
    e.target.value = "";
  };
  const canEdit = !cfg?.readonly;
  return (
    <div className="bg-white border border-slate-200 rounded-lg" data-testid={`register-${reg}`}>
      <div className="flex flex-wrap items-center gap-2 p-2.5 border-b border-slate-200">
        <div className="font-semibold text-[13px] mr-2">{title || cfg?.title} <span className="text-slate-400 font-normal">({filtered.length})</span></div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-slate-400" />
          <input className={`${inputCls} pl-7 w-52`} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} data-testid={`${reg}-search`} />
        </div>
        <div className="flex-1" />
        {!compact && <Btn variant="outline" onClick={() => openBlob(`/c/${cid}/r/${reg}/export/xlsx`, `${reg}.xlsx`, true)} data-testid={`${reg}-export`}><Download className="w-3.5 h-3.5" />Export</Btn>}
        {!compact && canEdit && !hideAdd && (
          <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium bg-white border border-slate-300 cursor-pointer hover:bg-slate-50" data-testid={`${reg}-import`}>
            <Upload className="w-3.5 h-3.5" />Import<input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={imp} />
          </label>
        )}
        {canEdit && !hideAdd && <Btn onClick={() => { setEdit(null); setOpen(true); }} data-testid={`${reg}-add-btn`}><Plus className="w-3.5 h-3.5" />Add</Btn>}
      </div>
      <div className="overflow-auto max-h-[62vh] scroll-thin">
        {rows === null ? <div className="p-6 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div> : !filtered.length ? <Empty /> : (
          <table className="erp-table w-full text-[13px]">
            <thead><tr>{cols.map((c) => <th key={c.k} className={["m", "n"].includes(c.t) ? "n" : ""}>{c.l}</th>)}<th className="text-right">Actions</th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="cursor-pointer" onClick={() => (onRow ? onRow(r) : (setEdit(r), setOpen(true)))} data-testid={`${reg}-row-${r.id}`}>
                  {cols.map((c) => <td key={c.k} className={["m", "n"].includes(c.t) ? "n" : "max-w-[280px] truncate"}><Cell f={c} v={r[c.k]} cid={cid} /></td>)}
                  <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex gap-1">
                      {actions?.(r, load)}
                      {cfg?.approve && ["Draft", "Rejected", "Reopened", undefined].includes(r.status) && <button title="Submit for approval" className="p-1 rounded hover:bg-slate-100" onClick={() => submit(r)} data-testid={`${reg}-submit-${r.id}`}><Send className="w-3.5 h-3.5 text-blue-700" /></button>}
                      {cfg?.pdf && <button title="PDF" className="p-1 rounded hover:bg-slate-100" onClick={() => openBlob(`/c/${cid}/pdf/${reg}/${r.id}`)} data-testid={`${reg}-pdf-${r.id}`}><FileText className="w-3.5 h-3.5" /></button>}
                      <button title="Open" className="p-1 rounded hover:bg-slate-100" onClick={() => { setEdit(r); setOpen(true); }}><Pencil className="w-3.5 h-3.5" /></button>
                      {canEdit && !r.locked && can("M13", "view") && <button title="Delete" className="p-1 rounded hover:bg-slate-100" onClick={() => del(r)}><Trash2 className="w-3.5 h-3.5 text-slate-400" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <RecordSheet open={open} onClose={() => setOpen(false)} reg={reg} record={edit} cid={cid} onSaved={load} defaults={{ ...filter, ...(defaults || {}) }} />
    </div>
  );
}
