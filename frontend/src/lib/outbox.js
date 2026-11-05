/**
 * Offline outbox for the JKEE ERP mobile view.
 *
 * - Queues mutation requests in IndexedDB when the device is offline (or the
 *   server is unreachable) and replays them when connectivity returns.
 * - Attaches an `Idempotency-Key` so the backend de-dupes retries.
 * - Exposes a tiny subscribe/get API that React components can poll.
 *
 * NOTE: only JSON mutations are queued. File uploads (multipart) are skipped —
 * they require the user to be online.
 */

const DB_NAME = "jkee-erp-outbox";
const STORE = "queue";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("status", "status", { unique: false });
        os.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "x-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---------------- subscriber plumbing ----------------
const listeners = new Set();
function notify() {
  listeners.forEach((fn) => { try { fn(); } catch (_) {} });
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------- core queue ops ----------------

/**
 * Enqueue a mutation request.
 * @param {Object} entry
 * @param {string} entry.method  - HTTP method
 * @param {string} entry.url     - relative to api baseURL (e.g. "/c/123/r/dprs")
 * @param {Object} entry.data    - JSON body
 * @param {string} [entry.label] - human-readable label for UI
 * @param {string} [entry.module] - module hint (e.g. "DPR", "GRN")
 */
export async function enqueue(entry) {
  const item = {
    id: uid(),
    status: "pending", // pending | sending | failed | done
    attempts: 0,
    lastError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    idempotencyKey: uid(),
    ...entry,
  };
  await withStore("readwrite", (s) => s.put(item));
  notify();
  return item;
}

export async function listAll() {
  return withStore("readonly", (s) => new Promise((resolve) => {
    const out = [];
    const req = s.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) { out.push(c.value); c.continue(); }
      else resolve(out.sort((a, b) => b.createdAt - a.createdAt));
    };
  }));
}

export async function pendingCount() {
  const all = await listAll();
  return all.filter((x) => x.status === "pending" || x.status === "sending" || x.status === "failed").length;
}

export async function remove(id) {
  await withStore("readwrite", (s) => s.delete(id));
  notify();
}

export async function clearDone() {
  const all = await listAll();
  await withStore("readwrite", (s) => {
    all.filter((x) => x.status === "done").forEach((x) => s.delete(x.id));
  });
  notify();
}

async function updateItem(id, patch) {
  await withStore("readwrite", (s) => new Promise((resolve) => {
    const req = s.get(id);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      Object.assign(cur, patch, { updatedAt: Date.now() });
      s.put(cur).onsuccess = () => resolve();
    };
  }));
  notify();
}

// ---------------- replay engine ----------------
let syncing = false;
let apiClient = null;        // axios instance injected by setClient()
let authFailureHandler = null;

export function setClient(axiosInstance, { onAuthFailure } = {}) {
  apiClient = axiosInstance;
  authFailureHandler = onAuthFailure || null;
}

export function isSyncing() {
  return syncing;
}

/**
 * Replay all pending items. Stops immediately on auth failure (so the user is
 * prompted to log in again instead of flooding failed retries).
 */
export async function replayAll() {
  if (!apiClient) return { sent: 0, failed: 0, skipped: 0 };
  if (!navigator.onLine) return { sent: 0, failed: 0, skipped: 0, reason: "offline" };
  if (syncing) return { sent: 0, failed: 0, skipped: 0, reason: "already-syncing" };
  syncing = true;
  notify();
  let sent = 0, failed = 0, skipped = 0;
  try {
    const items = await listAll();
    const todo = items.filter((x) => x.status === "pending" || x.status === "failed");
    for (const it of todo) {
      await updateItem(it.id, { status: "sending", attempts: (it.attempts || 0) + 1, lastError: null });
      try {
        await apiClient.request({
          method: it.method,
          url: it.url,
          data: it.data,
          headers: { "Idempotency-Key": it.idempotencyKey },
        });
        await updateItem(it.id, { status: "done" });
        sent += 1;
      } catch (e) {
        const status = e?.response?.status;
        const detail = e?.response?.data?.detail || e?.message || "Sync failed";
        if (status === 401) {
          await updateItem(it.id, { status: "pending", lastError: "Not signed in" });
          if (authFailureHandler) authFailureHandler();
          skipped += 1;
          break; // stop entire replay — needs re-auth
        }
        // 400-level validation failure: mark failed so user can inspect/remove
        if (status && status >= 400 && status < 500) {
          await updateItem(it.id, { status: "failed", lastError: String(detail) });
          failed += 1;
        } else {
          // network / 5xx — leave as pending to retry later
          await updateItem(it.id, { status: "pending", lastError: String(detail) });
          skipped += 1;
        }
      }
    }
  } finally {
    syncing = false;
    notify();
  }
  return { sent, failed, skipped };
}

// ---------------- connectivity hooks ----------------
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { replayAll(); });
  // best-effort: periodic replay every 30s while online
  setInterval(() => { if (navigator.onLine) replayAll(); }, 30000);
}
