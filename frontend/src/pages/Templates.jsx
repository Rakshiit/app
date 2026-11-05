import React, { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { PageHeader, Btn, Badge, inputCls } from "@/components/common";
import { toast } from "sonner";
import * as I from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

const KINDS = [["po", "Purchase Order"], ["ra_bill", "RA Bill"], ["invoice", "Invoice"], ["rfq", "RFQ"], ["email", "Email"]];
const LANGS = [["en", "English"], ["hi", "Hindi"]];

const DEFAULT_HTML = (kind) => kind === "email"
  ? "Dear {{ vendor_name }},\n\nPlease respond to {{ subject }}.\n\nRegards,\n{{ company.name }}"
  : `<div style='font-family:Inter,Arial'><h1>{{ company.name }}</h1><div><b>${kind.toUpperCase()}</b> {{ rec.number }} · {{ rec.date }}</div></div>`;

export default function Templates() {
  const { cid } = useApp();
  const [list, setList] = useState([]);
  const [cur, setCur] = useState(null);
  const [preview, setPreview] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { const r = (await api.get(`/c/${cid}/pdf-templates`)).data; setList(r); if (r.length && !cur) setCur(r[0]); }
    catch (e) { toast.error(errMsg(e)); }
  };
  useEffect(() => { load(); }, [cid]);

  const createNew = () => setCur({ name: "New template", kind: "po", language: "en", html: DEFAULT_HTML("po"), subject: "", active: true });
  const save = async () => {
    setBusy(true);
    try { const r = (await api.post(`/c/${cid}/pdf-templates`, cur)).data; toast.success(`Saved v${r.version}`); setCur(r); load(); }
    catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  const seedDefaults = async () => { try { const r = (await api.post(`/c/${cid}/pdf-templates/seed-defaults`)).data; toast.success(`Seeded ${r.inserted} defaults`); load(); } catch (e) { toast.error(errMsg(e)); } };
  const doPreview = async () => {
    if (!cur?.id) { toast.error("Save first to preview"); return; }
    setPreviewing(true);
    try { const r = (await api.post(`/c/${cid}/pdf-templates/${cur.id}/preview`, {})).data; setPreview(r.html); }
    catch (e) { toast.error(errMsg(e)); setPreview(""); }
    setPreviewing(false);
  };

  return (
    <div className="fade-up p-4" data-testid="templates-page">
      <PageHeader title="PDF & email template studio" subtitle="Design client-specific PDFs and Hindi emails without code" extra={<><Btn variant="outline" onClick={seedDefaults} data-testid="tpl-seed"><I.Sparkles className="w-4 h-4 mr-1" />Add defaults</Btn><Btn onClick={createNew} data-testid="tpl-new"><I.Plus className="w-4 h-4 mr-1" />New template</Btn></>} />
      <div className="grid lg:grid-cols-[260px_1fr] gap-4">
        <div className="space-y-1">
          {list.length === 0 && <div className="text-[12px] text-slate-500 p-4 text-center border rounded bg-white">No templates yet</div>}
          {list.map((t) => <button key={t.id} onClick={() => { setCur(t); setPreview(""); }} className={`w-full text-left px-3 py-2 rounded border text-[13px] ${cur?.id === t.id ? "brand-btn" : "bg-white hover:border-blue-300"}`} data-testid={`tpl-pick-${t.id}`}>
            <div className="flex items-center gap-2"><b className="truncate">{t.name}</b><Badge variant="info">v{t.version}</Badge></div>
            <div className="text-[11px] opacity-70 mt-0.5">{t.kind} · {t.language}</div>
          </button>)}
        </div>
        {cur ? <div className="bg-white border rounded-lg p-3 space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 items-end">
            <label className="text-[12px]">Name<input className={inputCls} value={cur.name || ""} onChange={(e) => setCur({ ...cur, name: e.target.value })} data-testid="tpl-name" /></label>
            <label className="text-[12px]">Kind
              <Select value={cur.kind} onValueChange={(v) => setCur({ ...cur, kind: v, html: cur.html || DEFAULT_HTML(v) })}>
                <SelectTrigger className="h-9" data-testid="tpl-kind"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">{KINDS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-[12px]">Language
              <Select value={cur.language} onValueChange={(v) => setCur({ ...cur, language: v })}>
                <SelectTrigger className="h-9" data-testid="tpl-lang"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-white">{LANGS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="flex items-center gap-2 text-[12px] mt-6"><input type="checkbox" checked={!!cur.active} onChange={(e) => setCur({ ...cur, active: e.target.checked })} />Active</label>
          </div>
          {cur.kind === "email" && <label className="block text-[12px]">Subject (Jinja)<input className={inputCls} value={cur.subject || ""} onChange={(e) => setCur({ ...cur, subject: e.target.value })} data-testid="tpl-subject" /></label>}
          <label className="block text-[12px]">Template ({cur.kind === "email" ? "text / Jinja" : "HTML / Jinja"})
            <textarea className="w-full border rounded px-2 py-2 text-[12px] font-mono h-72" value={cur.html || ""} onChange={(e) => setCur({ ...cur, html: e.target.value })} data-testid="tpl-html" />
          </label>
          <div className="flex items-center gap-2">
            <Btn onClick={save} disabled={busy} data-testid="tpl-save">{busy ? "Saving…" : (cur.id ? "Save new version" : "Create")}</Btn>
            <Btn variant="outline" onClick={doPreview} disabled={!cur.id || previewing} data-testid="tpl-preview"><I.Eye className="w-4 h-4 mr-1" />{previewing ? "Rendering…" : "Preview"}</Btn>
            <div className="text-[11px] text-slate-500">Placeholders: <code>{"{{ rec.field }}"}</code>, <code>{"{{ company.name }}"}</code>. For currency use <code>{"{{ rec.total|inr }}"}</code>.</div>
          </div>
          {preview && <div className="border rounded-lg bg-slate-50 overflow-hidden" data-testid="tpl-preview-box"><div className="text-[11px] px-3 py-1 bg-slate-100 font-semibold">Preview</div>
            {cur.kind === "email" ? <pre className="p-3 text-[12px] whitespace-pre-wrap max-h-[50vh] overflow-auto">{preview}</pre> : <iframe title="preview" className="w-full h-[600px] bg-white" srcDoc={preview} />}
          </div>}
        </div> : <div className="bg-white border rounded-lg p-10 text-center text-slate-500">Pick a template on the left or create a new one</div>}
      </div>
    </div>
  );
}
