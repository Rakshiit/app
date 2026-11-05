import React, { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { PageHeader, Btn, Badge, inputCls, Kpi } from "@/components/common";
import { MODULES, REG } from "@/config/registers";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { dmy, crore, inr } from "@/lib/fmt";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

const MODS = [...MODULES.map((m) => m.key), "ADMIN"];
const LV = ["none", "view", "edit", "approve", "admin"];
const MASKABLE = ["salary", "basic", "daily_wage", "gross", "net_pay", "rate", "std_rate", "last_po_rate", "hourly_cost", "total", "subtotal", "gst_amount", "margin_pct", "margin_amt", "bid_value", "total_cost", "landed_total", "sell", "cost"];

function Roles() {
  const [roles, setRoles] = useState([]);
  const [cur, setCur] = useState(null);
  const load = () => api.get("/admin/roles").then((r) => { setRoles(r.data); setCur((c) => r.data.find((x) => x.id === c?.id) || r.data[0]); });
  useEffect(() => { load(); }, []);
  const save = async () => { try { await api.post("/admin/roles", cur); toast.success("Role saved"); load(); } catch (e) { toast.error(errMsg(e)); } };
  const clone = async () => { const name = window.prompt("New role name:"); if (!name) return; try { const r = (await api.post("/admin/roles", { clone_from: cur.id, name })).data; toast.success("Cloned"); await load(); setCur(r); } catch (e) { toast.error(errMsg(e)); } };
  const allTabs = MODULES.flatMap((m) => m.tabs);
  return (
    <div className="grid grid-cols-[220px_1fr] gap-3">
      <div className="bg-white border rounded-lg p-2 space-y-0.5 max-h-[70vh] overflow-auto">{roles.map((r) => <button key={r.id} onClick={() => setCur(r)} className={`w-full text-left px-2 py-1.5 rounded text-[12px] ${cur?.id === r.id ? "brand-btn" : "hover:bg-slate-100"}`} data-testid={`role-${r.name}`}>{r.name}</button>)}</div>
      {cur && <div className="bg-white border rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-2"><input className={`${inputCls} w-64`} value={cur.name} onChange={(e) => setCur({ ...cur, name: e.target.value })} /><Btn onClick={save} data-testid="role-save">Save</Btn><Btn variant="outline" onClick={clone} data-testid="role-clone">Clone role</Btn></div>
        <div className="text-[12px] font-semibold">Layer 1-2: module access (company access is set per user)</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">{MODS.map((m) => (
          <label key={m} className="text-[12px] flex items-center justify-between gap-2 border rounded px-2 py-1"><span>{m} {MODULES.find((x) => x.key === m)?.title}</span>
            <select className="border rounded text-[12px]" value={cur.modules?.[m] || "none"} onChange={(e) => setCur({ ...cur, modules: { ...cur.modules, [m]: e.target.value } })} data-testid={`perm-${m}`}>{LV.map((l) => <option key={l}>{l}</option>)}</select></label>))}</div>
        <div className="text-[12px] font-semibold">Layer 3: hidden tabs</div>
        <div className="flex flex-wrap gap-1">{allTabs.map((t) => <label key={t} className="text-[11px] border rounded px-1.5 py-0.5"><input type="checkbox" className="mr-1" checked={(cur.hidden_tabs || []).includes(t)} onChange={(e) => setCur({ ...cur, hidden_tabs: e.target.checked ? [...(cur.hidden_tabs || []), t] : cur.hidden_tabs.filter((x) => x !== t) })} />{REG[t]?.title || t}</label>)}</div>
        <div className="text-[12px] font-semibold">Layer 4: field masking</div>
        <div className="flex flex-wrap gap-1">{MASKABLE.map((f) => <label key={f} className="text-[11px] border rounded px-1.5 py-0.5"><input type="checkbox" className="mr-1" checked={(cur.masked_fields || []).includes(f)} onChange={(e) => setCur({ ...cur, masked_fields: e.target.checked ? [...(cur.masked_fields || []), f] : cur.masked_fields.filter((x) => x !== f) })} data-testid={`mask-${f}`} />{f}</label>)}</div>
      </div>}
    </div>
  );
}

function Users() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [cos, setCos] = useState([]);
  const [cur, setCur] = useState(null);
  const load = () => Promise.all([api.get("/admin/users"), api.get("/admin/roles"), api.get("/companies")]).then(([u, r, c]) => { setUsers(u.data); setRoles(r.data); setCos(c.data); });
  useEffect(() => { load(); }, []);
  const save = async () => { try { await api.post("/admin/users", cur); toast.success("User saved"); setCur(null); load(); } catch (e) { toast.error(errMsg(e)); } };
  const toggle = (k, v) => setCur({ ...cur, [k]: (cur[k] || []).includes(v) ? cur[k].filter((x) => x !== v) : [...(cur[k] || []), v] });
  return (
    <div className="space-y-3">
      <Btn onClick={() => setCur({ roles: [], company_ids: [], scope: {} })} data-testid="user-add">Add user</Btn>
      {cur && <div className="bg-white border rounded-lg p-3 space-y-2" data-testid="user-form">
        <div className="grid grid-cols-3 gap-2">{[["name", "Name"], ["email", "Email"], ["password", "Password (blank = keep)"]].map(([k, l]) => <label key={k} className="text-[12px]">{l}<input className={inputCls} value={cur[k] || ""} onChange={(e) => setCur({ ...cur, [k]: e.target.value })} data-testid={`user-${k}`} /></label>)}</div>
        <div className="text-[12px] font-semibold">Roles (multiple allowed)</div><div className="flex flex-wrap gap-1">{roles.map((r) => <label key={r.id} className="text-[11px] border rounded px-1.5 py-0.5"><input type="checkbox" className="mr-1" checked={(cur.roles || []).includes(r.id)} onChange={() => toggle("roles", r.id)} />{r.name}</label>)}</div>
        <div className="text-[12px] font-semibold">Company access</div><div className="flex flex-wrap gap-1">{cos.map((c) => <label key={c.id} className="text-[11px] border rounded px-1.5 py-0.5"><input type="checkbox" className="mr-1" checked={(cur.company_ids || []).includes(c.id) || (cur.company_ids || []).includes("*")} onChange={() => toggle("company_ids", c.id)} />{c.name}</label>)}</div>
        <label className="text-[12px] block">Record scope — states (comma separated, blank = all)<input className={inputCls} value={(cur.scope?.states || []).join(",")} onChange={(e) => setCur({ ...cur, scope: { ...cur.scope, states: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })} /></label>
        <label className="text-[12px] flex items-center gap-2"><input type="checkbox" checked={!!cur.locked} onChange={(e) => setCur({ ...cur, locked: e.target.checked })} />Disabled</label>
        <div className="flex gap-2"><Btn onClick={save} data-testid="user-save">Save user</Btn><Btn variant="outline" onClick={() => setCur(null)}>Cancel</Btn></div>
      </div>}
      <div className="bg-white border rounded-lg overflow-auto"><table className="erp-table w-full"><thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Companies</th><th>Status</th><th>Last login</th></tr></thead>
        <tbody>{users.map((u) => <tr key={u.id} className="cursor-pointer" onClick={() => setCur(u)}><td>{u.name}</td><td>{u.email}</td><td className="text-[11px]">{(u.roles || []).map((r) => roles.find((x) => x.id === r)?.name).join(", ")}</td><td className="text-[11px]">{(u.company_ids || []).includes("*") ? "All" : (u.company_ids || []).length}</td>
          <td>{u.onboarding_locked ? <Badge t="amber">Onboarding locked</Badge> : u.locked ? <Badge t="red">Disabled</Badge> : <Badge t="green">Active</Badge>}</td><td>{dmy(u.last_login)}</td></tr>)}</tbody></table></div>
    </div>
  );
}

function CrossImport() {
  const [cos, setCos] = useState([]);
  const [s, setS] = useState({ step: 1, register: "vendors", duplicates: "skip", include_files: false });
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState([]);
  const [log, setLog] = useState([]);
  useEffect(() => { api.get("/companies").then((r) => setCos(r.data)); api.get("/import/cross/log").then((r) => setLog(r.data)); }, []);
  const preview = async () => { try { const r = (await api.post("/import/cross/preview", s)).data; setRows(r.rows); setSel(r.rows.filter((x) => !x._duplicate).map((x) => x.id)); setS({ ...s, step: 2, match_key: r.match_key }); } catch (e) { toast.error(errMsg(e)); } };
  const run = async () => { try { const r = (await api.post("/import/cross/run", { ...s, ids: sel })).data; toast.success(`Cloned ${r.cloned}, skipped ${r.skipped}, files ${r.files}`); setS({ ...s, step: 1 }); api.get("/import/cross/log").then((x) => setLog(x.data)); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-[12px]">{["Choose source", "Filter & select", "Resolve duplicates", "Clone with audit"].map((l, i) => <span key={l} className={`px-2 py-1 rounded ${s.step >= i + 1 ? "brand-btn" : "bg-slate-100"}`}>{i + 1}. {l}</span>)}</div>
      <div className="bg-white border rounded-lg p-3 grid grid-cols-3 gap-2">
        <label className="text-[12px]">Source company<select className={inputCls} value={s.source_cid || ""} onChange={(e) => setS({ ...s, source_cid: e.target.value })} data-testid="import-source"><option value="">—</option>{cos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="text-[12px]">Target company<select className={inputCls} value={s.target_cid || ""} onChange={(e) => setS({ ...s, target_cid: e.target.value })} data-testid="import-target"><option value="">—</option>{cos.filter((c) => c.id !== s.source_cid).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="text-[12px]">Register<select className={inputCls} value={s.register} onChange={(e) => setS({ ...s, register: e.target.value })}>{["vendors", "products", "subcontractors", "employees", "min_wages", "checklists"].map((r) => <option key={r} value={r}>{REG[r].title}</option>)}</select></label>
        <Btn onClick={preview} disabled={!s.source_cid || !s.target_cid} data-testid="import-preview">Preview</Btn>
      </div>
      {s.step >= 2 && <div className="bg-white border rounded-lg p-3 space-y-2">
        <div className="flex gap-3 text-[12px] items-center">Duplicates (matched on {s.match_key}):{["skip", "overwrite", "rename"].map((d) => <label key={d}><input type="radio" checked={s.duplicates === d} onChange={() => setS({ ...s, duplicates: d })} /> {d}</label>)}
          <label className="ml-4"><input type="checkbox" checked={s.include_files} onChange={(e) => setS({ ...s, include_files: e.target.checked })} /> Clone KYC files</label></div>
        <table className="erp-table w-full"><tbody>{rows.map((r) => <tr key={r.id}><td><input type="checkbox" checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} /></td><td>{r.name || r.title || r.state}</td><td>{r[s.match_key]}</td><td>{r._duplicate && <Badge t="amber">Duplicate in target</Badge>}</td></tr>)}</tbody></table>
        <Btn onClick={run} disabled={!sel.length} data-testid="import-run">Clone {sel.length} records</Btn>
      </div>}
      <div className="bg-white border rounded-lg"><div className="p-2 font-semibold text-[12px] border-b">Import audit log</div><table className="erp-table w-full"><tbody>{log.map((l) => <tr key={l.id}><td>{dmy(l.at)}</td><td>{l.register}</td><td>{cos.find((c) => c.id === l.source)?.short_code} → {cos.find((c) => c.id === l.target)?.short_code}</td><td>{l.cloned} cloned, {l.skipped} skipped, {l.files} files</td><td>{l.by}</td></tr>)}</tbody></table></div>
    </div>
  );
}

function LoginHistory() {
  const [d, setD] = useState([]);
  useEffect(() => { api.get("/auth/login-history").then((r) => setD(r.data)); }, []);
  return <div className="bg-white border rounded-lg overflow-auto max-h-[70vh]"><table className="erp-table w-full"><thead><tr><th>When</th><th>Email</th><th>Result</th><th>IP</th><th>Agent</th></tr></thead><tbody>{d.map((l) => <tr key={l.id}><td>{dmy(l.at)} {l.at.slice(11, 19)}</td><td>{l.email}</td><td><Badge t={l.success ? "green" : "red"}>{l.success ? "Success" : "Failed"}</Badge></td><td>{l.ip}</td><td className="max-w-[300px] truncate text-[11px]">{l.agent}</td></tr>)}</tbody></table></div>;
}

function Delegation() {
  const [users, setUsers] = useState([]);
  const [v, setV] = useState({});
  useEffect(() => { api.get("/admin/users").then((r) => setUsers(r.data)).catch(() => {}); }, []);
  const save = async () => { try { await api.post("/me/delegations", v); toast.success("Approval authority delegated for the date range"); } catch (e) { toast.error(errMsg(e)); } };
  return <div className="bg-white border rounded-lg p-3 grid grid-cols-4 gap-2 items-end max-w-3xl"><label className="text-[12px]">Delegate my approvals to<select className={inputCls} onChange={(e) => setV({ ...v, to_user_id: e.target.value })}><option>—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
    <label className="text-[12px]">From<input type="date" className={inputCls} onChange={(e) => setV({ ...v, from_date: e.target.value })} /></label><label className="text-[12px]">To<input type="date" className={inputCls} onChange={(e) => setV({ ...v, to_date: e.target.value })} /></label><Btn onClick={save}>Delegate</Btn></div>;
}

export function Admin() {
  return (
    <div className="fade-up">
      <PageHeader title="Admin & permissions" subtitle="4-layer permissions: company → module → tab → field, plus state/project/site record scope" />
      <Tabs defaultValue="users"><TabsList className="bg-white border">{[["users", "Users"], ["roles", "Roles & permissions"], ["import", "Cross-company import"], ["delegation", "Delegation"], ["logins", "Login history"]].map(([k, l]) => <TabsTrigger key={k} value={k} data-testid={`admin-tab-${k}`}>{l}</TabsTrigger>)}</TabsList>
        <TabsContent value="users"><Users /></TabsContent><TabsContent value="roles"><Roles /></TabsContent><TabsContent value="import"><CrossImport /></TabsContent><TabsContent value="delegation"><Delegation /></TabsContent><TabsContent value="logins"><LoginHistory /></TabsContent></Tabs>
    </div>
  );
}

export function GroupMIS() {
  const [d, setD] = useState(null);
  useEffect(() => { api.get("/group/mis").then((r) => setD(r.data)).catch((e) => toast.error(errMsg(e))); }, []);
  if (!d) return "Loading…";
  const tot = (k) => d.reduce((s, c) => s + (Number(c[k]) || 0), 0);
  const states = {};
  d.forEach((c) => c.by_state.forEach((s) => { const x = (states[s.state] ||= { state: s.state, value: 0, billed: 0, projects: 0 }); x.value += s.value; x.billed += s.billed; x.projects += s.projects; }));
  return (
    <div className="fade-up p-4">
      <PageHeader title="Group MIS" subtitle="Consolidated across companies and states" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4"><Kpi label="Group order book" value={crore(tot("order_book"))} testid="mis-order-book" /><Kpi label="Billed" value={crore(tot("billed"))} /><Kpi label="Receivables" value={crore(tot("receivables"))} /><Kpi label="BG exposure" value={crore(tot("bg_exposure"))} /><Kpi label="Active tenders" value={tot("tenders_active")} /></div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white border rounded-lg"><table className="erp-table w-full" data-testid="mis-companies"><thead><tr><th>Company</th><th className="n">Projects</th><th className="n">Order book</th><th className="n">Billed</th><th className="n">Win ratio</th><th className="n">Margin</th></tr></thead>
          <tbody>{d.map((c) => <tr key={c.company.id}><td><span className="inline-block w-2.5 h-2.5 rounded-full mr-1" style={{ background: c.company.theme?.primary }} />{c.company.name}</td><td className="n">{c.projects_active}</td><td className="n">{inr(c.order_book)}</td><td className="n">{inr(c.billed)}</td><td className="n">{c.win_ratio}%</td><td className="n">{c.margin_pct}%</td></tr>)}</tbody></table></div>
        <div className="bg-white border rounded-lg p-3"><div className="font-semibold text-[13px] mb-2">State-wise order book</div><ResponsiveContainer width="100%" height={220}><BarChart data={Object.values(states)}><XAxis dataKey="state" /><YAxis tickFormatter={(v) => `${(v / 1e7).toFixed(1)}Cr`} /><Tooltip formatter={(v) => inr(v)} /><Legend /><Bar dataKey="value" fill="#20309A" /><Bar dataKey="billed" fill="#BB232B" /></BarChart></ResponsiveContainer></div>
      </div>
    </div>
  );
}
