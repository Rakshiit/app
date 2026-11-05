import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import RegisterTable from "@/components/RegisterTable";
import { PageHeader, Kpi, Badge, Btn } from "@/components/common";
import { ClosureGate, BudgetTable } from "@/components/CustomTabs";
import { ProjectBOQStudio, ProjectTimeline } from "@/components/ProjectExtras";
import { useRegActions } from "@/pages/ModulePage";
import { inr, dmy, numf, crore } from "@/lib/fmt";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, BarChart, Bar } from "recharts";

export function Projects() {
  const nav = useNavigate();
  return (
    <div className="fade-up">
      <PageHeader title="M2 · Award & Projects" subtitle="Projects are created from won tenders (one Project Code end-to-end) or onboarded via Excel import for running projects." />
      <RegisterTable reg="projects" onRow={(r) => nav(`/projects/${r.id}`)} />
    </div>
  );
}

function WbsTree({ rows, project }) {
  const byParent = {};
  rows.forEach((w) => { (byParent[w.parent_id || "root"] ||= []).push(w); });
  const s0 = new Date(project.start_date || Date.now()).getTime();
  const e0 = new Date(project.end_date || Date.now()).getTime();
  const span = Math.max(e0 - s0, 864e5);
  const out = [];
  const walk = (pid, depth) => (byParent[pid] || []).sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true })).forEach((w) => { out.push([w, depth]); walk(w.id, depth + 1); });
  walk("root", 0);
  rows.filter((w) => w.parent_id && !rows.find((x) => x.id === w.parent_id)).forEach((w) => out.push([w, 0]));
  return (
    <div className="bg-white border rounded-lg overflow-auto" data-testid="wbs-gantt">
      <table className="erp-table w-full"><thead><tr><th>WBS (6-level tree)</th><th className="n">Qty</th><th className="n">Done</th><th className="n">%</th><th className="w-[40%]">Gantt · {dmy(project.start_date)} → {dmy(project.end_date)}</th></tr></thead>
        <tbody>{out.map(([w, d]) => {
          const ws = new Date(w.start_date || project.start_date).getTime(), we = new Date(w.end_date || project.end_date).getTime();
          const left = Math.max(0, ((ws - s0) / span) * 100), width = Math.max(2, ((we - ws) / span) * 100);
          const pct = w.qty > 0 ? Math.min(100, (w.done_qty / w.qty) * 100) : 0;
          const today = ((Date.now() - s0) / span) * 100;
          return (<tr key={w.id}><td style={{ paddingLeft: 10 + d * 18 }} className={d === 0 ? "font-semibold" : ""}><span className="font-mono text-[11px] text-slate-500 mr-1">L{w.level} {w.code}</span>{w.name}</td>
            <td className="n">{w.qty > 0 ? `${numf(w.qty)} ${w.uom || ""}` : ""}</td><td className="n">{w.qty > 0 ? numf(w.done_qty) : ""}</td><td className="n">{w.qty > 0 ? `${numf(pct, 1)}%` : ""}</td>
            <td><div className="relative h-4 bg-slate-100 rounded"><div className="absolute h-4 rounded bg-slate-300" style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}><div className="h-4 rounded" style={{ width: `${pct}%`, background: "var(--brand-primary)" }} /></div>{today > 0 && today < 100 && <div className="absolute top-0 h-4 w-px accent-bar" style={{ left: `${today}%` }} />}</div></td></tr>);
        })}</tbody></table>
    </div>
  );
}

export function ProjectDetail() {
  const { id } = useParams();
  const { cid } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [wbs, setWbs] = useState([]);
  const [k, setK] = useState(0);
  const actions = useRegActions(cid);
  useEffect(() => {
    api.get(`/c/${cid}/projects/${id}/overview`).then((r) => setD(r.data));
    api.get(`/c/${cid}/r/wbs`, { params: { project_id: id } }).then((r) => setWbs(r.data));
  }, [id, cid, k]);
  if (!d) return "Loading project…";
  const p = d.project;
  const F = { project_id: id };
  const ev = [{ name: "Physical", v: d.physical_pct }, { name: "Billed", v: d.billed_pct }, { name: "Cost", v: d.cost_pct }];
  return (
    <div className="fade-up">
      <PageHeader title={`${p.code} · ${p.name}`} subtitle={`${p.client} · LOA ${p.loa_no || "-"} · ${dmy(p.start_date)} → ${dmy(p.end_date)}`}>
        <Badge>{p.status}</Badge>{p.archived && <Badge t="grey">Archived read-only · margin frozen {p.frozen_margin_pct}%</Badge>}
        {p.tender_id && <Btn variant="outline" onClick={() => nav(`/tenders/${p.tender_id}`)}>Source tender</Btn>}
      </PageHeader>
      <Tabs defaultValue="overview" onValueChange={() => setK(k + 1)}>
        <TabsList className="bg-white border flex-wrap h-auto">
          {[["overview", "Overview"], ["wbs", "WBS & Gantt"], ["sites", "Sites"], ["budget", "Budget vs actual"], ["procurement", "Procurement Studio"], ["timeline", "Timeline"], ["dprs", "DPRs"], ["billing", "RA bills"], ["co", "Change orders"], ["hindrance", "Hindrances"], ["bgs", "BGs"], ["docs", "Drawings & RFIs"], ["closure", "Closure gate"]].map(([v, l]) => <TabsTrigger key={v} value={v} data-testid={`project-tab-${v}`}>{l}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Kpi label="Contract value" value={crore(p.contract_value)} sub={`Original ${crore(p.original_value)}`} testid="kpi-contract" /><Kpi label="Physical progress" value={`${numf(d.physical_pct)}%`} testid="kpi-physical" />
            <Kpi label="Billed" value={`${numf(d.billed_pct)}%`} sub={inr(p.billed_value)} /><Kpi label="Cost incurred" value={`${numf(d.cost_pct)}%`} sub={inr(d.actual_total)} />
            <Kpi label="Projected margin" value={d.projected_margin_pct === null ? "-" : `${numf(d.projected_margin_pct, 1)}%`} /><Kpi label="Pending COs" value={d.pending_change_orders} tone={d.pending_change_orders ? "red" : ""} />
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="bg-white border rounded-lg p-3 lg:col-span-2"><div className="font-semibold text-[13px] mb-2">S-curve: planned vs actual (%)</div>
              <ResponsiveContainer width="100%" height={240}><LineChart data={d.s_curve}><CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" /><XAxis dataKey="month" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} domain={[0, 100]} /><Tooltip /><Legend /><Line dataKey="planned" stroke="#98A2B3" strokeDasharray="5 4" dot={false} /><Line dataKey="actual" stroke="var(--brand-primary)" strokeWidth={2} /></LineChart></ResponsiveContainer></div>
            <div className="bg-white border rounded-lg p-3"><div className="font-semibold text-[13px] mb-2">Earned value</div>
              <ResponsiveContainer width="100%" height={240}><BarChart data={ev}><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="v" fill="var(--brand-accent)" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
          </div>
          <div className="bg-white border rounded-lg"><div className="p-3 font-semibold text-[13px] border-b">Multi-site comparison</div>
            <table className="erp-table w-full" data-testid="site-compare"><thead><tr><th>Site</th><th className="n">DPRs</th><th className="n">Work value</th><th className="n">Contribution</th><th>Last DPR</th><th /></tr></thead>
              <tbody>{d.sites.map((s) => <tr key={s.site_id}><td>{s.site}</td><td className="n">{s.dpr_count}</td><td className="n">{inr(s.work_value)}</td><td className="n">{numf(s.contribution_pct)}%</td><td>{dmy(s.last_dpr)}</td><td>{s.missing && <Badge t="red">Missing DPR</Badge>}</td></tr>)}</tbody></table></div>
        </TabsContent>
        <TabsContent value="wbs" className="space-y-3"><WbsTree rows={wbs} project={p} /><RegisterTable reg="wbs" filter={F} title="WBS items (edit)" /></TabsContent>
        <TabsContent value="sites"><RegisterTable reg="sites" filter={F} /></TabsContent>
        <TabsContent value="budget"><BudgetTable project={p} /></TabsContent>
        <TabsContent value="procurement"><ProjectBOQStudio projectId={id} /></TabsContent>
        <TabsContent value="timeline"><ProjectTimeline projectId={id} /></TabsContent>
        <TabsContent value="dprs"><RegisterTable reg="dprs" filter={F} /></TabsContent>
        <TabsContent value="billing" className="space-y-3"><p className="text-[12px] text-slate-500">Draft RA bill lines are created automatically when the PM approves a DPR. Billing beyond certified quantity or WO value is blocked at submission.</p><RegisterTable reg="ra_bills" filter={F} actions={actions.ra_bills} /><RegisterTable reg="invoices" filter={F} compact /></TabsContent>
        <TabsContent value="co"><RegisterTable reg="change_orders" filter={F} /></TabsContent>
        <TabsContent value="hindrance"><RegisterTable reg="hindrances" filter={F} /></TabsContent>
        <TabsContent value="bgs" className="space-y-3"><RegisterTable reg="bgs" filter={F} /><RegisterTable reg="mob_advances" filter={F} compact /></TabsContent>
        <TabsContent value="docs" className="space-y-3"><RegisterTable reg="drawings" filter={F} /><RegisterTable reg="rfis" filter={F} /></TabsContent>
        <TabsContent value="closure"><ClosureGate projectId={id} /></TabsContent>
      </Tabs>
    </div>
  );
}
