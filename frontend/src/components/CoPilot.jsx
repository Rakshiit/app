import React, { useEffect, useRef, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { Btn, Badge } from "@/components/common";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import * as I from "lucide-react";
import { toast } from "sonner";

const SUGGESTED = [
  "List the latest 5 purchase orders with vendor and total",
  "Show my pending approvals this week",
  "Which DPRs are still in Draft?",
  "Show employees joined this year",
  "Which projects are over budget by head?",
];

export default function CoPilot() {
  const { cid } = useApp();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("gemini");
  const [messages, setMessages] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    if (open && !models.length) api.get(`/c/${cid}/copilot/models`).then((r) => setModels(r.data)).catch(() => {});
  }, [open, cid, models.length]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const ask = async (text) => {
    const prompt = (text || q).trim(); if (!prompt) return;
    setMessages((m) => [...m, { role: "user", text: prompt }]);
    setQ(""); setBusy(true);
    try {
      const r = (await api.post(`/c/${cid}/copilot/query`, { prompt, model })).data;
      if (r.error) {
        setMessages((m) => [...m, { role: "assistant", text: `Sorry — ${r.error}`, error: true }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", text: r.answer, plan: r.plan, rows: r.rows, citations: r.citations }]);
      }
    } catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };

  if (!open) return <button onClick={() => setOpen(true)} className="fixed bottom-5 right-5 brand-btn h-12 w-12 rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition" data-testid="copilot-open" title="AI Co-Pilot"><I.Sparkles className="w-5 h-5" /></button>;

  const avail = models.filter((m) => m.ready);
  return (
    <div className="fixed bottom-5 right-5 w-[380px] max-w-[94vw] h-[560px] bg-white border rounded-xl shadow-2xl flex flex-col z-50" data-testid="copilot-panel">
      <header className="flex items-center gap-2 px-3 h-11 border-b">
        <I.Sparkles className="w-4 h-4 brand-text" />
        <div className="font-heading font-semibold text-[13px]">AI Co-Pilot</div>
        <div className="ml-auto flex items-center gap-1">
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="h-7 text-[11px] w-[140px]" data-testid="copilot-model"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-white">{models.map((m) => <SelectItem key={m.key} value={m.key} disabled={!m.ready}>{m.label}{!m.ready ? " (needs key)" : ""}</SelectItem>)}</SelectContent>
          </Select>
          <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-slate-100" data-testid="copilot-close"><I.X className="w-4 h-4" /></button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-[13px]" data-testid="copilot-messages">
        {messages.length === 0 && <div className="space-y-2">
          <div className="text-[12px] text-slate-500">Ask about your data. Permissions and masking are enforced automatically.</div>
          {SUGGESTED.map((s, i) => <button key={i} onClick={() => ask(s)} className="block w-full text-left px-3 py-2 rounded border bg-slate-50 hover:border-blue-300 text-[12px]" data-testid={`copilot-suggest-${i}`}>{s}</button>)}
        </div>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div className={`inline-block max-w-[85%] px-3 py-2 rounded-lg ${m.role === "user" ? "brand-btn" : m.error ? "bg-red-50 text-red-700 border border-red-200" : "bg-slate-100"}`}><div className="whitespace-pre-wrap">{m.text}</div></div>
            {m.plan && <div className="text-[10px] text-slate-400 mt-1">plan · {m.plan.register} · {m.rows?.length || 0} row(s)</div>}
            {m.citations?.length > 0 && <div className="flex flex-wrap gap-1 mt-1 justify-start">{m.citations.slice(0, 5).map((c, ci) => <Badge key={ci} variant="info">{c.number || c.id?.slice(0, 8)}</Badge>)}</div>}
          </div>))}
        <div ref={endRef} />
      </div>
      <form className="p-2 border-t flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your data…" disabled={busy} className="flex-1 border rounded px-3 py-2 text-[13px]" data-testid="copilot-input" />
        <Btn disabled={busy || !q.trim()} data-testid="copilot-send">{busy ? <I.Loader2 className="w-4 h-4 animate-spin" /> : <I.Send className="w-4 h-4" />}</Btn>
      </form>
      <div className="px-3 py-1 text-[10px] text-slate-400 border-t flex items-center gap-1"><I.ShieldCheck className="w-3 h-3" />Permissions + masking enforced · {avail.length || "…"} model(s) ready</div>
    </div>
  );
}
