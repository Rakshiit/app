import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { applyTheme } from "@/lib/fmt";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    if (!localStorage.getItem("erp_token")) { setLoading(false); return; }
    try {
      const me = (await api.get("/auth/me")).data;
      setUser(me);
      const cid = localStorage.getItem("erp_company");
      if (cid) {
        try {
          const c = (await api.get(`/companies/${cid}`)).data;
          setCompany(c); applyTheme(c.theme);
        } catch { localStorage.removeItem("erp_company"); }
      }
    } catch { localStorage.removeItem("erp_token"); }
    setLoading(false);
  }, []);

  useEffect(() => { loadMe(); }, [loadMe]);

  const login = async (email, password) => {
    const r = (await api.post("/auth/login", { email, password })).data;
    localStorage.setItem("erp_token", r.token);
    setUser(r.user);
    return r.user;
  };
  const logout = () => {
    localStorage.removeItem("erp_token"); localStorage.removeItem("erp_company");
    setUser(null); setCompany(null); applyTheme(null);
    window.location.href = "/login";
  };
  const selectCompany = async (c) => {
    localStorage.setItem("erp_company", c.id);
    const full = (await api.get(`/companies/${c.id}`)).data;
    setCompany(full); applyTheme(full.theme);
  };
  const refreshCompany = async () => {
    if (!company) return;
    const full = (await api.get(`/companies/${company.id}`)).data;
    setCompany(full); applyTheme(full.theme);
  };
  const level = (m) => (user?.is_super ? "admin" : user?.modules?.[m] || "none");
  const can = (m, lv = "view") => {
    const L = { none: 0, view: 1, edit: 2, approve: 3, admin: 4 };
    return L[level(m)] >= L[lv];
  };
  const hasRole = (r) => user?.is_super || user?.acting_roles?.includes(r);

  return (
    <Ctx.Provider value={{ user, company, cid: company?.id, loading, login, logout, selectCompany, refreshCompany, can, level, hasRole, setUser }}>
      {children}
    </Ctx.Provider>
  );
}
