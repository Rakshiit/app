import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, errMsg, BASE, reg as R } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { PageHeader, Btn, Badge, Kpi, inputCls } from "@/components/common";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import BOQStudio from "@/components/BOQStudio";
import { inr, dmy, crore } from "@/lib/fmt";
import { toast } from "sonner";
import * as I from "lucide-react";

// -------------------------------------------------------------------
//  Pipeline page: stage tabs + list per stage + add + bulk import
// -------------------------------------------------------------------
const STAGES = [
  { k: "Draft",              label: "Draft",              icon: "FilePlus",      tone: "bg-slate-100" },
  { k: "Pending Director",   label: "Pending Director",   icon: "UserCheck",     tone: "bg-amber-50" },
  { k: "Approved - Study",   label: "Approved — Study",    icon: "BookOpen",      tone: "bg-blue-50" },
  { k: "BOQ & RFQ",          label: "BOQ & RFQ",          icon: "Mails",         tone: "bg-indigo-50" },
  { k: "Costing Locked",     label: "Costing Locked",     icon: "Lock",          tone: "bg-purple-50" },
  { k: "Pending MD",         label: "Pending MD",         icon: "Crown",         tone: "bg-amber-50" },
  { k: "MD Approved",        label: "MD Approved",        icon: "ShieldCheck",   tone: "bg-emerald-50" },
  { k: "Quoted",             label: "Quoted",             icon: "Send",          tone: "bg-emerald-50" },
  { k: "Won",                label: "Won",                icon: "Trophy",        tone: "bg-emerald-100" },
  { k: "Lost",               label: "Lost",               icon: "XCircle",       tone: "bg-red-50" },
  { k: "Rejected",           label: "Rejected (pre-study)", icon: "Ban",         tone: "bg-red-50" },
];

export function Tenders() {
  const { cid } = useApp();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [active, setActive] = useState(sp.get("stage") || "Draft");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const q = sp.get("q") || "";

  const load = async () => {
    try {
      const [tRows, pipe] = await Promise.all([
        R(cid, "tenders").list(),
        api.get(`/c/${cid}/pretender/pipeline`),
      ]);
      setRows(tRows);
      setCounts(pipe.data.counts || {});
    } catch (e) { toast.error(errMsg(e)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [cid]);

  const shown = useMemo(() => {
    const inStage = rows.filter((t) => (t.stage || "Draft") === active);
    if (!q) return inStage;
    return inStage.filter((t) => `${t.tender_no} ${t.title} ${t.department || ""}`.toLowerCase().includes(q.toLowerCase()));
  }, [rows, active, q]);

  return (
    <div className="fade-up">
      <PageHeader title="M1 · Pre-Tender pipeline" subtitle="Intake → Director approval → BOQ/NIT study → RFQ matrix → MD approval → Quote → Won/Lost">
        <div className="flex items-center gap-2">
          <input className={`${inputCls} w-56`} placeholder="Search tender…" value={q} onChange={(e) => setSp({ stage: active, q: e.target.value })} data-testid="tender-search" />
          <Btn variant="outline" onClick={() => setImportOpen(true)} data-testid="tender-bulk-import"><I.Upload className="w-3.5 h-3.5 mr-1" />Bulk Excel</Btn>
          <Btn onClick={() => setAddOpen(true)} data-testid="tender-add"><I.Plus className="w-3.5 h-3.5 mr-1" />Add tender</Btn>
        </div>
      </PageHeader>

      <div className="bg-white border rounded-lg p-1 mb-3 overflow-x-auto scroll-thin">
        <div className="flex gap-1 whitespace-nowrap">
          {STAGES.map((s) => {
            const IC = I[s.icon] || I.Circle;
            const act = active === s.k;
            return (
              <button key={s.k} onClick={() => { setActive(s.k); setSp({ stage: s.k, q }); }}
                className={`px-3 h-9 rounded-md text-[12px] font-medium flex items-center gap-2 ${act ? "brand-btn" : "hover:bg-slate-50"}`}
                data-testid={`stage-tab-${s.k}`}>
                <IC className="w-3.5 h-3.5" />
                {s.label}
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${act ? "bg-white/20" : "bg-slate-100"}`}>{counts[s.k] || 0}</span>
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="bg-white border rounded-lg p-10 text-center text-slate-500">
          <I.Inbox className="w-8 h-8 mx-auto mb-2 text-slate-400" />
          No tenders in “{active}”.
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="erp-table w-full" data-testid="tender-list">
            <thead><tr><th>Tender</th><th>Dept / Client</th><th className="text-right">Value</th><th className="text-right">EMD</th><th>Due</th><th>Last update</th></tr></thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} onClick={() => nav(`/tenders/${t.id}`)} className="cursor-pointer hover:bg-slate-50" data-testid={`tender-row-${t.id}`}>
                  <td><div className="text-[12px] font-mono text-slate-500">{t.tender_no}</div><div className="text-[13px] font-medium line-clamp-1">{t.title}</div></td>
                  <td className="text-[12px]">{t.department || t.client || "—"}<div className="text-[11px] text-slate-500">{t.location || "—"}</div></td>
                  <td className="text-right text-[12px]">{t.estimated_value ? crore(t.estimated_value) : "—"}</td>
                  <td className="text-right text-[12px]">{t.emd ? inr(t.emd) : "—"}</td>
                  <td className="text-[12px]">{dmy(t.bid_due_date) || "—"}</td>
                  <td className="text-[12px] text-slate-500">{dmy(t.updated_at)}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
      )}

      <AddTenderDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={(t) => { setAddOpen(false); nav(`/tenders/${t.id}`); }} />
      <BulkImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); load(); }} />
    </div>
  );
}

// -------------------------------------------------------------------
//  Add tender dialog — only 5 fields as per spec
// -------------------------------------------------------------------
function AddTenderDialog({ open, onClose, onSaved }) {
  const { cid } = useApp();
  const [v, setV] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setV({}); }, [open]);
  const save = async () => {
    if (!v.tender_no || !v.title) return toast.error("Tender ID and Name are required");
    setBusy(true);
    try {
      const t = (await api.post(`/c/${cid}/r/tenders`, { ...v,
        estimated_value: Number(v.estimated_value) || 0,
        emd: Number(v.emd) || 0,
        stage: "Draft" })).data;
      toast.success("Tender added in Draft");
      onSaved?.(t);
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white max-w-md" data-testid="tender-add-dialog">
        <DialogHeader><DialogTitle>Add new tender</DialogTitle></DialogHeader>
        <div className="space-y-2 text-[13px]">
          <label className="block"><span className="text-[11px] font-medium">Tender ID *</span><input className={inputCls} value={v.tender_no || ""} onChange={(e) => setV({ ...v, tender_no: e.target.value })} data-testid="new-tender-no" /></label>
          <label className="block"><span className="text-[11px] font-medium">Name *</span><input className={inputCls} value={v.title || ""} onChange={(e) => setV({ ...v, title: e.target.value })} data-testid="new-tender-title" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-[11px] font-medium">Amount (₹)</span><input type="number" className={inputCls} value={v.estimated_value || ""} onChange={(e) => setV({ ...v, estimated_value: e.target.value })} data-testid="new-tender-value" /></label>
            <label className="block"><span className="text-[11px] font-medium">EMD (₹)</span><input type="number" className={inputCls} value={v.emd || ""} onChange={(e) => setV({ ...v, emd: e.target.value })} data-testid="new-tender-emd" /></label>
          </div>
          <label className="block"><span className="text-[11px] font-medium">Closing date</span><input type="date" className={inputCls} value={v.bid_due_date || ""} onChange={(e) => setV({ ...v, bid_due_date: e.target.value })} data-testid="new-tender-due" /></label>
        </div>
        <DialogFooter><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy} data-testid="new-tender-save">{busy ? "Saving…" : "Add tender"}</Btn></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------
//  Bulk Excel import dialog
// -------------------------------------------------------------------
function BulkImportDialog({ open, onClose, onDone }) {
  const { cid } = useApp();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);
  const upload = async (f) => {
    setBusy(true); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", f);
      const r = (await api.post(`/c/${cid}/pretender/bulk-import`, fd, { headers: { "Content-Type": "multipart/form-data" } })).data;
      setResult(r);
      toast.success(`Imported ${r.created} tender(s)`);
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  const downloadSample = () => {
    const token = localStorage.getItem("erp_token");
    fetch(`${BASE}/api/c/${cid}/pretender/import-template`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob()).then((b) => { const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = "tender-import-template.xlsx"; a.click(); URL.revokeObjectURL(u); });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white max-w-md" data-testid="tender-bulk-dialog">
        <DialogHeader><DialogTitle>Bulk import tenders</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]">
          <div className="text-[12px] text-slate-600">Upload an Excel with columns: Tender ID, Name, Amount, EMD, Closing Date. Duplicates by Tender ID are skipped.</div>
          <Btn variant="outline" onClick={downloadSample} data-testid="bulk-sample"><I.Download className="w-3.5 h-3.5 mr-1" />Download sample template</Btn>
          <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} data-testid="bulk-file" />
          <Btn onClick={() => inputRef.current?.click()} disabled={busy}><I.Upload className="w-3.5 h-3.5 mr-1" />{busy ? "Uploading…" : "Select Excel file"}</Btn>
          {result && (<div className="bg-slate-50 border rounded p-2 text-[12px]">
            <div><b>{result.created}</b> created · <b>{result.skipped}</b> skipped</div>
            {result.errors?.length > 0 && <ul className="text-red-600 mt-1">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          </div>)}
        </div>
        <DialogFooter><Btn onClick={() => { onClose(); onDone?.(); }}>Done</Btn></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------
//  Tender detail v2 — stage banner + tabs matching spec
// -------------------------------------------------------------------
export function TenderDetail() {
  const { id } = useParams();
  const { cid, user } = useApp();
  const nav = useNavigate();
  const [t, setT] = useState(null);
  const [dlg, setDlg] = useState(null);  // 'director' | 'md' | 'quote' | 'won' | 'lost'
  const load = async () => {
    try { setT((await api.get(`/c/${cid}/r/tenders/${id}`)).data); }
    catch (e) { toast.error(errMsg(e)); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  if (!t) return <div className="p-6 text-slate-500">Loading tender…</div>;

  const stage = t.stage || "Draft";
  const stageMeta = STAGES.find((s) => s.k === stage) || STAGES[0];
  const StageIc = I[stageMeta.icon] || I.Circle;

  const act = async (fn, successMsg) => {
    try { const out = await fn(); toast.success(successMsg); await load(); return out; }
    catch (e) { toast.error(errMsg(e)); throw e; }
  };

  // Stage-specific primary actions
  const Actions = () => {
    const isDirector = user?.is_super || (user?.acting_roles || []).includes("Director");
    const canEdit = user?.is_super || (user?.modules?.M1 === "edit");
    switch (stage) {
      case "Draft":
      case "Rejected":
        return canEdit && <Btn onClick={() => act(() => api.post(`/c/${cid}/pretender/${id}/submit-for-director`), "Sent to Director for approval")} data-testid="ten-submit-director"><I.Send className="w-3.5 h-3.5 mr-1" />Submit to Director</Btn>;
      case "Pending Director":
        return isDirector ? (<>
          <Btn onClick={() => setDlg("director_approve")} data-testid="ten-director-approve"><I.CheckCircle2 className="w-3.5 h-3.5 mr-1" />Approve</Btn>
          <Btn variant="outline" onClick={() => setDlg("director_reject")} data-testid="ten-director-reject"><I.XCircle className="w-3.5 h-3.5 mr-1" />Reject</Btn>
        </>) : <Badge t="amber">Waiting for Director</Badge>;
      case "Approved - Study":
      case "BOQ & RFQ":
        return canEdit && <Btn onClick={() => act(() => api.post(`/c/${cid}/pretender/${id}/costing/lock`, { margin_pct: 10, overheads_pct: 5 }), "Costing locked · MD approval requested")} data-testid="ten-lock"><I.Lock className="w-3.5 h-3.5 mr-1" />Lock & request MD approval</Btn>;
      case "Pending MD":
        return isDirector ? (<>
          <Btn onClick={() => setDlg("md_approve")} data-testid="ten-md-approve"><I.CheckCircle2 className="w-3.5 h-3.5 mr-1" />MD Approve</Btn>
          <Btn variant="outline" onClick={() => setDlg("md_reject")} data-testid="ten-md-reject"><I.XCircle className="w-3.5 h-3.5 mr-1" />MD Reject</Btn>
        </>) : <Badge t="amber">Waiting for MD</Badge>;
      case "MD Approved":
        return canEdit && <Btn onClick={() => setDlg("quote")} data-testid="ten-quote"><I.Send className="w-3.5 h-3.5 mr-1" />Mark as Quoted</Btn>;
      case "Quoted":
        return (<>
          <Btn onClick={() => setDlg("won")} data-testid="ten-won"><I.Trophy className="w-3.5 h-3.5 mr-1" />Won → create Project</Btn>
          <Btn variant="outline" onClick={() => setDlg("lost")} data-testid="ten-lost"><I.XCircle className="w-3.5 h-3.5 mr-1" />Lost</Btn>
        </>);
      case "Won":
        return t.project_id ? <Btn onClick={() => nav(`/projects/${t.project_id}`)} data-testid="ten-open-project">Open {t.project_code}</Btn> : null;
      default:
        return null;
    }
  };

  const tabs = [
    ["overview", "Overview", "LayoutGrid"],
    ["documents", "Documents", "FileText"],
    ["eligibility", "Eligibility", "ListChecks"],
    ["boq", "BOQ Studio", "Calculator"],
    ["costing", "Costing", "Lock"],
    ["decision", "Decision", "Gavel"],
  ];

  return (
    <div className="fade-up">
      <PageHeader title={t.title || t.tender_no} subtitle={`${t.tender_no || "—"} · ${t.department || "—"} · Due ${dmy(t.bid_due_date) || "—"}`}>
        <div className={`px-3 h-9 rounded-lg flex items-center gap-2 text-[13px] font-medium ${stageMeta.tone}`} data-testid="ten-stage-badge">
          <StageIc className="w-4 h-4" />{stageMeta.label}
        </div>
        <Actions />
      </PageHeader>

      {(t.director_remarks || t.md_remarks) && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded p-2 text-[12px]" data-testid="ten-remarks">
          {t.director_remarks && <div><b>Director remarks:</b> {t.director_remarks}</div>}
          {t.md_remarks && <div><b>MD remarks:</b> {t.md_remarks}</div>}
          {t.lost_reason && <div><b>Lost reason:</b> {t.lost_reason}</div>}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
        <Kpi label="Estimated value" value={crore(t.estimated_value)} />
        <Kpi label="EMD" value={inr(t.emd)} />
        <Kpi label="BOQ items" value={(t.boq || []).length} />
        <Kpi label="Locked cost" value={inr(t.total_locked_cost || 0)} />
        <Kpi label="Our bid" value={t.bid_value ? inr(t.bid_value) : "—"} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="bg-white border flex-wrap h-auto">{tabs.map(([k, l, ic]) => { const Ic = I[ic]; return <TabsTrigger key={k} value={k} data-testid={`ten-tab-${k}`} className="flex items-center gap-1"><Ic className="w-3.5 h-3.5" />{l}</TabsTrigger>; })}</TabsList>

        <TabsContent value="overview" className="bg-white border rounded-lg p-4"><OverviewTab t={t} onSave={load} /></TabsContent>
        <TabsContent value="documents" className="bg-white border rounded-lg p-4"><DocumentsTab t={t} onReload={load} /></TabsContent>
        <TabsContent value="eligibility" className="bg-white border rounded-lg p-4"><EligibilityTab t={t} onReload={load} /></TabsContent>
        <TabsContent value="boq"><BOQStudioTender t={t} onReload={load} /></TabsContent>
        <TabsContent value="costing" className="bg-white border rounded-lg p-4"><CostingTab t={t} onReload={load} /></TabsContent>
        <TabsContent value="decision" className="bg-white border rounded-lg p-4"><DecisionTab t={t} /></TabsContent>
      </Tabs>

      <DecisionDialog kind={dlg} t={t} onClose={() => setDlg(null)} onDone={async (data) => { setDlg(null); await load(); if (data?.project_id) nav(`/projects/${data.project_id}`); }} />
    </div>
  );
}

// -------- Overview tab (edit basic fields) ---------
function OverviewTab({ t, onSave }) {
  const { cid } = useApp();
  const [v, setV] = useState(t);
  useEffect(() => setV(t), [t.id]);
  const save = async () => {
    try { await api.put(`/c/${cid}/r/tenders/${t.id}`, v); toast.success("Saved"); onSave?.(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const F = (k, l, type = "text") => (
    <label className="block"><span className="text-[11px] font-medium text-slate-600">{l}</span>
      <input type={type} className={inputCls} value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: type === "number" ? Number(e.target.value) : e.target.value })} data-testid={`ov-${k}`} />
    </label>
  );
  return (<div className="space-y-3">
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {F("tender_no", "Tender ID")}{F("title", "Name")}{F("department", "Department / client")}
      {F("state", "State")}{F("location", "Location")}{F("category", "Category (EPC/Supply/AMC)")}
      {F("estimated_value", "Estimated value (₹)", "number")}{F("emd", "EMD (₹)", "number")}{F("tender_fee", "Tender fee (₹)", "number")}
      {F("bid_due_date", "Closing date", "date")}{F("prebid_date", "Pre-bid date", "date")}{F("opening_date", "Opening date", "date")}
      {F("completion_period", "Completion period")}{F("tender_portal_url", "Portal URL")}
    </div>
    <Btn onClick={save} data-testid="ov-save">Save</Btn>
  </div>);
}

// -------- Documents tab (NIT + BOQ upload with AI) ---------
function DocumentsTab({ t, onReload }) {
  const { cid } = useApp();
  const [busy, setBusy] = useState(null);
  const ref = useRef({});
  const upload = async (kind, file) => {
    if (!file) return;
    setBusy(kind);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = (await api.post(`/c/${cid}/pretender/${t.id}/upload-${kind}`, fd, { headers: { "Content-Type": "multipart/form-data" } })).data;
      if (kind === "boq") toast.success(`Extracted ${r.extracted_rows} BOQ item(s)`);
      else toast.success("NIT extracted. Eligibility checklist populated.");
      onReload?.();
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(null);
  };
  const stageOk = ["Approved - Study", "BOQ & RFQ", "Costing Locked", "Pending MD", "MD Approved"].includes(t.stage);
  return (<div className="space-y-4">
    {!stageOk && <div className="bg-amber-50 border border-amber-200 text-[12px] p-2 rounded">Document upload is enabled after Director approval. Current stage: <b>{t.stage}</b>.</div>}
    <div className="grid md:grid-cols-2 gap-4">
      <div className="border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2"><I.FileText className="w-4 h-4" /><b className="text-[13px]">NIT (Notice Inviting Tender)</b></div>
        <div className="text-[12px] text-slate-500 mb-2">AI will extract tender head details + eligibility criteria + documents required.</div>
        <input type="file" accept=".pdf,.docx,.doc,.xlsx,.xlsm,.xls,image/*" className="hidden" ref={(r) => (ref.current.nit = r)} onChange={(e) => upload("nit", e.target.files?.[0])} data-testid="doc-nit-file" />
        <Btn disabled={busy === "nit" || !stageOk} onClick={() => ref.current.nit?.click()} data-testid="doc-upload-nit"><I.Upload className="w-3.5 h-3.5 mr-1" />{busy === "nit" ? "Reading…" : "Upload NIT"}</Btn>
        {t.nit_file_name && <div className="mt-2 text-[12px] text-emerald-700"><I.CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />{t.nit_file_name}</div>}
      </div>
      <div className="border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2"><I.Calculator className="w-4 h-4" /><b className="text-[13px]">BOQ (Bill of Quantities)</b></div>
        <div className="text-[12px] text-slate-500 mb-2">AI will extract every line item (editable later) and feed BOQ Studio.</div>
        <input type="file" accept=".pdf,.docx,.doc,.xlsx,.xlsm,.xls,image/*" className="hidden" ref={(r) => (ref.current.boq = r)} onChange={(e) => upload("boq", e.target.files?.[0])} data-testid="doc-boq-file" />
        <Btn disabled={busy === "boq" || !stageOk} onClick={() => ref.current.boq?.click()} data-testid="doc-upload-boq"><I.Upload className="w-3.5 h-3.5 mr-1" />{busy === "boq" ? "Reading…" : "Upload BOQ"}</Btn>
        {t.boq_file_name && <div className="mt-2 text-[12px] text-emerald-700"><I.CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />{t.boq_file_name} · {(t.boq || []).length} item(s)</div>}
      </div>
    </div>
  </div>);
}

// -------- Eligibility tab (3 lists with Yes/No) ---------
function EligibilityTab({ t, onReload }) {
  const { cid } = useApp();
  const [tech, setTech] = useState(t.eligibility_tech || []);
  const [fin, setFin] = useState(t.eligibility_fin || []);
  const [docs, setDocs] = useState(t.docs_required || []);
  useEffect(() => {
    setTech(t.eligibility_tech || []); setFin(t.eligibility_fin || []); setDocs(t.docs_required || []);
  }, [t.id]);
  const save = async () => {
    try { await api.put(`/c/${cid}/pretender/${t.id}/eligibility`, { eligibility_tech: tech, eligibility_fin: fin, docs_required: docs }); toast.success("Eligibility saved"); onReload?.(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const Section = ({ title, rows, setRows, kind }) => {
    const upd = (i, patch) => setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
    const add = () => setRows([...rows, { id: Math.random().toString(36).slice(2, 10), requirement: "", compliant: false, notes: "" }]);
    const rm = (i) => setRows(rows.filter((_, idx) => idx !== i));
    const compliant = rows.filter((r) => r.compliant).length;
    return (<div className="border rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-[13px]">{title}</div>
        <Badge t={compliant === rows.length && rows.length ? "green" : "amber"}>{compliant}/{rows.length} compliant</Badge>
      </div>
      <table className="erp-table w-full" data-testid={`elig-${kind}`}>
        <thead><tr><th>Requirement</th><th className="w-24 text-center">Compliant</th><th>Notes</th><th className="w-10" /></tr></thead>
        <tbody>
          {rows.map((r, i) => (<tr key={r.id}>
            <td><input className={inputCls} value={r.requirement} onChange={(e) => upd(i, { requirement: e.target.value })} /></td>
            <td className="text-center">
              <select className={inputCls} value={r.compliant ? "yes" : "no"} onChange={(e) => upd(i, { compliant: e.target.value === "yes" })} data-testid={`elig-${kind}-${i}-comp`}>
                <option value="no">No</option><option value="yes">Yes</option>
              </select>
            </td>
            <td><input className={inputCls} value={r.notes || ""} onChange={(e) => upd(i, { notes: e.target.value })} /></td>
            <td><button onClick={() => rm(i)} className="text-red-500 text-[11px]" title="Remove"><I.Trash2 className="w-3.5 h-3.5" /></button></td>
          </tr>))}
          {rows.length === 0 && <tr><td colSpan={4} className="text-center text-[12px] text-slate-500 py-3">Add rows manually or upload NIT to auto-populate</td></tr>}
        </tbody>
      </table>
      <Btn size="sm" variant="outline" onClick={add} className="mt-2" data-testid={`elig-${kind}-add`}><I.Plus className="w-3.5 h-3.5 mr-1" />Add</Btn>
    </div>);
  };
  return (<div className="space-y-4">
    <Section title="Technical eligibility" rows={tech} setRows={setTech} kind="tech" />
    <Section title="Financial eligibility" rows={fin} setRows={setFin} kind="fin" />
    <Section title="Documents required" rows={docs} setRows={setDocs} kind="docs" />
    <Btn onClick={save} data-testid="elig-save">Save eligibility</Btn>
  </div>);
}

// -------- BOQ Studio tab (uses BOQStudio component) ---------
function BOQStudioTender({ t, onReload }) {
  const { cid, user } = useApp();
  const canEdit = user?.is_super || (user?.modules?.M1 === "edit");
  const stageOk = ["Approved - Study", "BOQ & RFQ"].includes(t.stage);
  return (<div className="space-y-3">
    {!stageOk && <div className="bg-amber-50 border border-amber-200 text-[12px] p-2 rounded">BOQ Studio is active during <b>Approved — Study</b> and <b>BOQ & RFQ</b>. Current stage: <b>{t.stage}</b>.</div>}
    <BOQStudio
      matrixUrl={`/c/${cid}/pretender/${t.id}/boq/matrix`}
      quoteUrl={`/c/${cid}/pretender/${t.id}/boq/quote`}
      sendRfqUrl={`/c/${cid}/pretender/${t.id}/boq/send-rfq`}
      pickUrl={`/c/${cid}/pretender/${t.id}/boq/pick`}
      autoFillUrl={`/c/${cid}/pretender/${t.id}/boq/auto-fill`}
      vendorFetch={async () => (await api.get(`/c/${cid}/r/vendors`)).data.map(v => ({ id: v.id, name: v.name, email: v.email }))}
      lockedKey="locked_vendor_id" rateKey="locked_rate" canEdit={canEdit && stageOk} roundPrefix="V"
    />
  </div>);
}

// -------- Costing tab ---------
function CostingTab({ t, onReload }) {
  return (<div className="space-y-3">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Kpi label="Locked cost" value={inr(t.total_locked_cost || 0)} />
      <Kpi label="Margin %" value={`${t.margin_pct || 0}%`} />
      <Kpi label="Overheads %" value={`${t.overheads_pct || 0}%`} />
      <Kpi label="Bid value" value={inr(t.bid_value || 0)} />
    </div>
    {t.locked_at && <div className="text-[12px] text-slate-500">Locked on {dmy(t.locked_at)} by {t.locked_by}</div>}
    {t.stage === "BOQ & RFQ" && <div className="bg-blue-50 border border-blue-200 rounded p-2 text-[12px]">Finish picking vendor rates in BOQ Studio, then use <b>Lock & request MD approval</b> on the header.</div>}
    {t.stage === "Pending MD" && <div className="bg-amber-50 border border-amber-200 rounded p-2 text-[12px]">Waiting for MD approval. Director can act from the header.</div>}
    {t.stage === "MD Approved" && <div className="bg-emerald-50 border border-emerald-200 rounded p-2 text-[12px]">Approved by MD. You can now mark as Quoted.</div>}
  </div>);
}

function DecisionTab({ t }) {
  return (<div className="space-y-3 text-[13px]">
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <Kpi label="Stage" value={t.stage} />
      <Kpi label="Quoted at" value={dmy(t.quoted_at) || "—"} />
      <Kpi label="Project" value={t.project_code || "—"} />
    </div>
    {t.director_remarks && <div><b>Director remarks:</b> {t.director_remarks}</div>}
    {t.md_remarks && <div><b>MD remarks:</b> {t.md_remarks}</div>}
    {t.lost_reason && <div className="text-red-600"><b>Lost:</b> {t.lost_reason} · L1 {t.competitor} ₹{t.l1_value}</div>}
  </div>);
}

// -------- Decision dialog (shared for director/md/quote/won/lost) ---------
function DecisionDialog({ kind, t, onClose, onDone }) {
  const { cid } = useApp();
  const [v, setV] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!kind) { setV({}); return; }
    if (kind === "won") setV({ state: t.state, client: t.department, wo_value: t.bid_value, sites: "Main Site", retention_pct: 5, pbg_pct: 5 });
    else if (kind === "quote") setV({ bid_value: t.bid_value });
  }, [kind, t.id]);
  if (!kind) return null;

  const action = {
    director_approve: { title: "Approve tender", path: `/c/${cid}/pretender/${t.id}/director-decision`, body: { action: "approve", reason: v.reason || "" }, needsReason: false, msg: "Tender approved — ready for NIT/BOQ study" },
    director_reject:  { title: "Reject tender",  path: `/c/${cid}/pretender/${t.id}/director-decision`, body: { action: "reject", reason: v.reason }, needsReason: true, msg: "Tender rejected" },
    md_approve:       { title: "MD approve",     path: `/c/${cid}/pretender/${t.id}/md-decision`,       body: { action: "approve", reason: v.reason || "" }, needsReason: false, msg: "MD approved" },
    md_reject:        { title: "MD reject",      path: `/c/${cid}/pretender/${t.id}/md-decision`,       body: { action: "reject",  reason: v.reason }, needsReason: true, msg: "MD rejected — back to BOQ & RFQ for rework" },
    quote:            { title: "Mark as Quoted", path: `/c/${cid}/pretender/${t.id}/quote`,              body: { bid_value: Number(v.bid_value) || 0, reference: v.reference }, needsReason: false, msg: "Quoted" },
    won:              { title: "Won → create Project", path: `/c/${cid}/pretender/${t.id}/won`, body: { ...v, sites: String(v.sites || "").split(",").map((s) => s.trim()).filter(Boolean) }, needsReason: false, msg: "Project created" },
    lost:             { title: "Mark as Lost",   path: `/c/${cid}/pretender/${t.id}/lost`, body: v, needsReason: true, msg: "Recorded" },
  }[kind];

  const go = async () => {
    if (action.needsReason && !v.reason?.trim()) return toast.error("Reason is required");
    setBusy(true);
    try { const out = (await api.post(action.path, action.body)).data; toast.success(action.msg); onDone?.(out); }
    catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };

  const F = (k, l, type = "text") => <label className="block"><span className="text-[11px] font-medium text-slate-600">{l}</span><input type={type} className={inputCls} value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: type === "number" ? Number(e.target.value) : e.target.value })} data-testid={`dec-${k}`} /></label>;

  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white max-w-2xl" data-testid="decision-dialog">
        <DialogHeader><DialogTitle>{action.title}</DialogTitle></DialogHeader>
        <div className="space-y-2 text-[13px]">
          {kind === "won" && <div className="grid grid-cols-2 gap-2">
            {F("loa_no", "LOA / WO number *")}{F("loa_date", "LOA date", "date")}{F("wo_value", "WO value (₹) *", "number")}{F("state", "State code")}{F("client", "Client")}{F("client_gstin", "Client GSTIN")}{F("start_date", "Start", "date")}{F("end_date", "Completion", "date")}{F("sites", "Sites (comma-sep)")}{F("mob_advance", "Mobilisation advance (₹)", "number")}{F("retention_pct", "Retention %", "number")}{F("pbg_pct", "Performance BG %", "number")}
          </div>}
          {kind === "lost" && <div className="grid grid-cols-2 gap-2">{F("reason", "Reason *")}{F("competitor", "L1 competitor")}{F("l1_value", "L1 value (₹)", "number")}{F("l1_rates", "L1 rates / notes")}</div>}
          {kind === "quote" && <div className="grid grid-cols-2 gap-2">{F("bid_value", "Bid value (₹)", "number")}{F("reference", "Portal / reference")}</div>}
          {["director_reject", "md_reject", "director_approve", "md_approve"].includes(kind) && (
            <label className="block">
              <span className="text-[11px] font-medium text-slate-600">{action.needsReason ? "Reason *" : "Remarks (optional)"}</span>
              <textarea className="w-full border rounded px-2 py-1.5 text-[13px]" rows={3} value={v.reason || ""} onChange={(e) => setV({ ...v, reason: e.target.value })} data-testid="dec-reason" />
            </label>
          )}
        </div>
        <DialogFooter><Btn variant="outline" onClick={onClose}>Cancel</Btn><Btn onClick={go} disabled={busy} data-testid="dec-confirm">{busy ? "Working…" : "Confirm"}</Btn></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
