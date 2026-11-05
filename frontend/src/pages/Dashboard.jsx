import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { Kpi, PageHeader, Btn, Badge } from "@/components/common";
import { crore, inr, numf } from "@/lib/fmt";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { Settings } from "lucide-react";

export default function Dashboard() {
  const { cid, company, user, can } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  useEffect(() => { api.get(`/c/${cid}/dashboard`).then((r) => setD(r.data)); }, [cid]);
  if (!d) return <div className="p-6">Loading dashboard…</div>;
  const stages = Object.entries(d.tender_stages).map(([k, v]) => ({ stage: k, count: v }));
  return (
    <div className="fade-up">
      <PageHeader title={`${company.name}`} subtitle={`Role dashboard · ${user.role_names?.join(", ")}`}>
        {can("ADMIN", "edit") && <Btn variant="outline" onClick={() => nav(`/companies/${cid}/edit`)} data-testid="company-settings-btn"><Settings className="w-3.5 h-3.5" />Company settings</Btn>}
      </PageHeader>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-4">
        <Kpi label="Order book" value={crore(d.order_book)} testid="kpi-order-book" />
        <Kpi label="Active projects" value={d.projects_active} />
        <Kpi label="Billed" value={crore(d.billed)} />
        <Kpi label="Receivables" value={crore(d.receivables)} />
        <Kpi label="BG exposure" value={crore(d.bg_exposure)} />
        <Kpi label="Win ratio" value={`${d.win_ratio}%`} sub={`${d.won} won / ${d.lost} lost`} />
        <Kpi label="My approvals" value={d.pending_approvals} testid="kpi-approvals" />
        <Kpi label="Alerts" value={d.alerts} tone={d.alerts ? "red" : ""} />
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-white border rounded-lg p-3"><div className="font-semibold text-[13px] mb-2">Tender pipeline</div>
          <ResponsiveContainer width="100%" height={220}><BarChart data={stages}><CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" /><XAxis dataKey="stage" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="count" fill="var(--brand-primary)" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
        <div className="bg-white border rounded-lg p-3"><div className="font-semibold text-[13px] mb-2">Budget vs actual by project</div>
          <ResponsiveContainer width="100%" height={220}><BarChart data={d.projects}><CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" /><XAxis dataKey="code" tick={{ fontSize: 10 }} /><YAxis tickFormatter={(v) => `${(v / 1e5).toFixed(0)}L`} tick={{ fontSize: 10 }} /><Tooltip formatter={(v) => inr(v)} /><Legend /><Bar dataKey="budget" fill="#CBD3E1" /><Bar dataKey="actual" fill="var(--brand-accent)" /></BarChart></ResponsiveContainer></div>
      </div>
      <div className="bg-white border rounded-lg mt-4">
        <div className="p-3 font-semibold text-[13px] border-b">Projects</div>
        <table className="erp-table w-full"><thead><tr><th>Code</th><th>Name</th><th>State</th><th className="n">Contract</th><th className="n">Billed</th><th className="n">Progress</th><th>Status</th></tr></thead>
          <tbody>{d.projects.map((p) => (
            <tr key={p.id} className="cursor-pointer" onClick={() => nav(`/projects/${p.id}`)} data-testid={`dash-project-${p.code}`}><td className="font-mono">{p.code}</td><td className="max-w-[360px] truncate">{p.name}</td><td>{p.state}</td><td className="n">{inr(p.contract_value)}</td><td className="n">{inr(p.billed_value)}</td><td className="n">{numf(p.physical_pct)}%</td><td><Badge>{p.status}</Badge></td></tr>))}</tbody></table>
      </div>
    </div>
  );
}
