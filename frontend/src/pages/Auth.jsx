import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { api, errMsg } from "@/lib/api";
import { Btn, inputCls } from "@/components/common";
import { toast } from "sonner";
import { Plus, BarChart3, LogOut, Building2 } from "lucide-react";
import { applyTheme } from "@/lib/fmt";

export function Login() {
  const { login } = useApp();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@jkeepl.in");
  const [pw, setPw] = useState("Admin@2026#");
  const [busy, setBusy] = useState(false);
  useEffect(() => applyTheme(null), []);
  const go = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const u = await login(email, pw);
      nav(u.role_names?.includes("Client") && !u.is_super ? "/portal" : "/launchpad");
    } catch (er) { toast.error(errMsg(er)); }
    setBusy(false);
  };
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-10 text-white" style={{ background: "#0B1220" }}>
        <div className="flex items-center gap-2"><div className="w-8 h-8 rounded bg-[#BB232B] flex items-center justify-center font-bold">JK</div><span className="font-heading font-semibold">JKEE EPC ERP</span></div>
        <div>
          <h1 className="text-4xl font-heading font-semibold leading-tight">Tender to closure.<br />One Project Code.</h1>
          <p className="mt-4 text-slate-300 max-w-md">Multi-company Electrical & Civil EPC lifecycle platform — tenders, award, execution, billing, BGs, Tally and closure in one connected system.</p>
        </div>
        <div className="text-[12px] text-slate-400">15 modules · multi-state GST · audit-chained records</div>
      </div>
      <div className="flex items-center justify-center p-6 bg-[#F4F6F9]">
        <form onSubmit={go} className="bg-white border border-slate-200 rounded-xl p-7 w-full max-w-sm space-y-4" data-testid="login-form">
          <div><h2 className="text-xl font-heading font-semibold">Sign in</h2><p className="text-[12px] text-slate-500">Session times out after 12 hours. Logins are recorded.</p></div>
          <label className="block"><span className="text-[11px] font-medium text-slate-600">Email</span><input className={inputCls + " h-9"} value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" /></label>
          <label className="block"><span className="text-[11px] font-medium text-slate-600">Password</span><input type="password" className={inputCls + " h-9"} value={pw} onChange={(e) => setPw(e.target.value)} data-testid="login-password" /></label>
          <button type="submit" disabled={busy} className="w-full h-9 rounded-md text-white font-medium bg-[#20309A] hover:bg-[#1a287f] disabled:opacity-60" data-testid="login-submit">{busy ? "Signing in…" : "Sign in"}</button>
          <div className="text-[11px] text-slate-500 border-t pt-3">Demo: admin@jkeepl.in / Admin@2026# · other roles (pm@, site@, accounts@, hr@, director@, tender@, procurement@, store@ jkeepl.in) use Demo@2026# · client@demo.in / Demo@2026#</div>
        </form>
      </div>
    </div>
  );
}

export function Launchpad() {
  const { user, selectCompany, logout, loading } = useApp();
  const nav = useNavigate();
  const [rows, setRows] = useState(null);
  useEffect(() => { applyTheme(null); api.get("/companies").then((r) => setRows(r.data)).catch((e) => toast.error(errMsg(e))); }, []);
  if (loading) return null;
  if (!user) { nav("/login"); return null; }
  const open = async (c) => { await selectCompany(c); nav("/dashboard"); };
  return (
    <div className="min-h-screen bg-[#F4F6F9]">
      <div className="bg-[#0B1220] text-white">
        <div className="max-w-6xl mx-auto px-6 py-8 flex items-end justify-between">
          <div><div className="text-[12px] text-slate-400">Welcome, {user.name}</div><h1 className="text-3xl font-heading font-semibold mt-1">Company Launchpad</h1><p className="text-slate-300 text-[13px] mt-1">Pick a company — the theme, data and files switch to that company.</p></div>
          <div className="flex gap-2">
            {(user.is_super || user.role_names?.includes("Director")) && <Btn variant="outline" onClick={() => nav("/mis")} data-testid="launchpad-group-mis"><BarChart3 className="w-3.5 h-3.5" />Group MIS</Btn>}
            <Btn variant="outline" onClick={logout}><LogOut className="w-3.5 h-3.5" />Logout</Btn>
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-6 py-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(rows || []).map((c) => (
          <button key={c.id} onClick={() => open(c)} className="text-left bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-lg transition-shadow fade-up" data-testid={`company-card-${c.short_code}`}>
            <div className="h-2" style={{ background: c.theme?.primary }} />
            <div className="p-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg flex items-center justify-center font-bold text-white" style={{ background: c.theme?.primary }}>{c.short_code}</div>
                <div className="min-w-0"><div className="font-heading font-semibold truncate">{c.name}</div><div className="text-[11px] text-slate-500">{c.default_state} · PAN {c.pan}</div></div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                {[["GSTINs", c.stats?.gstin_count], ["Running projects", c.stats?.projects_running], ["Pending approvals", c.stats?.pending_approvals]].map(([l, v]) => (
                  <div key={l} className="bg-slate-50 rounded p-2"><div className="text-lg font-semibold num">{v ?? 0}</div><div className="text-[10px] text-slate-500">{l}</div></div>
                ))}
              </div>
              <div className="flex items-center gap-1 mt-4">{["primary", "surface", "accent"].map((k) => <span key={k} className="w-6 h-6 rounded border" style={{ background: c.theme?.[k] }} />)}<span className="text-[11px] text-slate-500 ml-2">{c.theme?.preset || "custom"}</span></div>
            </div>
          </button>
        ))}
        {user.is_super && (
          <button onClick={() => nav("/companies/new")} className="border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center min-h-[220px] text-slate-600 hover:bg-white" data-testid="create-company-card">
            <Plus className="w-7 h-7" /><span className="mt-2 font-medium">Create New Company</span><span className="text-[11px] text-slate-500">4-step wizard</span>
          </button>
        )}
        {rows && !rows.length && !user.is_super && <div className="text-slate-500 col-span-3 text-center py-10"><Building2 className="w-6 h-6 inline" /> No company access assigned. Contact your administrator.</div>}
      </div>
    </div>
  );
}
