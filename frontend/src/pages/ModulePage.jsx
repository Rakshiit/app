import React, { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api, errMsg, openBlob } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { MODULES, REG, CUSTOM_TABS } from "@/config/registers";
import RegisterTable from "@/components/RegisterTable";
import { CUSTOM } from "@/components/CustomTabs";
import { RfqActions, PoActions } from "@/components/Procurement";
import { PageHeader, Btn, Badge, RefSelect } from "@/components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { UserCheck, KeyRound, Package, Star, ShieldAlert } from "lucide-react";

function EmpActions({ r, load }) {
  const { cid } = useApp();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState([]);
  const verify = async () => { try { const x = (await api.post(`/c/${cid}/employees/${r.id}/verify-docs`, { verified: sel })).data; toast.success(x.docs_verified ? "All mandatory docs verified — login unlocked" : "Saved; mandatory docs still pending"); setOpen(false); load(); } catch (e) { toast.error(errMsg(e)); } };
  const login = async () => { if (!r.email) return toast.error("Employee has no email"); try { const x = (await api.post(`/c/${cid}/employees/${r.id}/create-login`, {})).data; toast.success(`Login created (Welcome@123)${x.onboarding_locked ? " — locked until HR verifies documents" : ""}`); } catch (e) { toast.error(errMsg(e)); } };
  return (<>
    <button title="Verify onboarding documents" className="p-1 rounded hover:bg-slate-100" onClick={() => { setSel((r.onboarding_docs || []).filter((d) => d.verified).map((d) => d.name)); setOpen(true); }} data-testid={`emp-verify-${r.id}`}><UserCheck className="w-3.5 h-3.5 text-emerald-700" /></button>
    <button title="Create login" className="p-1 rounded hover:bg-slate-100" onClick={login}><KeyRound className="w-3.5 h-3.5" /></button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="bg-white max-w-md"><DialogHeader><DialogTitle>Onboarding gate · {r.name}</DialogTitle></DialogHeader>
      <p className="text-[12px] text-slate-500">Stage 1: documents collected. Stage 2: HR verifies. Login stays locked until all mandatory documents are verified.</p>
      {(r.onboarding_docs || [{ name: "Aadhaar", mandatory: true }, { name: "PAN", mandatory: true }, { name: "Bank details", mandatory: true }]).map((d) => (
        <label key={d.name} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={sel.includes(d.name)} onChange={(e) => setSel(e.target.checked ? [...sel, d.name] : sel.filter((x) => x !== d.name))} data-testid={`verify-doc-${d.name}`} />{d.name} {d.mandatory !== false && <Badge t="amber">mandatory</Badge>}</label>))}
      <Btn onClick={verify} data-testid="verify-docs-save">Save verification</Btn></DialogContent></Dialog>
  </>);
}

function IncidentActions({ r, load }) {
  const { cid } = useApp();
  const [open, setOpen] = useState(false);
  const [ins, setIns] = useState(null);
  const go = async () => { try { await api.post(`/c/${cid}/incidents/${r.id}/insurance-claim`, { insurance_id: ins, amount: Number(window.prompt("Claim amount (₹):") || 0) }); toast.success("Insurance claim started"); setOpen(false); load(); } catch (e) { toast.error(errMsg(e)); } };
  return (<><button title="Start insurance claim" className="p-1 rounded hover:bg-slate-100" onClick={() => setOpen(true)}><ShieldAlert className="w-3.5 h-3.5 text-amber-700" /></button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="bg-white max-w-md"><DialogHeader><DialogTitle>Start insurance claim</DialogTitle></DialogHeader><RefSelect cid={cid} reg="insurance" value={ins} onChange={setIns} /><Btn onClick={go} disabled={!ins}>File claim</Btn></DialogContent></Dialog></>);
}

const ACTIONS = {
  rfqs: (r, l) => <RfqActions r={r} load={l} />,
  pos: (r, l) => <PoActions r={r} load={l} />,
  employees: (r, l) => <EmpActions r={r} load={l} />,
  incidents: (r, l) => <IncidentActions r={r} load={l} />,
};

export function useRegActions(cid) {
  return {
    ...ACTIONS,
    ra_bills: (r) => <button title="Submission pack" className="p-1 rounded hover:bg-slate-100" onClick={() => openBlob(`/c/${cid}/ra_bills/${r.id}/pack`)} data-testid={`ra-pack-${r.id}`}><Package className="w-3.5 h-3.5 text-indigo-700" /></button>,
    subcontractors: (r, l) => <button title="Recompute rating (NCR aware)" className="p-1 rounded hover:bg-slate-100" onClick={async () => { const x = (await api.get(`/c/${cid}/subcontractors/${r.id}/rating`)).data; toast.success(`Score ${x.score} (avg WO ${x.avg_wo_rating}, ${x.ncr_total} NCRs, ${x.ncr_open} open)`); l(); }}><Star className="w-3.5 h-3.5 text-amber-600" /></button>,
  };
}

export default function ModulePage() {
  const { mod } = useParams();
  const [sp, setSp] = useSearchParams();
  const { cid, user } = useApp();
  const m = MODULES.find((x) => x.key === mod);
  const actions = useRegActions(cid);
  if (!m) return "Unknown module";
  const tabs = m.tabs.filter((t) => !user.hidden_tabs?.includes(t));
  const tab = sp.get("tab") && tabs.includes(sp.get("tab")) ? sp.get("tab") : tabs[0];
  const C = CUSTOM[tab];
  return (
    <div className="fade-up">
      <PageHeader title={`${m.key} · ${m.title}`} />
      <div className="flex flex-wrap gap-1 mb-3 border-b border-slate-200" data-testid="module-tabs">
        {tabs.map((t) => (
          <button key={t} onClick={() => setSp({ tab: t })} className={`px-3 py-1.5 text-[12px] font-medium rounded-t-md -mb-px border ${t === tab ? "bg-white border-slate-200 border-b-white brand-text" : "border-transparent text-slate-600 hover:text-slate-900"}`} data-testid={`tab-${t}`}>
            {CUSTOM_TABS[t] || REG[t]?.title || t}
          </button>
        ))}
      </div>
      {C ? <C /> : <RegisterTable key={tab} reg={tab} actions={actions[tab]} />}
    </div>
  );
}
