import axios from "axios";
import * as outbox from "./outbox";

export const BASE = process.env.REACT_APP_BACKEND_URL;
export const API = `${BASE}/api`;
export const api = axios.create({ baseURL: API });

api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("erp_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});
api.interceptors.response.use(
  (r) => r,
  async (e) => {
    const cfg = e?.config || {};
    const method = (cfg.method || "get").toUpperCase();
    const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    const isMultipart = cfg.headers && (cfg.headers["Content-Type"] || "").startsWith("multipart");
    const alreadyIdempotent = cfg.headers && (cfg.headers["Idempotency-Key"] || cfg.headers["idempotency-key"]);
    const networkError = !e.response; // no response => offline / server unreachable

    // Auto-queue mutations when the device is offline or server is unreachable.
    // We never queue multipart uploads or requests the caller already tagged
    // with an idempotency key (those are typically replay attempts).
    if (
      isMutation &&
      !isMultipart &&
      !alreadyIdempotent &&
      (networkError || !navigator.onLine) &&
      cfg.url &&
      !cfg.url.includes("/auth/login") &&
      !cfg.url.includes("/sync/")
    ) {
      try {
        await outbox.enqueue({
          method,
          url: cfg.url,
          data: cfg.data ? (typeof cfg.data === "string" ? JSON.parse(cfg.data) : cfg.data) : undefined,
          label: `${method} ${cfg.url}`,
          module: cfg.meta?.module || "",
        });
        // Return a synthetic success so the caller UI doesn't crash — the
        // record will appear after sync completes. Components can render an
        // "Pending sync" chip from the outbox panel.
        return { data: { _queued: true, _offline: true }, status: 202, statusText: "Queued" };
      } catch (err) {
        // If queueing itself fails, surface the original error.
        return Promise.reject(e);
      }
    }

    if (e?.response?.status === 401 && !cfg.url?.includes("/auth/login") && !window.location.pathname.startsWith("/v/")) {
      localStorage.removeItem("erp_token");
      if (window.location.pathname !== "/login") window.location.href = "/login";
    }
    return Promise.reject(e);
  }
);

// Register this axios instance with the outbox so replay uses the same auth.
outbox.setClient(api, {
  onAuthFailure: () => {
    if (window.location.pathname !== "/login") window.location.href = "/login";
  },
});

export const errMsg = (e) => {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x.msg).join(", ");
  return e?.message || "Something went wrong";
};

export const reg = (cid, r) => ({
  list: (params) => api.get(`/c/${cid}/r/${r}`, { params }).then((x) => x.data),
  get: (id) => api.get(`/c/${cid}/r/${r}/${id}`).then((x) => x.data),
  create: (d) => api.post(`/c/${cid}/r/${r}`, d).then((x) => x.data),
  update: (id, d) => api.put(`/c/${cid}/r/${r}/${id}`, d).then((x) => x.data),
  remove: (id) => api.delete(`/c/${cid}/r/${r}/${id}`).then((x) => x.data),
  submit: (id) => api.post(`/c/${cid}/r/${r}/${id}/submit`).then((x) => x.data),
});

export async function openBlob(url, filename, download = false) {
  const r = await api.get(url, { responseType: "blob" });
  const u = URL.createObjectURL(r.data);
  if (download) {
    const a = document.createElement("a");
    a.href = u; a.download = filename || "file"; a.click();
  } else window.open(u, "_blank");
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}

export async function uploadFile(cid, file, tag = "", stamp = "") {
  const fd = new FormData();
  fd.append("file", file); fd.append("tag", tag); fd.append("stamp", stamp);
  return (await api.post(`/c/${cid}/files`, fd)).data;
}
