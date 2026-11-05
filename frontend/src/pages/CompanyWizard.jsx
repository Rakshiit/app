import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { Btn, inputCls, FileField, Badge } from "@/components/common";
import RegisterTable from "@/components/RegisterTable";
import { PRESETS, contrast, applyTheme } from "@/lib/fmt";
import { toast } from "sonner";
import { Plus, Trash2, Check } from "lucide-react";

const STEPS = ["Statutory identity", "Banks, branding & Tally", "Document vault", "Colour theme"];

function Grid({ rows, cols, onChange, testid }) {
  return (
    <div className="border rounded-md" data-testid={testid}>
      <table className="erp-table w-full"><thead><tr>{cols.map(([k, l]) => <th key={k}>{l}</th>)}<th /></tr></thead>
        <tbody>{(rows || []).map((r, i) => (
          <tr key={i}>{cols.map(([k, , t]) => <td key={k}><input className={inputCls} type={t || "text"} value={r[k] ?? ""} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [k]: t === "number" ? Number(e.target.value) : e.target.value } : x)))} /></td>)}
            <td><button onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5 text-slate-400" /></button></td></tr>))}
        </tbody></table>
      <button className="text-[12px] brand-text p-2 inline-flex items-center gap-1" onClick={() => onChange([...(rows || []), {}])} data-testid={`${testid}-add`}><Plus className="w-3.5 h-3.5" />Add row</button>
    </div>
  );
}

export default function CompanyWizard() {
  const { id } = useParams();
  const nav = useNavigate();
  const { selectCompany, refreshCompany, company } = useApp();
  const [step, setStep] = useState(0);
  const [c, setC] = useState({ gstins: [{}], banks: [{}], signatories: [{}], theme: { preset: "ocean-instinct", ...PRESETS["ocean-instinct"] } });
  const [busy, setBusy] = useState(false);
  const [cid, setCid] = useState(id);
  useEffect(() => { if (id) api.get(`/companies/${id}`).then((r) => setC(r.data)); }, [id]);
  const F = (k, l, ph) => (
    <label className="block"><span className="text-[11px] font-medium text-slate-600">{l}</span><input className={inputCls} placeholder={ph} value={c[k] ?? ""} onChange={(e) => setC({ ...c, [k]: e.target.value })} data-testid={`company-${k}`} /></label>
  );
  const t = c.theme || {};
  const ratio = contrast(t.primary || "#000", "#FFFFFF");
  const save = async (next) => {
    setBusy(true);
    try {
      let r;
      if (cid) r = (await api.put(`/companies/${cid}`, c)).data;
      else { r = (await api.post("/companies", c)).data; setCid(r.id); }
      setC(r);
      if (next === "done") {
        toast.success("Company saved");
        if (company?.id === r.id) await refreshCompany(); else await selectCompany(r);
        nav("/dashboard");
      } else setStep(next);
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  return (
    <div className="min-h-screen bg-[#F4F6F9] p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4"><h1 className="text-2xl font-heading font-semibold">{id ? "Company settings" : "Create new company"}</h1><Btn variant="outline" onClick={() => nav(-1)}>Back</Btn></div>
        <div className="flex gap-2 mb-4">{STEPS.map((s, i) => (
          <button key={s} onClick={() => (cid || i === 0) && setStep(i)} className={`flex-1 text-left p-3 rounded-lg border ${step === i ? "bg-white border-slate-400" : "bg-slate-50 border-slate-200"}`} data-testid={`wizard-step-${i + 1}`}>
            <div className="text-[11px] text-slate-500">Step {i + 1}</div><div className="font-medium text-[13px]">{s}</div></button>))}
        </div>
        <div className="bg-white border rounded-xl p-5 space-y-4">
          {step === 0 && (<>
            <div className="grid sm:grid-cols-3 gap-3">{F("name", "Legal name *")}{F("short_code", "Short code * (used in numbering)", "JKEE")}{F("default_state", "Home state code", "JK")}{F("pan", "PAN")}{F("cin", "CIN")}{F("address", "Registered address")}{F("epf_no", "EPF code")}{F("esic_no", "ESIC code")}{F("pt_no", "PT registration")}{F("avg_turnover", "Avg turnover (₹)")}</div>
            <div><div className="font-semibold text-[13px] mb-1">Multi-state GSTIN grid</div><Grid testid="gstin-grid" rows={c.gstins} cols={[["state", "State code"], ["gstin", "GSTIN"], ["address", "Address"]]} onChange={(g) => setC({ ...c, gstins: g })} /></div>
            <Btn onClick={() => save(1)} loading={busy} data-testid="wizard-next">Save & continue</Btn>
          </>)}
          {step === 1 && (<>
            <div><div className="font-semibold text-[13px] mb-1">Banks & BG limits</div><Grid testid="bank-grid" rows={c.banks} cols={[["bank", "Bank"], ["account", "Account no"], ["ifsc", "IFSC"], ["bg_limit", "BG limit (₹)", "number"]]} onChange={(g) => setC({ ...c, banks: g })} /></div>
            <div><div className="font-semibold text-[13px] mb-1">Authorised signatories</div><Grid testid="sign-grid" rows={c.signatories} cols={[["name", "Name"], ["designation", "Designation"]]} onChange={(g) => setC({ ...c, signatories: g })} /></div>
            <div className="grid sm:grid-cols-3 gap-3">{F("tally_company", "Tally company name")}{F("reply_to", "Reply-to inbox for outgoing emails")}
              <label className="block"><span className="text-[11px] font-medium text-slate-600">Logo</span><FileField cid={cid} value={c.logo_file_id} onChange={(v) => setC({ ...c, logo_file_id: v })} /></label>
              <label className="block"><span className="text-[11px] font-medium text-slate-600">Letterhead</span><FileField cid={cid} value={c.letterhead_file_id} onChange={(v) => setC({ ...c, letterhead_file_id: v })} /></label></div>
            <Btn onClick={() => save(2)} loading={busy} data-testid="wizard-next">Save & continue</Btn>
          </>)}
          {step === 2 && cid && (<>
            <p className="text-[12px] text-slate-500">Vault tabs: Registrations & Tax, Licences, Financial & Eligibility, Authorisations. Upload with the same doc key to create a new version (older versions are locked). Expiry alerts fire at 30/15/7/1 days.</p>
            <VaultTable cid={cid} />
            <Btn onClick={() => setStep(3)} data-testid="wizard-next">Continue</Btn>
          </>)}
          {step === 3 && (<>
            <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-2">{Object.entries(PRESETS).map(([k, p]) => (
              <button key={k} onClick={() => { const th = { preset: k, primary: p.primary, surface: p.surface, accent: p.accent }; setC({ ...c, theme: th }); applyTheme(th); }} className={`border rounded-lg p-2 text-left ${t.preset === k ? "ring-2 ring-slate-800" : ""}`} data-testid={`preset-${k}`}>
                <div className="flex h-8 rounded overflow-hidden">{[p.primary, p.surface, p.accent].map((x) => <span key={x} className="flex-1" style={{ background: x }} />)}</div><div className="text-[11px] mt-1 font-medium">{p.name}</div></button>))}
            </div>
            <div className="flex flex-wrap items-end gap-4">{["primary", "surface", "accent"].map((k) => (
              <label key={k} className="text-[12px]"><span className="block capitalize mb-1">{k}</span><input type="color" value={t[k] || "#000000"} onChange={(e) => { const th = { ...t, preset: "custom", [k]: e.target.value }; setC({ ...c, theme: th }); applyTheme(th); }} data-testid={`theme-${k}`} className="w-16 h-9" /></label>))}
              <div className="text-[12px]">Contrast vs white: <b className="num">{ratio.toFixed(2)}:1</b> {ratio < 3 ? <Badge t="amber">Guard active — dark text will be used on primary</Badge> : <Badge t="green">Readable</Badge>}</div>
            </div>
            <div className="border rounded-lg overflow-hidden flex h-32" data-testid="theme-preview"><div className="erp-sidebar w-40 p-3 text-[12px]">Sidebar<div className="nav-item active mt-2 px-2 py-1 rounded">Active item</div></div><div className="flex-1 erp-content p-3"><button className="brand-btn px-3 h-8 rounded text-[12px]">Primary action</button> <button className="accent-btn px-3 h-8 rounded text-[12px]">Accent</button></div></div>
            <Btn onClick={() => save("done")} loading={busy} data-testid="wizard-finish"><Check className="w-3.5 h-3.5" />Finish</Btn>
          </>)}
        </div>
      </div>
    </div>
  );
}

function VaultTable({ cid }) {
  const { selectCompany, company } = useApp();
  useEffect(() => { if (company?.id !== cid) api.get(`/companies/${cid}`).then((r) => selectCompany(r.data)); }, [cid]); // eslint-disable-line
  if (company?.id !== cid) return null;
  return <RegisterTable reg="vault_docs" />;
}
