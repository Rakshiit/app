import React, { useEffect, useState } from "react";
import { NavLink, useNavigate, Outlet, Navigate } from "react-router-dom";
import * as Icons from "lucide-react";
import { useApp } from "@/context/AppContext";
import { MODULES } from "@/config/registers";
import { api } from "@/lib/api";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";

export default function Shell() {
  const { user, company, cid, can, logout, selectCompany, loading } = useApp();
  const nav = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [counts, setCounts] = useState({ approvals: 0, alerts: 0 });
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { if (user) api.get("/companies").then((r) => setCompanies(r.data)); }, [user]);
  useEffect(() => {
    if (!cid) return;
    const f = () => Promise.all([api.get(`/c/${cid}/approvals`, { params: { mine: true } }), api.get(`/c/${cid}/alerts`)]).then(([a, b]) => setCounts({ approvals: a.data.length, alerts: b.data.length })).catch(() => {});
    f(); const t = setInterval(f, 60000); return () => clearInterval(t);
  }, [cid]);
  if (loading) return <div className="p-10 text-center">Loading…</div>;
  if (!user) return <Navigate to="/login" />;
  if (user.role_names?.includes("Client") && !user.is_super) return <Navigate to="/portal" />;
  if (!company) return <Navigate to="/launchpad" />;
  const Item = ({ to, icon, label, testid }) => {
    const I = Icons[icon] || Icons.Circle;
    return (
      <NavLink to={to} data-testid={testid} className={({ isActive }) => `nav-item flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] ${isActive ? "active" : ""}`}>
        <I className="w-4 h-4 shrink-0" />{!collapsed && <span className="truncate">{label}</span>}
      </NavLink>
    );
  };
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={`erp-sidebar ${collapsed ? "w-[64px]" : "w-[248px]"} shrink-0 flex flex-col transition-all`} data-testid="sidebar">
        <div className="h-12 flex items-center gap-2 px-3 border-b border-white/10">
          <div className="w-7 h-7 rounded accent-btn flex items-center justify-center font-bold text-[11px]">{company.short_code?.slice(0, 2)}</div>
          {!collapsed && <div className="leading-tight min-w-0"><div className="font-heading font-semibold text-[13px] truncate">{company.short_code} EPC ERP</div><div className="text-[10px] opacity-70 truncate">{company.name}</div></div>}
          <button className="ml-auto opacity-70" onClick={() => setCollapsed(!collapsed)} data-testid="sidebar-collapse"><Icons.PanelLeft className="w-4 h-4" /></button>
        </div>
        <nav className="flex-1 overflow-y-auto scroll-thin p-2 space-y-0.5">
          <Item to="/dashboard" icon="Gauge" label="Dashboard" testid="nav-dashboard" />
          {MODULES.filter((m) => can(m.key)).map((m) => (
            <Item key={m.key} to={m.path || `/m/${m.key}`} icon={m.icon} label={`${m.key} · ${m.title}`} testid={`nav-${m.key}`} />
          ))}
          {(user.is_super || can("ADMIN", "edit")) && <Item to="/admin" icon="Settings" label="Admin & Permissions" testid="nav-admin" />}
          {(user.is_super || user.role_names?.includes("Director")) && <Item to="/mis" icon="BarChart3" label="Group MIS" testid="nav-mis" />}
          <Item to="/mobile" icon="Smartphone" label="Phone version" testid="nav-mobile" />
        </nav>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 bg-white border-b border-slate-200 flex items-center gap-3 px-4 shrink-0">
          <div className="accent-bar w-1 h-6 rounded" />
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 text-[13px] font-semibold hover:bg-slate-50 rounded px-2 py-1" data-testid="company-switcher">
              <span className="w-3 h-3 rounded-full" style={{ background: company.theme?.primary }} />{company.name}<Icons.ChevronDown className="w-3.5 h-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-white w-72">
              <DropdownMenuLabel>Switch company</DropdownMenuLabel>
              {companies.map((c) => (
                <DropdownMenuItem key={c.id} onClick={() => { selectCompany(c); nav("/dashboard"); }} data-testid={`switch-company-${c.short_code}`}>
                  <span className="w-3 h-3 rounded-full mr-2" style={{ background: c.theme?.primary }} />{c.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => nav("/launchpad")}>Open Launchpad</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <form onSubmit={(e) => { e.preventDefault(); nav(`/tenders?q=${encodeURIComponent(q)}`); }} className="relative hidden md:block">
            <Icons.Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Tender ID…" className="h-7 w-60 pl-7 pr-2 text-[12px] border border-slate-200 rounded-md bg-slate-50" data-testid="global-search" />
          </form>
          <div className="flex-1" />
          <button onClick={() => nav("/m/M13?tab=_approvals")} className="relative p-1.5 rounded hover:bg-slate-100" title="My approvals" data-testid="topbar-approvals">
            <Icons.CheckSquare className="w-4 h-4" />{counts.approvals > 0 && <span className="absolute -top-0.5 -right-0.5 accent-btn text-[9px] rounded-full px-1">{counts.approvals}</span>}
          </button>
          <button onClick={() => nav("/m/M15?tab=_alerts")} className="relative p-1.5 rounded hover:bg-slate-100" title="Alerts" data-testid="topbar-alerts">
            <Icons.Bell className="w-4 h-4" />{counts.alerts > 0 && <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white text-[9px] rounded-full px-1">{counts.alerts}</span>}
          </button>
          <button onClick={() => nav("/m/M13?tab=_calendar")} className="p-1.5 rounded hover:bg-slate-100" title="Calendar" data-testid="topbar-calendar"><Icons.CalendarDays className="w-4 h-4" /></button>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 text-[12px] hover:bg-slate-50 rounded px-2 py-1" data-testid="user-menu">
              <span className="w-7 h-7 rounded-full brand-btn flex items-center justify-center text-[11px] font-semibold">{user.name?.[0]}</span>
              <span className="hidden lg:block text-left leading-tight"><span className="block font-medium">{user.name}</span><span className="block text-slate-500 text-[10px]">{user.role_names?.join(", ")}</span></span>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-white" align="end">
              <DropdownMenuItem onClick={() => nav("/m/M13?tab=tasks")}>My tasks</DropdownMenuItem>
              <DropdownMenuItem onClick={() => nav("/m/M3?tab=payslips")}>My payslips</DropdownMenuItem>
              <DropdownMenuItem onClick={logout} data-testid="logout-btn">Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 overflow-y-auto erp-content p-4 scroll-thin"><Outlet /></main>
      </div>
    </div>
  );
}
