import React, { useEffect, useState } from "react";
import * as outbox from "@/lib/outbox";
import * as I from "lucide-react";
import { toast } from "sonner";

function useOnline() {
  const [on, setOn] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  useEffect(() => {
    const u = () => setOn(navigator.onLine);
    window.addEventListener("online", u);
    window.addEventListener("offline", u);
    return () => { window.removeEventListener("online", u); window.removeEventListener("offline", u); };
  }, []);
  return on;
}

function useOutbox() {
  const [items, setItems] = useState([]);
  const refresh = async () => setItems(await outbox.listAll());
  useEffect(() => {
    refresh();
    return outbox.subscribe(refresh);
  }, []);
  return { items, refresh };
}

/** Compact bar: online badge + pending count + sync button. */
export function OutboxBar({ onOpen }) {
  const online = useOnline();
  const { items } = useOutbox();
  const [busy, setBusy] = useState(false);
  const pending = items.filter((x) => x.status !== "done");
  const failed = items.filter((x) => x.status === "failed").length;
  const sync = async () => {
    if (!online) return toast.error("Offline — will auto-sync when back online");
    setBusy(true);
    const r = await outbox.replayAll();
    setBusy(false);
    if (r?.sent) toast.success(`Synced ${r.sent} item${r.sent > 1 ? "s" : ""}`);
    else if (r?.failed) toast.error(`${r.failed} item${r.failed > 1 ? "s" : ""} rejected — check outbox`);
    else if (!pending.length) toast.success("Nothing to sync");
  };
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-white mb-3" data-testid="outbox-bar">
      <button onClick={onOpen} className="flex items-center gap-2 text-[13px] font-medium" data-testid="outbox-open">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${online ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`} />{online ? "Online" : "Offline"}
        </span>
        <span className="text-slate-700">Outbox</span>
        <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-slate-900 text-white text-[11px] font-semibold" data-testid="outbox-count">{pending.length}</span>
        {failed > 0 && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600"><I.AlertTriangle className="w-3.5 h-3.5" />{failed}</span>}
      </button>
      <button onClick={sync} disabled={busy || !pending.length} className="text-[12px] font-semibold px-3 py-1.5 rounded-md brand-btn disabled:opacity-40" data-testid="outbox-sync">
        {busy ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}

/** Full-screen Outbox panel showing all queued items. */
export function OutboxPanel({ onClose }) {
  const online = useOnline();
  const { items } = useOutbox();
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    if (!online) return toast.error("Offline — will auto-sync when back online");
    setBusy(true);
    const r = await outbox.replayAll();
    setBusy(false);
    if (r?.sent) toast.success(`Synced ${r.sent} item${r.sent > 1 ? "s" : ""}`);
  };
  const remove = async (id) => { await outbox.remove(id); toast.success("Removed from outbox"); };
  const retry = async (id) => {
    // reset to pending and kick off replay
    const list = await outbox.listAll();
    const it = list.find((x) => x.id === id);
    if (it) { await outbox.remove(id); await outbox.enqueue({ method: it.method, url: it.url, data: it.data, label: it.label, module: it.module }); sync(); }
  };
  return (
    <div className="space-y-3" data-testid="outbox-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-heading font-semibold">Outbox ({items.length})</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => { outbox.clearDone(); toast.success("Cleared synced items"); }} className="text-[12px] text-slate-600" data-testid="outbox-clear-done">Clear synced</button>
          <button onClick={sync} disabled={busy} className="text-[12px] font-semibold px-3 py-1.5 rounded-md brand-btn disabled:opacity-40" data-testid="outbox-sync-all">
            {busy ? "Syncing…" : "Sync all"}
          </button>
        </div>
      </div>
      {!items.length && (
        <div className="text-center py-10 text-slate-500 border rounded-lg bg-white">
          <I.Inbox className="w-8 h-8 mx-auto mb-2 text-slate-400" />
          <div className="text-[14px] font-medium">Nothing in outbox</div>
          <div className="text-[12px]">Work offline — your actions queue here and auto-sync.</div>
        </div>
      )}
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="bg-white border rounded-lg p-3 text-[13px]" data-testid={`outbox-item-${it.id}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium truncate">{it.label || `${it.method} ${it.url}`}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {new Date(it.createdAt).toLocaleString("en-IN")} · attempts {it.attempts || 0}
                  {it.lastError && <span className="ml-1 text-red-600">· {it.lastError}</span>}
                </div>
              </div>
              <StatusChip s={it.status} />
            </div>
            {(it.status === "failed" || it.status === "pending") && (
              <div className="flex gap-2 mt-2">
                {it.status === "failed" && <button onClick={() => retry(it.id)} className="text-[12px] px-2 py-1 border rounded-md" data-testid={`outbox-retry-${it.id}`}>Retry</button>}
                <button onClick={() => remove(it.id)} className="text-[12px] px-2 py-1 border rounded-md text-red-600" data-testid={`outbox-remove-${it.id}`}>Remove</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {onClose && <button onClick={onClose} className="w-full h-10 rounded-lg border text-[14px] font-medium">Close</button>}
    </div>
  );
}

function StatusChip({ s }) {
  const map = {
    pending: ["bg-amber-100 text-amber-800", "Pending"],
    sending: ["bg-blue-100 text-blue-800", "Sending…"],
    done: ["bg-emerald-100 text-emerald-700", "Synced"],
    failed: ["bg-red-100 text-red-700", "Failed"],
  };
  const [cls, lbl] = map[s] || map.pending;
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{lbl}</span>;
}
