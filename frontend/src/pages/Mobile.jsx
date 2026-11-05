import React, { useEffect, useState } from "react";
import { Routes, Route, useNavigate, Navigate } from "react-router-dom";
import { api, errMsg, uploadFile, openBlob } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { RecordForm } from "@/components/RegisterTable";
import { ApprovalsTab } from "@/components/CustomTabs";
import { Badge, RefSelect, inputCls } from "@/components/common";
import { OutboxBar, OutboxPanel } from "@/components/Outbox";
import { inr, dmy, today } from "@/lib/fmt";
import { toast } from "sonner";
import * as I from "lucide-react";

const TILES = [
  ["attendance", "Attendance", "MapPin"], ["dpr", "Daily progress", "HardHat"], ["requisition", "Material request", "PackagePlus"], ["transfer", "Stock transfer", "ArrowLeftRight"],
  ["checklist", "Checklist", "ListChecks"], ["trip", "Vehicle trip", "Truck"], ["claim", "Expense claim", "Wallet"], ["payslips", "Payslips & docs", "FileText"], ["approvals", "Approvals", "CheckSquare"],
];
const BigBtn = ({ children, ...p }) => <button {...p} className="w-full h-12 rounded-lg brand-btn font-semibold text-[15px] disabled:opacity-50">{children}</button>;

const gps = () => new Promise((res) => navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => res(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`), () => res("unavailable"), { timeout: 6000 }) : res("unavailable"));

function Attendance() {
  const { cid, user } = useApp();
  const [photo, setPhoto] = useState(null);
  const [pid, setPid] = useState(null);
  const [busy, setBusy] = useState(false);
  const mark = async () => {
    if (!user.employee_id) return toast.error("Your login is not linked to an employee record");
    setBusy(true);
    try {
      const g = await gps();
      const stamp = `${new Date().toLocaleString("en-IN")} | GPS ${g}`;
      const f = photo ? await uploadFile(cid, photo, "attendance", stamp) : null;
      await api.post(`/c/${cid}/r/attendance`, { employee_id: user.employee_id, employee_name: user.name, date: today(), status: "P", project_id: pid, mode: "Self (GPS)", gps: g, photo_id: f?.id, in_time: new Date().toTimeString().slice(0, 5) });
      toast.success(`Marked present · GPS ${g}`);
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  return (<div className="space-y-4">
    <RefSelect cid={cid} reg="projects" value={pid} onChange={setPid} testid="m-att-project" />
    <label className="block border-2 border-dashed rounded-lg p-6 text-center bg-white"><I.Camera className="w-8 h-8 mx-auto text-slate-500" /><div className="mt-2 text-[14px]">{photo ? photo.name : "Take selfie / site photo"}</div><input type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0])} data-testid="m-att-photo" /></label>
    <BigBtn onClick={mark} disabled={busy} data-testid="m-att-mark">{busy ? "Marking…" : "Mark present (GPS + photo)"}</BigBtn>
  </div>);
}

function RegForm({ reg, defaults, after, label }) {
  const { cid } = useApp();
  const [v, setV] = useState(defaults || {});
  const [busy, setBusy] = useState(false);
  const save = async (submit) => {
    setBusy(true);
    try {
      const resp = await api.post(`/c/${cid}/r/${reg}`, v);
      const r = resp.data;
      if (r?._queued) {
        toast.success("Saved offline — will sync when back online");
      } else {
        if (submit) await api.post(`/c/${cid}/r/${reg}/${r.id}/submit`);
        toast.success(submit ? "Saved & submitted for approval" : "Saved");
      }
      setV(defaults || {}); after?.();
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  const approvable = ["dprs", "requisitions", "stock_transfers", "claims"].includes(reg);
  return (<div className="space-y-4 bg-white rounded-lg p-3 border"><RecordForm reg={reg} value={v} onChange={setV} cid={cid} />
    <BigBtn onClick={() => save(approvable)} disabled={busy} data-testid={`m-${reg}-save`}>{label || (approvable ? "Save & submit" : "Save")}</BigBtn></div>);
}

function Checklist() {
  const { cid, user } = useApp();
  const [tpls, setTpls] = useState([]);
  const [t, setT] = useState(null);
  const [ticks, setTicks] = useState({});
  const [pid, setPid] = useState(null);
  useEffect(() => { api.get(`/c/${cid}/r/checklists`).then((r) => setTpls(r.data)); }, [cid]);
  const save = async () => {
    const n = (t.items || []).length, ok = Object.values(ticks).filter(Boolean).length;
    try { await api.post(`/c/${cid}/r/checklist_runs`, { checklist_id: t.id, project_id: pid, date: today(), score: Math.round((ok * 100) / (n || 1)), by: user.name, answers: ticks }); toast.success("Checklist submitted"); setT(null); setTicks({}); } catch (e) { toast.error(errMsg(e)); }
  };
  if (!t) return <div className="space-y-2">{tpls.map((x) => <button key={x.id} onClick={() => setT(x)} className="w-full text-left bg-white border rounded-lg p-4 text-[15px]">{x.name}<div className="text-[12px] text-slate-500">{x.category}</div></button>)}</div>;
  return (<div className="space-y-3"><RefSelect cid={cid} reg="projects" value={pid} onChange={setPid} />{(t.items || []).map((it) => (
    <label key={it} className="flex items-center gap-3 bg-white border rounded-lg p-4 text-[15px]"><input type="checkbox" className="w-6 h-6" checked={!!ticks[it]} onChange={(e) => setTicks({ ...ticks, [it]: e.target.checked })} />{it}</label>))}
    <BigBtn onClick={save} data-testid="m-checklist-save">Submit checklist</BigBtn></div>);
}

function Payslips() {
  const { cid, user } = useApp();
  const [d, setD] = useState([]);
  useEffect(() => { api.get(`/c/${cid}/r/payslips`).then((r) => setD(r.data.filter((p) => !user.employee_id || p.employee_id === user.employee_id))); }, [cid, user]);
  return <div className="space-y-2">{d.map((p) => <button key={p.id} onClick={() => openBlob(`/c/${cid}/pdf/payslips/${p.id}`)} className="w-full flex items-center justify-between bg-white border rounded-lg p-4"><span><b>{p.month}</b> · {p.employee_name}</span><span className="num">{inr(p.net_pay)}</span></button>)}{!d.length && <p className="text-center text-slate-500 py-6">No payslips yet</p>}</div>;
}

function Home() {
  const nav = useNavigate();
  const { user, company } = useApp();
  return (<div>
    <OutboxBar onOpen={() => nav("/mobile/outbox")} />
    <div className="erp-sidebar rounded-xl p-4 mb-4"><div className="text-[12px] opacity-80">{company?.name}</div><div className="text-lg font-heading font-semibold">Hi, {user.name?.split(" ")[0]}</div><div className="text-[12px] opacity-80">{dmy(today())} · {navigator.onLine ? "online mode" : "offline mode"}</div></div>
    <div className="grid grid-cols-3 gap-3">{TILES.map(([k, l, ic]) => { const Ic = I[ic]; return <button key={k} onClick={() => nav(`/mobile/${k}`)} className="mobile-tile bg-white border rounded-xl flex flex-col items-center justify-center gap-2 text-[12px] font-medium active:scale-95" data-testid={`m-tile-${k}`}><Ic className="w-6 h-6 brand-text" />{l}</button>; })}</div>
  </div>);
}

export default function Mobile() {
  const { user, company, loading, logout } = useApp();
  const nav = useNavigate();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  if (!company) return <Navigate to="/launchpad" />;
  const Screen = ({ title, children }) => (<div><div className="flex items-center gap-2 mb-3"><button onClick={() => nav("/mobile")} className="p-2 -ml-2" data-testid="m-back"><I.ChevronLeft className="w-5 h-5" /></button><h1 className="text-lg font-heading font-semibold">{title}</h1></div>{children}</div>);
  return (
    <div className="mobile-shell pb-20" data-testid="mobile-app">
      <div className="p-4">
        <Routes>
          <Route index element={<Home />} />
          <Route path="attendance" element={<Screen title="Attendance"><Attendance /></Screen>} />
          <Route path="dpr" element={<Screen title="Daily progress report"><RegForm reg="dprs" defaults={{ date: today() }} /></Screen>} />
          <Route path="requisition" element={<Screen title="Material requisition"><RegForm reg="requisitions" defaults={{ date: today() }} /></Screen>} />
          <Route path="transfer" element={<Screen title="Stock transfer"><RegForm reg="stock_transfers" defaults={{ date: today() }} /></Screen>} />
          <Route path="checklist" element={<Screen title="Checklist"><Checklist /></Screen>} />
          <Route path="trip" element={<Screen title="Vehicle trip"><RegForm reg="trips" defaults={{ date: today() }} /></Screen>} />
          <Route path="claim" element={<Screen title="Expense claim"><RegForm reg="claims" defaults={{ date: today(), employee_id: user.employee_id, employee_name: user.name }} /></Screen>} />
          <Route path="payslips" element={<Screen title="Payslips"><Payslips /></Screen>} />
          <Route path="outbox" element={<Screen title="Offline outbox"><OutboxPanel /></Screen>} />
          <Route path="approvals" element={<Screen title="Approvals"><div className="overflow-x-auto"><ApprovalsTab /></div></Screen>} />
        </Routes>
      </div>
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t"><div className="max-w-[520px] mx-auto grid grid-cols-4">
        {[["/mobile", "Home", "Home"], ["/mobile/approvals", "Approvals", "CheckSquare"], ["/mobile/payslips", "Payslips", "FileText"], ["/dashboard", "Desktop", "Monitor"]].map(([to, l, ic]) => { const Ic = I[ic]; return <button key={to} onClick={() => nav(to)} className="h-14 flex flex-col items-center justify-center text-[11px]" data-testid={`m-nav-${l.toLowerCase()}`}><Ic className="w-5 h-5" />{l}</button>; })}
      </div></nav>
    </div>
  );
}
