import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, reg as R, errMsg } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import RegisterTable, { RecordForm, RecordSheet } from "@/components/RegisterTable";
import { PageHeader, Btn, Badge, ItemsEditor, inputCls, Kpi } from "@/components/common";
import { RfqActions } from "@/components/Procurement";
import AIReader from "@/components/AIReader";
import { inr, dmy, crore } from "@/lib/fmt";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Sparkles, Plus, LayoutGrid, List, Trophy, XCircle, Send, Gavel } from "lucide-react";

const STAGES = ["Identified", "Go/No-Go Pending", "Go", "Bid Preparation", "Costing Approved", "Submitted", "Won", "Lost", "No-Go"];

export function Tenders() {
  const { cid } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [view, setView] = useState("kanban");
  const [rows, setRows] = useState([]);
  const [ai, setAi] = useState(false);
  const [add, setAdd] = useState(false);
  const q = sp.get("q") || "";
  const load = () => R(cid, "tenders").list().then(setRows);
  useEffect(() => { load(); }, [cid]); // eslint-disable-line
  const shown = rows.filter((t) => !q || `${t.tender_no} ${t.title}`.toLowerCase().includes(q.toLowerCase()));
  const fromAi = async ({ fields, file }) => {
    const t = await R(cid, "tenders").create({ ...fields, estimated_value: Number(fields.estimated_value) || 0, emd: Number(fields.emd) || 0, stage: "Identified", nit_file_id: file?.id, ai_extracted: true });
    nav(`/tenders/${t.id}`);
  };
  return (
    <div className="fade-up">
      <PageHeader title="M1 · Tender pipeline" subtitle={q ? `Search: "${q}"` : "Identify → Go/No-Go → Costing → Bid → Won/Lost"}>
        <div className="flex border rounded-md overflow-hidden">{[["kanban", LayoutGrid], ["table", List]].map(([k, I]) => <button key={k} onClick={() => setView(k)} className={`px-2 h-8 ${view === k ? "brand-btn" : "bg-white"}`} data-testid={`tender-view-${k}`}><I className="w-4 h-4" /></button>)}</div>
        <Btn variant="outline" onClick={() => setAi(true)} data-testid="tender-ai-new"><Sparkles className="w-3.5 h-3.5" />New from NIT (AI)</Btn>
        <Btn onClick={() => setAdd(true)} data-testid="tender-add"><Plus className="w-3.5 h-3.5" />Add tender</Btn>
      </PageHeader>
      {view === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-3 scroll-thin" data-testid="tender-kanban">
          {STAGES.map((s) => {
            const list = shown.filter((t) => (t.stage || "Identified") === s);
            return (
              <div key={s} className="kanban-col rounded-lg w-64 shrink-0 p-2">
                <div className="flex items-center justify-between px-1 pb-2 text-[12px] font-semibold">{s}<span className="text-slate-500">{list.length}</span></div>
                <div className="space-y-2">{list.map((t) => (
                  <button key={t.id} onClick={() => nav(`/tenders/${t.id}`)} className="w-full text-left bg-white border border-slate-200 rounded-md p-2.5 hover:shadow" data-testid={`tender-card-${t.id}`}>
                    <div className="text-[11px] font-mono text-slate-500 truncate">{t.tender_no}</div>
                    <div className="text-[12px] font-medium line-clamp-2 mt-0.5">{t.title}</div>
                    <div className="flex items-center justify-between mt-2 text-[11px]"><span className="num">{crore(t.estimated_value)}</span><span className="text-slate-500">Due {dmy(t.bid_due_date)}</span></div>
                  </button>))}</div>
              </div>);
          })}
        </div>
      ) : <RegisterTable reg="tenders" onRow={(r) => nav(`/tenders/${r.id}`)} />}
      <AIReader open={ai} onClose={() => setAi(false)} docType="nit" onConfirm={fromAi} title="Read tender notice (NIT)" />
      <RecordSheet open={add} onClose={() => setAdd(false)} reg="tenders" cid={cid} onSaved={load} defaults={{ stage: "Identified" }} />
    </div>
  );
}

function Costing({ tender, reload }) {
  const { cid } = useApp();
  const [list, setList] = useState([]);
  const [cur, setCur] = useState(null);
  const load = () => R(cid, "costings").list({ tender_id: tender.id }).then((r) => { setList(r); setCur((c) => r.find((x) => x.id === c?.id) || r[0] || null); });
  useEffect(() => { load(); }, [tender.id]); // eslint-disable-line
  const nv = async () => { try { await api.post(`/c/${cid}/tenders/${tender.id}/costings/new`, {}); load(); } catch (e) { toast.error(errMsg(e)); } };
  const save = async () => { try { await R(cid, "costings").update(cur.id, cur); toast.success("Saved (rate/margin changes logged)"); load(); } catch (e) { toast.error(errMsg(e)); } };
  const submit = async () => { try { await R(cid, "costings").submit(cur.id); toast.success("Sent to management for final approval"); load(); reload(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {list.map((c) => <button key={c.id} onClick={() => setCur(c)} className={`px-3 h-8 rounded border text-[12px] ${cur?.id === c.id ? "brand-btn" : "bg-white"}`} data-testid={`costing-v${c.version}`}>v{c.version} · {c.status}{c.superseded ? " (superseded)" : ""}</button>)}
        <Btn variant="outline" onClick={nv} data-testid="costing-new-version"><Plus className="w-3.5 h-3.5" />New version</Btn>
      </div>
      {cur && (<>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Kpi label="Total cost" value={inr(cur.total_cost)} /><Kpi label="Bid value" value={inr(cur.bid_value)} /><Kpi label="Margin" value={`${cur.margin_pct_effective ?? "-"}%`} />
          {Object.entries(cur.head_totals || {}).slice(0, 2).map(([k, v]) => <Kpi key={k} label={k} value={inr(v)} />)}
        </div>
        <div className="flex items-center gap-2 text-[12px]">Type <select className={`${inputCls} w-44`} value={cur.cost_type || "EPC"} onChange={(e) => setCur({ ...cur, cost_type: e.target.value })} disabled={cur.locked}><option>EPC</option><option>O&M Manpower</option><option>AMC</option></select></div>
        <ItemsEditor cid={cid} testid="costing-items" disabled={cur.locked} value={cur.items} onChange={(items) => setCur({ ...cur, items })}
          cols={cur.cost_type === "O&M Manpower" ? "desc:Position,uom:Unit,qty:Headcount x months:n,labour:Wage/month:m,overheads:Statutory+admin:m,margin_pct:Margin %:n,sell:Sell:m" : "desc:Item,uom:UOM,qty:Qty:n,material:Material/unit:m,labour:Labour/unit:m,subcontractor:Subcon/unit:m,equipment:Equip/unit:m,overheads:OH/unit:m,margin_pct:Margin %:n,sell:Sell value:m"} />
        <div className="flex gap-2">{!cur.locked && <><Btn onClick={save} data-testid="costing-save">Save version</Btn><Btn variant="accent" onClick={submit} data-testid="costing-submit">Submit for final approval</Btn></>}
          {cur.locked && <Badge t="green">Approved & locked — create a new version to change</Badge>}</div>
      </>)}
    </div>
  );
}

function Feasibility({ tender }) {
  const { cid } = useApp();
  const [d, setD] = useState(null);
  useEffect(() => { api.get(`/c/${cid}/tenders/${tender.id}/feasibility`).then((r) => setD(r.data)); }, [tender.id, tender.required_documents]); // eslint-disable-line
  if (!d) return "Checking vault…";
  return (
    <div data-testid="feasibility">
      <div className="flex gap-3 mb-3"><Kpi label="Document score" value={`${d.score}%`} /><Kpi label="Turnover" value={inr(d.turnover.company)} sub={`Required ${inr(d.turnover.required)}`} /><Kpi label="Verdict" value={d.feasible ? "Feasible" : "Gaps found"} tone={d.feasible ? "" : "red"} /></div>
      <table className="erp-table w-full bg-white border rounded"><thead><tr><th>Requirement</th><th>Matched vault document</th><th>Expiry</th><th>Status</th></tr></thead>
        <tbody>{d.checks.map((c) => <tr key={c.requirement}><td>{c.requirement}</td><td>{c.doc?.name || "-"}</td><td>{dmy(c.doc?.expiry_date)}</td><td><Badge>{c.status}</Badge></td></tr>)}</tbody></table>
      {!d.checks.length && <p className="text-slate-500 text-[12px] mt-2">Add "Required documents" on the overview tab (or read the NIT with AI) to run the check.</p>}
    </div>
  );
}

export function TenderDetail() {
  const { id } = useParams();
  const { cid } = useApp();
  const nav = useNavigate();
  const [t, setT] = useState(null);
  const [ai, setAi] = useState(null);
  const [dlg, setDlg] = useState(null);
  const [form, setForm] = useState({});
  const load = () => R(cid, "tenders").get(id).then((x) => { setT(x); setForm(x); });
  useEffect(() => { load(); }, [id]); // eslint-disable-line
  if (!t) return "Loading…";
  const act = async (fn, msg) => { try { await fn(); toast.success(msg); load(); setDlg(null); } catch (e) { toast.error(errMsg(e)); } };
  const save = () => act(() => R(cid, "tenders").update(id, form), "Tender saved");
  const onAi = async ({ fields, items, file }) => {
    if (ai === "boq") await R(cid, "tenders").update(id, { boq: items.map((i) => ({ desc: i.desc, uom: i.uom, qty: Number(i.qty) || 0, rate: Number(i.rate) || 0 })), boq_file_id: file?.id });
    else if (ai === "corrigendum") {
      await R(cid, "corrigenda").create({ tender_id: id, ...fields, file_id: file?.id });
      if (fields.new_bid_due_date) await R(cid, "tenders").update(id, { bid_due_date: fields.new_bid_due_date });
    } else await R(cid, "tenders").update(id, { ...fields, nit_file_id: file?.id });
    load();
  };
  return (
    <div className="fade-up">
      <PageHeader title={t.title} subtitle={`${t.tender_no} · ${t.department || ""} · Due ${dmy(t.bid_due_date)}`}>
        <Badge>{t.stage}</Badge>
        {["Identified", "No-Go"].includes(t.stage) && <Btn variant="outline" onClick={() => act(() => api.post(`/c/${cid}/tenders/${id}/gonogo`), "Sent to MD for Go/No-Go")} data-testid="tender-gonogo"><Gavel className="w-3.5 h-3.5" />Request Go/No-Go</Btn>}
        {!["Won", "Lost", "Submitted", "No-Go"].includes(t.stage) && <Btn variant="outline" onClick={() => act(() => api.post(`/c/${cid}/tenders/${id}/submit-bid`, {}), "Bid marked submitted, EMD logged")} data-testid="tender-submit-bid"><Send className="w-3.5 h-3.5" />Submit bid</Btn>}
        {t.stage === "Submitted" && <><Btn onClick={() => setDlg("won")} data-testid="tender-won"><Trophy className="w-3.5 h-3.5" />Won → Project</Btn><Btn variant="danger" onClick={() => setDlg("lost")} data-testid="tender-lost"><XCircle className="w-3.5 h-3.5" />Lost</Btn></>}
        {t.project_id && <Btn onClick={() => nav(`/projects/${t.project_id}`)} data-testid="tender-open-project">Open {t.project_code}</Btn>}
      </PageHeader>
      {t.nogo_reason && <div className="mb-3 text-[12px] bg-red-50 border border-red-200 rounded p-2">No-Go reason: {t.nogo_reason}</div>}
      <Tabs defaultValue="overview">
        <TabsList className="bg-white border flex-wrap h-auto">
          {["overview", "ai", "feasibility", "boq", "rfq", "costing", "checklist", "corrigenda"].map((k) => <TabsTrigger key={k} value={k} data-testid={`tender-tab-${k}`} className="capitalize">{{ ai: "AI documents", rfq: "RFQs & quotes", checklist: "Checklist / MAF / EMD" }[k] || k}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="overview" className="bg-white border rounded-lg p-4"><RecordForm reg="tenders" value={form} onChange={setForm} cid={cid} /><Btn className="mt-3" onClick={save} data-testid="tender-save">Save</Btn>
          {t.stage === "Lost" && <div className="mt-3 text-[12px]">Lost: {t.lost_reason} · Competitor {t.competitor} · L1 {inr(t.l1_value)}</div>}</TabsContent>
        <TabsContent value="ai" className="bg-white border rounded-lg p-4 space-y-3">
          <p className="text-[12px] text-slate-600">Upload the NIT, BOQ (PDF/Word/Excel incl. .xlsm) or a corrigendum. The original shows on the left, extracted fields on the right. Nothing is saved until you confirm.</p>
          <div className="flex gap-2">{[["nit", "Read NIT"], ["boq", "Read BOQ"], ["corrigendum", "Read corrigendum"]].map(([k, l]) => <Btn key={k} variant="outline" onClick={() => setAi(k)} data-testid={`tender-ai-${k}`}><Sparkles className="w-3.5 h-3.5" />{l}</Btn>)}</div>
          {t.ai_extracted && <Badge t="blue">Created from AI reading</Badge>}
        </TabsContent>
        <TabsContent value="feasibility"><Feasibility tender={t} /></TabsContent>
        <TabsContent value="boq" className="bg-white border rounded-lg p-4 space-y-2">
          <p className="text-[12px] text-slate-500">Pre-bid BOQ from the Product Master. Costing v1 is seeded from this BOQ.</p>
          <ItemsEditor cid={cid} testid="tender-boq" cols="product_id:Product:r:products,desc:Description,uom:UOM,qty:Qty:n,rate:Est. rate:m" value={form.boq} onChange={(b) => setForm({ ...form, boq: b })} />
          <Btn onClick={save} data-testid="boq-save">Save BOQ</Btn>
        </TabsContent>
        <TabsContent value="rfq"><RegisterTable reg="rfqs" filter={{ tender_id: id }} title="Pre-bid vendor RFQs" actions={(r, l) => <RfqActions r={r} load={l} />} /></TabsContent>
        <TabsContent value="costing" className="bg-white border rounded-lg p-4"><Costing tender={t} reload={load} /></TabsContent>
        <TabsContent value="checklist" className="space-y-3">
          <div className="bg-white border rounded-lg p-4"><div className="font-semibold text-[13px] mb-2">Document checklist</div>
            <ItemsEditor cid={cid} testid="tender-checklist" cols="name:Document,done:Ready:b" value={form.checklist} onChange={(c) => setForm({ ...form, checklist: c })} /><Btn className="mt-2" onClick={save}>Save checklist</Btn></div>
          <RegisterTable reg="maf" filter={{ tender_id: id }} compact />
          <RegisterTable reg="bgs" filter={{ tender_id: id }} title="EMD register" defaults={{ bg_type: "EMD" }} compact />
        </TabsContent>
        <TabsContent value="corrigenda"><RegisterTable reg="corrigenda" filter={{ tender_id: id }} compact /></TabsContent>
      </Tabs>
      <AIReader open={!!ai} onClose={() => setAi(null)} docType={ai || "nit"} onConfirm={onAi} />
      <OutcomeDialog kind={dlg} tender={t} onClose={() => setDlg(null)} onDone={(p) => { setDlg(null); if (p?.id) nav(`/projects/${p.id}`); else load(); }} />
    </div>
  );
}

function OutcomeDialog({ kind, tender, onClose, onDone }) {
  const { cid } = useApp();
  const [v, setV] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(kind === "won" ? { state: tender.state, client: tender.department, wo_value: tender.bid_value || tender.estimated_value, sites: "Main Site", retention_pct: 5, pbg_pct: 5 } : {}), [kind]); // eslint-disable-line
  const F = (k, l, type = "text") => <label className="block"><span className="text-[11px] font-medium text-slate-600">{l}</span><input type={type} className={inputCls} value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: type === "number" ? Number(e.target.value) : e.target.value })} data-testid={`outcome-${k}`} /></label>;
  const go = async () => {
    setBusy(true);
    try {
      if (kind === "won") { const p = (await api.post(`/c/${cid}/tenders/${tender.id}/award`, { ...v, sites: String(v.sites || "").split(",").map((s) => s.trim()).filter(Boolean) })).data; toast.success(`Project ${p.code} created with baseline budget & Performance BG`); onDone(p); }
      else { await api.post(`/c/${cid}/tenders/${tender.id}/lost`, v); toast.success("Recorded for win-ratio analytics"); onDone(); }
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  return (
    <Dialog open={!!kind} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-white max-w-2xl" data-testid="outcome-dialog">
        <DialogHeader><DialogTitle>{kind === "won" ? "Confirm LOA / WO → create project" : "Record tender loss"}</DialogTitle></DialogHeader>
        {kind === "won" ? <div className="grid grid-cols-2 gap-3">{F("loa_no", "LOA / WO number *")}{F("loa_date", "LOA date", "date")}{F("wo_value", "WO value (₹) *", "number")}{F("state", "State code")}{F("client", "Client")}{F("client_gstin", "Client GSTIN")}{F("start_date", "Start", "date")}{F("end_date", "Completion", "date")}{F("sites", "Sites (comma separated)")}{F("mob_advance", "Mobilisation advance (₹)", "number")}{F("retention_pct", "Retention %", "number")}{F("pbg_pct", "Performance BG %", "number")}</div>
          : <div className="grid grid-cols-2 gap-3">{F("lost_reason", "Reason *")}{F("competitor", "L1 competitor")}{F("l1_value", "L1 value (₹)", "number")}{F("l1_rates", "L1 rates / notes")}</div>}
        <Btn onClick={go} loading={busy} data-testid="outcome-confirm">Confirm</Btn>
      </DialogContent>
    </Dialog>
  );
}
