import React, { useEffect, useState } from "react";
import { api, openBlob, uploadFile, errMsg } from "@/lib/api";
import { refLabel, itemCols } from "@/config/registers";
import { inr, dmy, numf } from "@/lib/fmt";
import { toast } from "sonner";
import { Plus, Trash2, Paperclip, Eye, Loader2 } from "lucide-react";

const cache = new Map();
export const clearRefCache = (cid, reg) => cache.delete(`${cid}:${reg}`);
export function useRef_(cid, reg) {
  const [rows, setRows] = useState(cache.get(`${cid}:${reg}`)?.data || []);
  useEffect(() => {
    if (!cid || !reg) return;
    const key = `${cid}:${reg}`;
    const c = cache.get(key);
    if (c?.data && Date.now() - c.t < 30000) { setRows(c.data); return; }
    const p = c?.p && Date.now() - c.t < 30000 ? c.p : api.get(`/c/${cid}/r/${reg}`).then((r) => r.data).catch(() => []);
    cache.set(key, { p, t: Date.now() });
    p.then((d) => { cache.set(key, { data: d, p, t: Date.now() }); setRows(d); });
  }, [cid, reg]);
  return rows;
}

const SC = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-200", amber: "bg-amber-50 text-amber-800 border-amber-200",
  red: "bg-red-50 text-red-700 border-red-200", blue: "bg-blue-50 text-blue-700 border-blue-200", grey: "bg-slate-100 text-slate-700 border-slate-200",
};
const tone = (s = "") => {
  const x = String(s).toLowerCase();
  if (/(approved|active|won|go$|synced|sent|verified|paid|closed|confirmed|delivered|acknowledged|available|pass|recovered|released|issued|done|answered|filed|^p$)/.test(x)) return "green";
  if (/(reject|lost|no-go|fail|expired|missing|overdue|blacklist|open$|^a$|danger|blocked)/.test(x)) return "red";
  if (/(pending|submitted|draft|awaiting|partial|progress|l1|l2|reopen|due|warning|unverified|queued|outstanding|hd)/.test(x)) return "amber";
  return "blue";
};
export const Badge = ({ children, t }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-medium whitespace-nowrap ${SC[t || tone(children)]}`}>{children === true ? "Yes" : children === false ? "No" : children}</span>
);

export const PageHeader = ({ title, subtitle, children }) => (
  <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
    <div>
      <h1 className="text-xl font-semibold tracking-tight font-heading" data-testid="page-title">{title}</h1>
      {subtitle && <p className="text-[12px] text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);

export const Kpi = ({ label, value, sub, testid, tone: t }) => (
  <div className="bg-white border border-slate-200 rounded-lg p-3" data-testid={testid}>
    <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`text-lg font-semibold num mt-1 ${t === "red" ? "text-red-600" : ""}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
  </div>
);

export const Btn = ({ children, variant = "brand", className = "", loading, ...p }) => {
  const v = { brand: "brand-btn", accent: "accent-btn", outline: "bg-white border border-slate-300 text-slate-800 hover:bg-slate-50", ghost: "text-slate-700 hover:bg-slate-100", danger: "bg-red-600 text-white hover:bg-red-700" }[variant];
  return (
    <button {...p} disabled={p.disabled || loading} className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium transition-colors disabled:opacity-50 ${v} ${className}`}>
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{children}
    </button>
  );
};

export const inputCls = "h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]";

export function RefSelect({ cid, reg, value, onChange, filter, testid, disabled }) {
  let rows = useRef_(cid, reg);
  if (filter) rows = rows.filter((r) => Object.entries(filter).every(([k, v]) => !v || r[k] === v));
  return (
    <select className={inputCls} value={value || ""} onChange={(e) => onChange(e.target.value || null, rows.find((r) => r.id === e.target.value))} data-testid={testid} disabled={disabled}>
      <option value="">— select —</option>
      {rows.map((r) => <option key={r.id} value={r.id}>{refLabel(reg, r)}</option>)}
    </select>
  );
}

export function RefText({ cid, reg, id }) {
  const rows = useRef_(cid, reg);
  if (!id) return "-";
  return refLabel(reg, rows.find((r) => r.id === id)) || "…";
}

export function LocSelect({ cid, value, onChange, testid }) {
  const sites = useRef_(cid, "sites");
  return (
    <select className={inputCls} value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
      <option value="">— select —</option>
      <option value="CENTRAL">Central Store</option>
      {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

export function FileField({ cid, value, onChange, testid, multiple, stamp }) {
  const [busy, setBusy] = useState(false);
  const list = multiple ? value || [] : value ? [{ id: value }] : [];
  const pick = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    try {
      const out = [];
      for (const f of files) {
        let st = "";
        if (stamp) st = await stamp();
        const r = await uploadFile(cid, f, "", st);
        out.push({ id: r.id, name: r.name, stamp: st });
      }
      onChange(multiple ? [...list, ...out] : out[0].id);
      toast.success("Uploaded");
    } catch (er) { toast.error(errMsg(er)); }
    setBusy(false); e.target.value = "";
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {list.map((f, i) => (
        <span key={f.id + i} className="inline-flex items-center gap-1 text-[12px] border rounded px-2 py-0.5 bg-slate-50">
          <button type="button" className="inline-flex items-center gap-1 text-blue-700" onClick={() => openBlob(`/c/${cid}/files/${f.id}`)}><Eye className="w-3 h-3" />{f.name || "View"}</button>
          <button type="button" onClick={() => onChange(multiple ? list.filter((_, j) => j !== i) : null)}><Trash2 className="w-3 h-3 text-slate-400" /></button>
        </span>
      ))}
      <label className="inline-flex items-center gap-1 text-[12px] cursor-pointer border border-dashed rounded px-2 py-1 hover:bg-slate-50" data-testid={testid}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />} {multiple ? "Add files" : list.length ? "Replace" : "Upload"}
        <input type="file" className="hidden" multiple={multiple} onChange={pick} accept={stamp ? "image/*" : undefined} capture={stamp ? "environment" : undefined} />
      </label>
    </div>
  );
}

export function ItemsEditor({ cid, cols, value, onChange, testid, projectId, disabled }) {
  const C = typeof cols === "string" ? itemCols(cols) : cols;
  const rows = value || [];
  const prods = useRef_(cid, "products");
  const set = (i, k, v, ref) => {
    const n = rows.map((r) => ({ ...r }));
    n[i][k] = v;
    if (k === "product_id" && ref) {
      const p = prods.find((x) => x.id === v) || ref;
      if (C.some((c) => c.k === "desc")) n[i].desc = p.name;
      if (C.some((c) => c.k === "uom")) n[i].uom = p.uom;
      if (C.some((c) => c.k === "rate") && !n[i].rate) n[i].rate = p.std_rate;
      if (C.some((c) => c.k === "gst_pct")) n[i].gst_pct = p.gst_pct ?? 18;
    }
    if (k === "wbs_id" && ref) n[i].wbs_name = ref.name;
    onChange(n);
  };
  const total = C.some((c) => c.k === "rate") ? rows.reduce((s, r) => s + (Number(r.qty ?? r.qty_received) || 0) * (Number(r.rate) || 0), 0) : null;
  return (
    <div className="border rounded-md overflow-x-auto" data-testid={testid}>
      <table className="erp-table w-full text-[12px]">
        <thead><tr>{C.map((c) => <th key={c.k}>{c.l}</th>)}<th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {C.map((c) => (
                <td key={c.k} className="min-w-[90px]">
                  {c.t === "r" ? <RefSelect cid={cid} reg={c.x} value={r[c.k]} onChange={(v, ref) => set(i, c.k, v, ref)} filter={c.x === "wbs" ? { project_id: projectId } : null} disabled={disabled} />
                    : c.t === "b" ? <input type="checkbox" checked={!!r[c.k]} onChange={(e) => set(i, c.k, e.target.checked)} disabled={disabled} />
                    : <input className={inputCls} disabled={disabled || r[c.k] === "••••"} type={["n", "m"].includes(c.t) ? "number" : "text"} value={r[c.k] ?? ""} onChange={(e) => set(i, c.k, ["n", "m"].includes(c.t) && e.target.value !== "" ? Number(e.target.value) : e.target.value)} />}
                </td>
              ))}
              <td>{!disabled && <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-600" /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between p-2 bg-slate-50">
        {!disabled ? <button type="button" className="text-[12px] inline-flex items-center gap-1 brand-text font-medium" onClick={() => onChange([...rows, {}])} data-testid={`${testid}-add-row`}><Plus className="w-3.5 h-3.5" />Add row</button> : <span />}
        {total !== null && <span className="num text-[12px]">Subtotal {inr(total)}</span>}
      </div>
    </div>
  );
}

export function Cell({ f, v, cid }) {
  if (v === "••••") return <span className="text-slate-400">••••</span>;
  if (f.t === "m") return inr(v);
  if (f.t === "n") return numf(v);
  if (f.t === "d") return dmy(v);
  if (f.t === "b") return <Badge t={v ? "green" : "grey"}>{v ? "Yes" : "No"}</Badge>;
  if (f.t === "r") return <RefText cid={cid} reg={f.x} id={v} />;
  if (f.t === "loc") return v === "CENTRAL" ? "Central Store" : <RefText cid={cid} reg="sites" id={v} />;
  if (f.k === "status" || f.k === "stage" || f.k.endsWith("_status") || f.t === "s") return v ? <Badge>{String(v)}</Badge> : "-";
  if (f.t === "f") return v ? <button className="text-blue-700 underline" onClick={(e) => { e.stopPropagation(); openBlob(`/c/${cid}/files/${v}`); }}>View</button> : "-";
  if (Array.isArray(v)) return `${v.length} items`;
  return v === null || v === undefined || v === "" ? "-" : String(v);
}

export const Empty = ({ text = "No records yet" }) => <div className="text-center text-slate-500 py-10 text-[13px]">{text}</div>;
