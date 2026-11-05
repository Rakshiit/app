import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AppProvider } from "@/context/AppContext";
import Shell from "@/components/Shell";
import { Login, Launchpad } from "@/pages/Auth";
import CompanyWizard from "@/pages/CompanyWizard";
import Dashboard from "@/pages/Dashboard";
import { Tenders, TenderDetail } from "@/pages/Tenders";
import { Projects, ProjectDetail } from "@/pages/Projects";
import ModulePage from "@/pages/ModulePage";
import { Admin, GroupMIS } from "@/pages/Admin";
import { VendorLink, Verify, Portal } from "@/pages/Public";
import Mobile from "@/pages/Mobile";

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/launchpad" element={<Launchpad />} />
          <Route path="/companies/new" element={<CompanyWizard />} />
          <Route path="/companies/:id/edit" element={<CompanyWizard />} />
          <Route path="/mis" element={<GroupMIS />} />
          <Route path="/v/:token" element={<VendorLink />} />
          <Route path="/verify/:code" element={<Verify />} />
          <Route path="/portal" element={<Portal />} />
          <Route path="/portal/:cid/:pid" element={<Portal />} />
          <Route path="/mobile/*" element={<Mobile />} />
          <Route element={<Shell />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/tenders" element={<Tenders />} />
            <Route path="/tenders/:id" element={<TenderDetail />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/m/:mod" element={<ModulePage />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </AppProvider>
  );
}
