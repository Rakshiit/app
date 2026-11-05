import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, errMsg, openBlob, reg as R } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import RegisterTable from "@/components/RegisterTable";
import { Btn, Badge, Empty, inputCls, RefSelect, Kpi, useRef_ } from "@/components/common";
import { inr, dmy, numf } from "@/lib/fmt";
import { toast } from "sonner";
import { CheckCircle2, XCircle, ShieldCheck, FileDown, Lock, ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const useLoad = (fn, deps) => {
  const [d, setD] = useState(null);
  const load = () => fn().then(setD).catch((e) => { toast.error(errMsg(e)); setD([]); });
  useEffect(() => { load(); }, deps); // eslint-disable-line
  return [d, load];
};
const Tbl = ({ head, rows, testid }) => (
  <div className="bg-white border rounded-lg overflow-auto max-h-[65vh]" data-testid={testid}>
    {!rows?.length ? <Empty /> : <table className="erp-table w-full"><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows}</tbody></table>}
  </div>
);

export function ClosureGate({ projectId }) {
  const { cid, hasRole } = useApp();
  const nav = useNavigate();
  const [d, load] = useLoad(() => api.get(`/c/${cid}/projects/${projectId}/closure`).then((r) => r.data), [projectId]);
  if (!d) return "Evaluating gate…";
  const close = async () => {
    const remarks = window.prompt("Closure remarks (margin will be frozen and project archived read-only):");
    if (remarks === null) return;
    try { await api.post(`/c/${cid}/projects/${projectId}/close`, { remarks }); toast.success("Project closed & archived"); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  const mod = { ra_bills: "M8", vouchers: "M12", bgs: "M9", mob_advances: "M9", change_orders: "M2", stock_ledger: "M5", equipment: "M5", ncrs: "M10", work_orders: "M7", insurance: "M5", projects: "M2" };
  return (
    <div className="space-y-3" data-testid="closure-gate">
      <div className="flex items-center gap-3"><Kpi label="Gate" value={`${d.passed} / 11 passed`} tone={d.can_close ? "" : "red"} />
        {d.project.status === "Closed" ? <Badge t="green">Closed & archived</Badge> : <Btn onClick={close} disabled={!d.can_close || !hasRole("Director")} data-testid="close-project-btn"><Lock className="w-3.5 h-3.5" />Management close</Btn>}
        {!d.can_close && <span className="text-[12px] text-slate-500">Closure is blocked until all 11 points pass. Click a blocker to fix it.</span>}</div>
      <div className="grid md:grid-cols-2 gap-2">{d.checks.map((c, i) => (
        <button key={c.key} onClick={() => !c.pass && nav(c.register === "projects" ? `/m/M2?tab=projects` : `/m/${mod[c.register]}?tab=${c.register}`)} className={`text-left border rounded-lg p-3 bg-white ${c.pass ? "" : "border-red-200 hover:bg-red-50"}`} data-testid={`closure-check-${c.key}`}>
          <div className="flex items-center gap-2 font-medium text-[13px]">{c.pass ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-red-600" />}{i + 1}. {c.label}</div>
          <div className="text-[12px] text-slate-500 mt-1 ml-6">{c.detail}</div>
        </button>))}</div>
    </div>
  );
}

function ProjectPicker({ value, onChange }) {
  const { cid } = useApp();
  return <div className="w-80 mb-3"><RefSelect cid={cid} reg="projects" value={value} onChange={onChange} testid="project-picker" /></div>;
}

function ClosureTab() {
  const { cid } = useApp();
  const ps = useRef_(cid, "projects");
  const [p, setP] = useState(null);
  const pid = p || ps[0]?.id;
  return <div><ProjectPicker value={pid} onChange={setP} />{pid && <ClosureGate projectId={pid} />}</div>;
}

function PayrollTab() {
  const { cid } = useApp();
  const prev = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).toISOString().slice(0, 7);
  const [month, setMonth] = useState(prev);
  const [pid, setPid] = useState(null);
  const [k, setK] = useState(0);
  const [locks, loadLocks] = useLoad(() => api.get(`/c/${cid}/attendance/locks`).then((r) => r.data), [cid]);
  const lock = async () => { try { await api.post(`/c/${cid}/attendance/lock`, { project_id: pid, month }); toast.success("Attendance locked"); loadLocks(); } catch (e) { toast.error(errMsg(e)); } };
  const run = async () => { try { const r = (await api.post(`/c/${cid}/payroll/run`, { month })).data; toast.success(`Payroll ${r.number} computed for ${r.employees} employees`); setK(k + 1); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-3">
      <div className="bg-white border rounded-lg p-3 flex flex-wrap items-end gap-3">
        <label className="text-[12px]">Month<input type="month" className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)} data-testid="payroll-month" /></label>
        <label className="text-[12px] w-72">Project (PM lock)<RefSelect cid={cid} reg="projects" value={pid} onChange={setPid} testid="payroll-lock-project" /></label>
        <Btn variant="outline" onClick={lock} disabled={!pid} data-testid="attendance-lock-btn"><Lock className="w-3.5 h-3.5" />Lock attendance</Btn>
        <Btn onClick={run} data-testid="payroll-run-btn">Run payroll</Btn>
        <span className="text-[11px] text-slate-500">Locked: {(locks || []).filter((l) => l.month === month).map((l) => l.project_id.slice(0, 6)).join(", ") || "none"} · min-wage, EPF 12% (cap ₹15,000), ESIC 0.75%, state PT applied</span>
      </div>
      <RegisterTable reg="payroll_runs" hideAdd reloadKey={k} />
    </div>
  );
}

function StagingTab() {
  const { cid } = useApp();
  const [d, load] = useLoad(() => api.get(`/c/${cid}/staging`).then((r) => r.data), [cid]);
  const act = async (s, a) => { try { await api.post(`/c/${cid}/staging/${s.id}/${a}`); toast.success(a === "confirm" ? "Confirmed — now live" : "Rejected"); load(); } catch (e) { toast.error(errMsg(e)); } };
  return <Tbl testid="staging-table" head={["Received", "Type", "Summary", "Status", ""]} rows={(d || []).map((s) => (
    <tr key={s.id}><td>{dmy(s.at)}</td><td><Badge t="blue">{s.type}</Badge></td>
      <td className="max-w-[520px] text-[12px]">{s.type === "rfq" ? (s.payload.items || []).map((i) => `${i.desc}: ₹${i.rate}`).join(" · ") + ` · freight ₹${s.payload.freight || 0}` : JSON.stringify(s.payload).slice(0, 200)}</td>
      <td><Badge>{s.status}</Badge></td>
      <td>{s.status === "Pending Review" && <div className="flex gap-1"><Btn onClick={() => act(s, "confirm")} data-testid={`staging-confirm-${s.id}`}>Confirm</Btn><Btn variant="outline" onClick={() => act(s, "reject")}>Reject</Btn></div>}</td></tr>))} />;
}

function StockTab() {
  const { cid } = useApp();
  const [d] = useLoad(() => api.get(`/c/${cid}/stock/balance`).then((r) => r.data), [cid]);
  return <Tbl testid="stock-balance" head={["Product", "Location", "In", "Out", "Balance", "Value", "Reorder"]} rows={(d || []).map((s) => (
    <tr key={s.product_id + s.location}><td>{s.product_name}</td><td>{s.location_name}</td><td className="n">{numf(s.qty_in)}</td><td className="n">{numf(s.qty_out)}</td><td className="n font-semibold">{numf(s.balance)} {s.uom}</td><td className="n">{inr(s.value)}</td><td>{s.low ? <Badge t="red">Low — auto MR raised</Badge> : ""}</td></tr>))} />;
}

function UnbilledTab() {
  const { cid } = useApp();
  const [d] = useLoad(() => api.get(`/c/${cid}/reports/unbilled`).then((r) => r.data), [cid]);
  const tot = (d || []).reduce((s, r) => s + (Number(r.unbilled_value) || 0), 0);
  return <div><Kpi label="Unbilled work done" value={inr(tot)} /><div className="mt-3" /><Tbl testid="unbilled" head={["WBS", "Item", "Done", "Billed", "Unbilled", "Rate", "Value"]} rows={(d || []).map((r) => (
    <tr key={r.code + r.name}><td>{r.code}</td><td>{r.name}</td><td className="n">{numf(r.done_qty)}</td><td className="n">{numf(r.billed_qty)}</td><td className="n">{numf(r.unbilled_qty)} {r.uom}</td><td className="n">{inr(r.rate)}</td><td className="n">{inr(r.unbilled_value)}</td></tr>))} /></div>;
}

export function BudgetTable({ project }) {
  const b = project.budget || {};
  const rows = Object.entries(b);
  const bt = rows.reduce((s, [, h]) => s + (h.budget || 0), 0), at = rows.reduce((s, [, h]) => s + (h.actual || 0), 0);
  return (
    <table className="erp-table w-full bg-white border rounded" data-testid="budget-table"><thead><tr><th>Head</th><th className="n">Baseline</th><th className="n">Budget</th><th className="n">Actual</th><th className="n">Variance</th><th className="n">Used %</th></tr></thead>
      <tbody>{rows.map(([k, h]) => { const used = h.budget ? (h.actual * 100) / h.budget : 0; return (
        <tr key={k}><td>{k}</td><td className="n">{inr(project.baseline_budget?.[k]?.budget)}</td><td className="n">{inr(h.budget)}</td><td className="n">{inr(h.actual)}</td><td className={`n ${h.actual > h.budget ? "text-red-600" : ""}`}>{inr(h.budget - h.actual)}</td><td className="n">{used > 100 ? <Badge t="red">{numf(used, 1)}% overrun</Badge> : `${numf(used, 1)}%`}</td></tr>); })}
        <tr className="font-semibold"><td>Total</td><td /><td className="n">{inr(bt)}</td><td className="n">{inr(at)}</td><td className="n">{inr(bt - at)}</td><td className="n">{bt ? numf((at * 100) / bt, 1) : 0}%</td></tr></tbody></table>
  );
}

function BudgetTab() {
  const { cid } = useApp();
  const [d] = useLoad(() => R(cid, "projects").list(), [cid]);
  return <div className="space-y-4">{(d || []).map((p) => <div key={p.id}><div className="font-semibold text-[13px] mb-1">{p.code} · {p.name} <span className="text-slate-500 font-normal">· contract {inr(p.contract_value)} · billed {inr(p.billed_value)} · progress {numf(p.physical_pct)}%</span></div><BudgetTable project={p} /></div>)}</div>;
}

function VouchersTab() {
  const { cid, company, hasRole, refreshCompany } = useApp();
  const [d, load] = useLoad(() => R(cid, "vouchers").list(), [cid]);
  const [sel, setSel] = useState([]);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const mark = async (status) => { try { await api.post(`/c/${cid}/tally/mark`, { ids: sel, status, error: status === "Failed" ? window.prompt("Error message from Tally:") : null }); setSel([]); load(); toast.success(`Marked ${status}`); } catch (e) { toast.error(errMsg(e)); } };
  const closeP = async (action) => { try { await api.post(`/companies/${cid}/close-period`, { period, action, reason: action === "reopen" ? window.prompt("Reason to reopen period:") : "" }); refreshCompany(); toast.success(`Period ${action}d`); } catch (e) { toast.error(errMsg(e)); } };
  const c = (s) => (d || []).filter((v) => v.status === s).length;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3"><Kpi label="Pending" value={c("Pending")} /><Kpi label="Synced" value={c("Synced")} /><Kpi label="Failed" value={c("Failed")} tone={c("Failed") ? "red" : ""} /></div>
      <div className="bg-white border rounded-lg p-3 flex flex-wrap gap-2 items-center">
        <Btn variant="outline" onClick={() => openBlob(`/c/${cid}/tally/xml`, "tally_vouchers.xml", true)} data-testid="tally-export-xml"><FileDown className="w-3.5 h-3.5" />Export Tally XML (pending)</Btn>
        <Btn onClick={() => mark("Synced")} disabled={!sel.length} data-testid="tally-mark-synced">Mark synced ({sel.length})</Btn>
        <Btn variant="outline" onClick={() => mark("Failed")} disabled={!sel.length}>Mark failed</Btn>
        <span className="text-[11px] text-slate-500">Direct Tally Prime bridge arrives in Phase 2; import this XML in Tally meanwhile.</span>
        <div className="flex-1" />
        {hasRole("Accounts Head") && <><input type="month" className={`${inputCls} w-36`} value={period} onChange={(e) => setPeriod(e.target.value)} /><Btn variant="outline" onClick={() => closeP("close")} data-testid="period-close-btn">Close period</Btn><Btn variant="ghost" onClick={() => closeP("reopen")}>Reopen</Btn></>}
        <span className="text-[11px]">Closed: {(company.closed_periods || []).join(", ") || "none"}</span>
      </div>
      <Tbl testid="voucher-queue" head={["", "Date", "Type", "Ref", "Party", "Amount", "Status"]} rows={(d || []).map((v) => (
        <tr key={v.id}><td><input type="checkbox" checked={sel.includes(v.id)} disabled={v.status === "Synced"} onChange={(e) => setSel(e.target.checked ? [...sel, v.id] : sel.filter((x) => x !== v.id))} /></td><td>{dmy(v.date)}</td><td>{v.voucher_type}</td><td>{v.ref_no}</td><td>{v.party}</td><td className="n">{inr(v.amount)}</td><td><Badge>{v.status}</Badge>{v.error && <span className="text-[11px] text-red-600 ml-1">{v.error}</span>}</td></tr>))} />
    </div>
  );
}

export function ApprovalsTab() {
  const { cid } = useApp();
  const [mine, setMine] = useState(true);
  const [d, load] = useLoad(() => api.get(`/c/${cid}/approvals`, { params: { mine } }).then((r) => r.data), [cid, mine]);
  const act = async (a, action) => {
    const remarks = action === "reject" ? window.prompt("Reason for rejection (mandatory):") : "";
    if (action === "reject" && !remarks) return;
    try { await api.post(`/c/${cid}/approvals/${a.id}/act`, { action, remarks }); toast.success(action === "approve" ? "Approved" : "Rejected"); load(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <div>
      <div className="flex gap-2 mb-2">{[[true, "My Tasks inbox"], [false, "All approvals"]].map(([v, l]) => <button key={l} onClick={() => setMine(v)} className={`px-3 h-8 rounded text-[12px] ${mine === v ? "brand-btn" : "bg-white border"}`} data-testid={`approvals-${v ? "mine" : "all"}`}>{l}</button>)}</div>
      <Tbl testid="approvals-table" head={["Submitted", "Type", "Title", "Amount", "Levels", "Waiting on", ""]} rows={(d || []).map((a) => (
        <tr key={a.id}><td>{dmy(a.submitted_at)}<div className="text-[11px] text-slate-500">{a.submitted_by}</div></td><td><Badge t="blue">{a.kind === "gonogo" ? "Go/No-Go" : a.entity}</Badge></td><td>{a.title}</td><td className="n">{inr(a.amount)}</td>
          <td className="text-[11px]">{a.levels.map((l, i) => <div key={i}>{i + 1}. {l.role}: <b>{l.status}</b>{l.by && ` (${l.by})`}{l.remarks && ` — ${l.remarks}`}</div>)}</td>
          <td>{a.status === "Pending" ? a.pending_role : <Badge>{a.status}</Badge>}</td>
          <td>{a.can_act && <div className="flex gap-1"><Btn onClick={() => act(a, "approve")} data-testid={`approve-${a.id}`}>{a.kind === "gonogo" ? "Go" : "Approve"}</Btn><Btn variant="danger" onClick={() => act(a, "reject")} data-testid={`reject-${a.id}`}>{a.kind === "gonogo" ? "No-Go" : "Reject"}</Btn></div>}</td></tr>))} />
    </div>
  );
}

function CalendarTab() {
  const { cid } = useApp();
  const [d] = useLoad(() => api.get(`/c/${cid}/calendar`).then((r) => r.data), [cid]);
  const [m, setM] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const start = new Date(m); start.setDate(1 - ((m.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return x; });
  const key = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const tone = (k) => (k.includes("Tender") || k.includes("Pre-bid") ? "bg-indigo-50 text-indigo-800" : k === "Task" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800");
  return (
    <div className="bg-white border rounded-lg p-3" data-testid="calendar">
      <div className="flex items-center gap-2 mb-2"><button onClick={() => setM(new Date(m.getFullYear(), m.getMonth() - 1, 1))}><ChevronLeft className="w-4 h-4" /></button><b className="w-40 text-center">{m.toLocaleString("en-IN", { month: "long", year: "numeric" })}</b><button onClick={() => setM(new Date(m.getFullYear(), m.getMonth() + 1, 1))} data-testid="calendar-next"><ChevronRight className="w-4 h-4" /></button></div>
      <div className="grid grid-cols-7 gap-px bg-slate-200 border">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((x) => <div key={x} className="bg-slate-50 text-[11px] p-1 font-semibold">{x}</div>)}
        {days.map((x) => { const ev = (d || []).filter((e) => e.date === key(x)); return (
          <div key={key(x)} className={`bg-white min-h-[86px] p-1 ${x.getMonth() !== m.getMonth() ? "opacity-40" : ""}`}><div className="text-[11px] text-slate-500">{x.getDate()}</div>
            {ev.slice(0, 3).map((e, i) => <div key={i} className={`text-[10px] rounded px-1 mb-0.5 truncate ${tone(e.kind)}`} title={e.title}>{e.title}</div>)}{ev.length > 3 && <div className="text-[10px] text-slate-500">+{ev.length - 3} more</div>}</div>); })}
      </div>
    </div>
  );
}

function AuditTab() {
  const { cid } = useApp();
  const [d] = useLoad(() => api.get(`/c/${cid}/audit`).then((r) => r.data), [cid]);
  const [v, setV] = useState(null);
  return (
    <div>
      <div className="flex items-center gap-2 mb-2"><Btn variant="outline" onClick={() => api.get("/audit/verify").then((r) => setV(r.data))} data-testid="audit-verify"><ShieldCheck className="w-3.5 h-3.5" />Verify tamper-proof chain</Btn>{v && <Badge t={v.valid ? "green" : "red"}>{v.valid ? `Chain intact · ${v.checked} entries` : `Broken at #${v.broken_at}`}</Badge>}</div>
      <Tbl testid="audit-table" head={["#", "When", "User", "Action", "Entity", "Changes"]} rows={(d || []).slice(0, 300).map((a) => (
        <tr key={a.id}><td className="font-mono text-[11px]">{a.seq}</td><td>{dmy(a.at)} {a.at.slice(11, 16)}</td><td>{a.user_name}</td><td><Badge t="blue">{a.action}</Badge></td><td>{a.entity}</td><td className="text-[11px] max-w-[420px] truncate">{a.note || Object.keys(a.changes || {}).filter((k) => !["created_at", "created_by"].includes(k)).slice(0, 6).join(", ")}</td></tr>))} />
    </div>
  );
}

function PdfsTab() {
  const { cid } = useApp();
  const [regKey, setReg] = useState("ra_bills");
  const [id, setId] = useState(null);
  const regs = { rfqs: "RFQ", pos: "Purchase order", work_orders: "Work order", ra_bills: "RA bill", invoices: "Tax invoice", payslips: "Payslip", hr_letters: "HR letter", sub_bills: "Subcontractor bill", grns: "GRN", change_orders: "Change order", dprs: "DPR" };
  return (
    <div className="bg-white border rounded-lg p-4 space-y-3 max-w-2xl">
      <p className="text-[12px] text-slate-600">Branded PDFs with company letterhead colours, auto-numbering (company/state/FY/type), DRAFT watermark until approved, signature stamp and QR verification code.</p>
      <div className="grid grid-cols-2 gap-3"><select className={inputCls} value={regKey} onChange={(e) => { setReg(e.target.value); setId(null); }} data-testid="pdf-type">{Object.entries(regs).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <RefSelect cid={cid} reg={regKey} value={id} onChange={setId} testid="pdf-record" /></div>
      <div className="flex gap-2"><Btn disabled={!id} onClick={() => openBlob(`/c/${cid}/pdf/${regKey}/${id}`)} data-testid="pdf-generate">Generate PDF</Btn>
        {regKey === "ra_bills" && <Btn variant="accent" disabled={!id} onClick={() => openBlob(`/c/${cid}/ra_bills/${id}/pack`)} data-testid="ra-pack-btn">RA Bill Submission Pack</Btn>}</div>
    </div>
  );
}

function AlertsTab() {
  const { cid } = useApp();
  const [d, load] = useLoad(() => api.get(`/c/${cid}/alerts`).then((r) => r.data), [cid]);
  return <Tbl testid="alerts-table" head={["Alert", "Date", "Days left", "Rule", ""]} rows={(d || []).map((a) => (
    <tr key={a.id}><td><Badge t={a.severity === "danger" ? "red" : "amber"}>{a.severity}</Badge> {a.title}{a.message && <div className="text-[11px] text-slate-500">{a.message}</div>}</td><td>{dmy(a.date)}</td><td className="n">{a.days_left}</td><td>{a.rule}</td>
      <td>{a.stored && <Btn variant="ghost" onClick={() => api.post(`/c/${cid}/alerts/${a.id}/read`).then(load)}>Dismiss</Btn>}</td></tr>))} />;
}

function EmailsTab() {
  const { cid } = useApp();
  const [d, load] = useLoad(() => api.get(`/c/${cid}/emails`).then((r) => r.data), [cid]);
  const [view, setView] = useState(null);
  const [att, setAtt] = useState({ entity: "projects", entity_id: null });
  const open = async (e) => setView((await api.get(`/c/${cid}/emails/${e.id}`)).data);
  const attach = async () => { try { await api.post(`/c/${cid}/emails/${view.id}/attach`, att); toast.success("Attached"); setView(null); load(); } catch (e) { toast.error(errMsg(e)); } };
  const retry = async (e) => { const r = (await api.post(`/c/${cid}/emails/retry/${e.id}`)).data; toast[r.status === "Sent" ? "success" : "error"](`Email ${r.status}`, { description: r.error }); load(); };
  return (
    <div>
      <Tbl testid="email-log" head={["Sent", "To", "Subject", "Status", "Attached to", ""]} rows={(d || []).map((e) => (
        <tr key={e.id} className="cursor-pointer" onClick={() => open(e)}><td>{dmy(e.at)} {e.at.slice(11, 16)}</td><td>{e.to}</td><td className="max-w-[360px] truncate">{e.subject}</td><td><Badge>{e.status}</Badge>{e.error && <div className="text-[10px] text-red-600 max-w-[240px] truncate">{e.error}</div>}</td>
          <td className="text-[11px]">{(e.attached_to || []).map((a) => a.entity).join(", ") || <span className="text-amber-700">Untriaged</span>}</td>
          <td onClick={(x) => x.stopPropagation()}>{e.status === "Failed" && <Btn variant="outline" onClick={() => retry(e)}>Retry</Btn>}</td></tr>))} />
      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="bg-white max-w-3xl" data-testid="email-view">
          <DialogHeader><DialogTitle>{view?.subject}</DialogTitle></DialogHeader>
          <iframe title="email" srcDoc={view?.html} className="w-full h-80 border rounded" />
          <div className="flex items-end gap-2"><label className="text-[12px]">Attach to<select className={inputCls} value={att.entity} onChange={(e) => setAtt({ entity: e.target.value, entity_id: null })}>{["projects", "tenders", "vendors", "tasks"].map((x) => <option key={x}>{x}</option>)}</select></label>
            <div className="w-72"><RefSelect cid={cid} reg={att.entity} value={att.entity_id} onChange={(v) => setAtt({ ...att, entity_id: v })} testid="triage-record" /></div><Btn onClick={attach} disabled={!att.entity_id} data-testid="triage-attach">Attach</Btn></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClientViewsTab() {
  const { cid } = useApp();
  const [d] = useLoad(() => api.get(`/c/${cid}/client-views`).then((r) => r.data), [cid]);
  return <Tbl testid="client-views" head={["When", "Client user", "Viewed"]} rows={(d || []).map((v) => <tr key={v.id}><td>{dmy(v.at)} {v.at.slice(11, 16)}</td><td>{v.user}</td><td>{v.what}</td></tr>)} />;
}

export const CUSTOM = {
  _payroll: PayrollTab, _staging: StagingTab, _stock: StockTab, _unbilled: UnbilledTab, _budget: BudgetTab, _closure: ClosureTab,
  _archive: () => <RegisterTable reg="projects" filter={{ status: "Closed" }} title="Completed projects (read-only archive)" hideAdd />,
  _clientviews: ClientViewsTab, _vouchers: VouchersTab, _approvals: ApprovalsTab, _calendar: CalendarTab, _audit: AuditTab, _pdfs: PdfsTab, _alerts: AlertsTab, _emails: EmailsTab,
};
