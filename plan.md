# plan.md — JKEE EPC ERP (Post-MVP) Plan (Updated)

## Objectives
- **Keep Phase 1 stable** while Phase 2 features are added (no regressions in registers, hooks, masking, PDFs, public links, AI reader).
- **Complete and lock Phase 2a (P0): Offline Mobile Mode** for `/mobile` with reliable outbox sync, idempotency, and clear UX.
- **Start Phase 2b–2e** (AI Co-Pilot, rollback, mailboxes, PDF studio) as separate, testable increments.
- **Pause for user guidance** on Phase 2 priority and scope before major new buildouts.

---

## Implementation Steps

### Phase 1.5 — Verification + Polish (Completed)
**Focus:** confirm field masking and remove rough edges before Phase 2 automation.

**Status:** ✅ Completed

**What was done**
- Verified role-based masking for restricted roles (site/store/etc.) across PO views.
- Closed a critical masking leak: **line-item `amount` exposed hidden `rate`** via qty×rate.
  - Updated `SENS` masking list in `backend/seed.py` to include `amount` and other financial totals.
  - Patched existing `roles` docs in MongoDB to include the expanded masked field list (**28 fields**).
- Regression sweep across dashboard and key registers: ✅ all green.

**Success criteria (met)**
- Site/store roles never see PO financials in API/UI (including item `rate`, PO totals, and item `amount`).
- No new P0/P1 regressions in smoke suite.

---

### Phase 2a — Offline Mobile Mode with Outbox Sync (P0) (Completed)
**Core workflow:** deterministic offline queue + safe replay when network returns.

**Status:** ✅ Completed (POC + V1 integration)

#### Phase 2a.1 — Core POC (Isolation) (Completed)
**Goal:** prove offline capture + replay works end-to-end with real backend.

**Backend implemented**
- Added `backend/idempotency.py`
  - Starlette middleware honoring `Idempotency-Key` header for mutation requests.
  - Persists successful mutation responses in MongoDB collection `idempotency_keys`.
  - 24-hour TTL enforced via `expires_at` date field + TTL index.
  - Replay returns cached response with `X-Idempotent-Replay: 1`.
- Added `GET /api/sync/ping` endpoint for reachability checks.

**Frontend implemented**
- Added `frontend/src/lib/outbox.js`
  - IndexedDB-backed queue with statuses: `pending | sending | failed | done`.
  - Auto-replay on `online` event + periodic replay every 30 seconds while online.
  - Subscribe API to support reactive UI.
- Updated `frontend/src/lib/api.js`
  - Axios response interceptor enqueues **JSON mutations** on network failure/offline.
  - Returns a synthetic **202 Queued** response (`{_queued:true,_offline:true}`) to avoid UI crashes.

**Verification (met)**
- 5x retries with the same idempotency key → **same record id** and **only +1 DB row**.

#### Phase 2a.2 — V1 App Development (Integrate into main app) (Completed)
**UI/UX implemented**
- Added `frontend/src/components/Outbox.jsx`
  - `OutboxBar`: Online/Offline badge + outbox count + “Sync now”.
  - `OutboxPanel`: full list with per-item status, retry/remove, clear synced.
- Updated `frontend/src/pages/Mobile.jsx`
  - OutboxBar added to `/mobile` home.
  - `/mobile/outbox` route added.
  - Home shows online/offline mode text.
  - Offline-aware save messaging (“Saved offline — will sync when back online”).

**E2E verification (met)**
- Offline save → queued as `pending`.
- Reconnect → auto replay → queued item becomes `done`.
- Exactly one server record created; no duplicates.

**Notes / constraints**
- Current queuing is limited to JSON mutations; **multipart uploads are intentionally not queued**.

---

### Phase 2b — AI Co-Pilot (Plain-language Queries) (P1) (Next)
**Core workflow:** permission-aware natural language → constrained query DSL → safe answer with citations.

**Status:** ⏳ Not started (awaiting user priority/scope confirmation)

**User stories**
1. As a PM, I can ask “show delayed DPR approvals this week” and get a filtered list.
2. As accounts, I can ask “total billed vs budget for Project X” and get numbers + sources.
3. As a site engineer, I cannot retrieve masked financials via chat.
4. As an admin, I can see citations (which registers/records were used).
5. As a user, I can export result sets where permitted.

**Steps (revised for current architecture)**
- POC:
  - Add `/api/copilot/query` endpoint: NL → constrained query DSL (no raw DB access from model).
  - Enforce permissions and masking at the data fetch layer (reuse existing `require()` + masking rules).
  - Add response citations (register + record ids).
- V1:
  - Add Copilot panel in Dashboard.
  - Provide “Suggested prompts” by role.

**Success criteria**
- Cannot exfiltrate masked fields via prompt injection.
- Useful answers on seeded demo data with citations.

---

### Phase 2c — Super Admin 24h Cascading Rollback (P1)
**Core workflow:** reversible operations across registers + hooks.

**Status:** ⏳ Not started (awaiting user priority/scope confirmation)

**User stories**
1. As super admin, I can roll back a mistaken record and linked stock/budget effects.
2. As super admin, I can preview what will be reversed.
3. Rollback is allowed only within 24 hours.
4. Audit trail captures rollback reason and affected entities.
5. No partial rollback states.

**Steps**
- POC:
  - Introduce event log / operation journal (or reuse audit) with compensating actions.
  - Cover 1–2 critical flows first (e.g., DPR approval → stock/budget hooks).
- V1:
  - Rollback UI with preview + safety checks.

**Success criteria**
- No orphaned linked records after rollback in covered flows.

---

### Phase 2d — Connected Mailboxes (IMAP ingestion) (P1)
**Core workflow:** ingest inbound emails → match to vendor/RFQ/project timeline.

**Status:** ⏳ Not started (awaiting user priority/scope confirmation)

**User stories**
1. As procurement, I can connect an IMAP mailbox and ingest emails.
2. As procurement, emails auto-match to RFQs/quotes by token/subject.
3. Users can see an email timeline inside a project.
4. Admin can pause ingestion and view errors.
5. Tenant isolation preserved.

**Steps**
- POC:
  - IMAP pull last N messages; store metadata + attachments.
- V1:
  - Matching rules + timeline UI.

**Success criteria**
- Reliable ingestion without duplicates; tenant isolation preserved.

---

### Phase 2e — PDF Template Studio (P2)
**Status:** ⏳ Not started

**User stories**
1. Admin creates client-specific template variants.
2. Preview templates with seeded data.
3. PDFs follow branding and required fields.
4. Hindi email templates supported.
5. Template changes are versioned.

**Steps**
- Define constrained template schema.
- UI for field mapping → preview → save → version.

**Success criteria**
- 2–3 client templates produced without code changes.

---

## Next Actions (Immediate) (Revised)
1. **Lock in Phase 2a**
   - (Optional hardening) add a small help tooltip in OutboxPanel explaining limitations (e.g., file uploads require online).
   - (Optional) add a minimal `/api/sync/status` endpoint if needed later for diagnostics.
2. **Confirm Phase 2 priority with user**
   - Choose between Phase 2b (AI Co-Pilot), 2c (Rollback), 2d (Mailboxes), 2e (PDF Studio).
3. Once priority is confirmed, start the **next Phase POC** with strict permission/masking enforcement and a dedicated smoke-test pass.

---

## Overall Success Criteria
- Phase 1 remains stable (no regressions in lifecycle hooks, masking, PDFs, public links).
- Offline mobile mode reliably queues + syncs with idempotency and clear error handling. ✅
- Remaining Phase 2 items have validated cores (POCs) before full UI/feature buildout.