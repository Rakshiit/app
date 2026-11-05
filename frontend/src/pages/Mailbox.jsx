import React, { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { PageHeader, Btn, Badge, inputCls } from "@/components/common";
import { toast } from "sonner";
import * as I from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

const DEFAULTS = { host: "", port: 993, user: "", password: "", ssl: true, folder: "INBOX", active: true, name: "Vendor inbox" };

export default function Mailbox() {
  const { cid } = useApp();
  const [mailboxes, setMailboxes] = useState([]);
  const [emails, setEmails] = useState([]);
  const [edit, setEdit] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    try {
      const [m, e] = await Promise.all([api.get(`/c/${cid}/mailboxes`), api.get(`/c/${cid}/inbox?limit=200`)]);
      setMailboxes(m.data); setEmails(e.data);
    } catch (e) { toast.error(errMsg(e)); }
  };
  useEffect(() => { load(); }, [cid]);

  const save = async () => {
    if (!edit.host || !edit.user) return toast.error("Host and user are required");
    setBusy(true);
    try { await api.post(`/c/${cid}/mailboxes`, edit); toast.success("Mailbox saved"); setOpen(false); load(); }
    catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  const sync = async (id) => {
    setBusy(true);
    try { const r = (await api.post(`/c/${cid}/mailboxes/${id}/sync?limit=50`)).data; toast.success(`Fetched ${r.ingested} email(s)` + (r.errors?.length ? " — " + r.errors[0] : "")); load(); }
    catch (e) { toast.error(errMsg(e)); }
    setBusy(false);
  };
  const remove = async (id) => { if (!window.confirm("Remove mailbox?")) return; await api.delete(`/c/${cid}/mailboxes/${id}`); load(); };

  return (
    <div className="fade-up p-4" data-testid="mailbox-page">
      <PageHeader title="Connected mailboxes" subtitle="Pull vendor replies into the project timeline automatically" extra={<Btn onClick={() => { setEdit(DEFAULTS); setOpen(true); }} data-testid="mailbox-add"><I.Plus className="w-4 h-4 mr-1" />Connect mailbox</Btn>} />

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-slate-500">Mailboxes</div>
          {mailboxes.length === 0 ? <div className="bg-white border rounded-lg p-6 text-center text-slate-500 text-[12px]"><I.Inbox className="w-6 h-6 mx-auto mb-1 text-slate-400" />No mailbox connected</div> :
            mailboxes.map((m) => (
              <div key={m.id} className="bg-white border rounded-lg p-3 text-[12px]" data-testid={`mailbox-row-${m.id}`}>
                <div className="flex items-center justify-between mb-1"><b>{m.name}</b><Badge variant={m.status === "Error" ? "danger" : "ok"}>{m.status || "Configured"}</Badge></div>
                <div className="text-slate-500">{m.user}@{m.host}:{m.port}</div>
                <div className="text-[11px] text-slate-500 mt-1">Last UID {m.last_uid || 0} · {m.active ? "Active" : "Paused"}</div>
                {m.last_error && <div className="text-red-600 text-[11px] mt-1">{m.last_error}</div>}
                <div className="flex gap-1 mt-2">
                  <Btn size="sm" onClick={() => sync(m.id)} disabled={busy} data-testid={`mailbox-sync-${m.id}`}><I.RefreshCcw className="w-3.5 h-3.5 mr-1" />Sync now</Btn>
                  <Btn size="sm" variant="outline" onClick={() => { setEdit(m); setOpen(true); }} data-testid={`mailbox-edit-${m.id}`}>Edit</Btn>
                  <Btn size="sm" variant="outline" onClick={() => remove(m.id)} data-testid={`mailbox-del-${m.id}`}>Remove</Btn>
                </div>
              </div>))}
          <div className="text-[11px] text-slate-500 p-2"><I.Lightbulb className="w-3.5 h-3.5 inline mr-1" />For Gmail/Google Workspace use <code>imap.gmail.com</code> with an App Password. For O365 use <code>outlook.office365.com</code>.</div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2"><div className="text-[12px] font-semibold text-slate-500">Inbox timeline ({emails.length})</div></div>
          {emails.length === 0 ? <div className="bg-white border rounded-lg p-10 text-center text-slate-500"><I.Mail className="w-8 h-8 mx-auto mb-2 text-slate-400" />No emails ingested yet</div> :
            <ul className="space-y-2" data-testid="mailbox-timeline">{emails.map((e) => (
              <li key={e.id} className="bg-white border rounded-lg p-3 text-[13px] cursor-pointer hover:border-blue-300" onClick={async () => setSelected((await api.get(`/c/${cid}/inbox/${e.id}`)).data)} data-testid={`inbox-item-${e.id}`}>
                <div className="flex items-center gap-2"><I.Mail className="w-4 h-4 text-slate-400" /><b className="truncate">{e.subject || "(no subject)"}</b>{e.rfq_number && <Badge variant="info">{e.rfq_number}</Badge>}{e.vendor_name && <Badge>{e.vendor_name}</Badge>}</div>
                <div className="text-[12px] text-slate-600 truncate mt-1">{e.from}</div>
                <div className="text-[11px] text-slate-500 mt-1">{e.received_at?.slice(0,19)?.replace("T"," ")}</div>
                <div className="text-[12px] text-slate-700 mt-1 line-clamp-2">{e.preview}</div>
              </li>))}</ul>}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-white">
          <DialogHeader><DialogTitle>Connect mailbox</DialogTitle></DialogHeader>
          {edit && <div className="space-y-3 text-[13px]">
            <label className="block">Name<input className={inputCls} value={edit.name || ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="block">IMAP host<input className={inputCls} value={edit.host || ""} onChange={(e) => setEdit({ ...edit, host: e.target.value })} placeholder="imap.gmail.com" data-testid="mailbox-host" /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">Port<input type="number" className={inputCls} value={edit.port || 993} onChange={(e) => setEdit({ ...edit, port: Number(e.target.value) })} /></label>
              <label className="flex items-center gap-2 text-[12px] mt-6"><input type="checkbox" checked={!!edit.ssl} onChange={(e) => setEdit({ ...edit, ssl: e.target.checked })} />SSL</label>
            </div>
            <label className="block">Username / email<input className={inputCls} value={edit.user || ""} onChange={(e) => setEdit({ ...edit, user: e.target.value })} data-testid="mailbox-user" /></label>
            <label className="block">Password / app password<input type="password" className={inputCls} value={edit.password || ""} onChange={(e) => setEdit({ ...edit, password: e.target.value })} placeholder={edit.id ? "Leave empty to keep existing" : ""} data-testid="mailbox-pw" /></label>
            <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Active (polls on sync)</label>
          </div>}
          <DialogFooter><Btn variant="outline" onClick={() => setOpen(false)}>Cancel</Btn><Btn onClick={save} disabled={busy} data-testid="mailbox-save">{busy ? "Saving…" : "Save"}</Btn></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader><DialogTitle className="truncate">{selected?.subject}</DialogTitle></DialogHeader>
          {selected && <div className="text-[13px] space-y-2">
            <div className="text-[12px] text-slate-500">From {selected.from} · {selected.received_at?.slice(0,19)?.replace("T"," ")}</div>
            <div className="flex flex-wrap gap-1">{selected.rfq_number && <Badge variant="info">{selected.rfq_number}</Badge>}{selected.vendor_name && <Badge>{selected.vendor_name}</Badge>}{selected.project_id && <Badge variant="ok">matched project</Badge>}</div>
            <pre className="whitespace-pre-wrap text-[12px] bg-slate-50 p-3 rounded max-h-[60vh] overflow-auto">{selected.body}</pre>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
