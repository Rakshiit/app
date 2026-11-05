# plan.md — JKEE EPC ERP (Post-MVP) Plan (Updated)

## Objectives
- **Keep Phase 1 stable** while Phase 2/3 features are added (no regressions in registers, hooks, masking, PDFs, public links, AI reader).
- **Deliver Phase 2 automation/intelligence** as modular increments, each with clear UI + backend hooks and tenant isolation.
- **Implement Phase 3: Full M1 Pre‑Tender Workflow + Post‑Award Integration**, matching the user’s detailed state machine and UX expectations.
- **Strengthen interlinking** (tender → costing/BOQ → RFQ/vendor links → inbox replies → awards → project → procurement → PO/GRN → billing) inspired by major ERPs (Zoho/Odoo/Salesforce patterns: timeline, stage gates, approvals, traceability).
- **Respect user constraint:** build + compile-check only; **do not run testing**. User will test.

---

## Implementation Steps

### Phase 1.5 — Verification + Polish (Completed)
**Focus:** confirm field masking and remove rough edges before Phase 2/3 automation.

**Status:** ✅ Completed

**What was done**
- Verified role-based masking for restricted roles (site/store/etc.) across PO views.
- Closed a critical masking leak: **line-item `amount` exposed hidden `rate`** via qty×rate.
  - Updated `SENS` masking list in `backend/seed.py` to include `amount` and other financial totals.
  - Patched existing `roles` docs in MongoDB to include the expanded masked field list (**28 fields**).
- Regression sweep across dashboard and key registers: ✅ all green (at the time).

**Success criteria (met)**
- Site/store roles never see PO financials in API/UI (including item `rate`, PO totals, and item `amount`).

---

### Phase 2a — Offline Mobile Mode with Outbox Sync (P0) (Completed)
**Core workflow:** deterministic offline queue + safe replay when network returns.

**Status:** ✅ Completed (POC + V1 integration)

#### Phase 2a.1 — Core POC (Isolation) (Completed)
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

#### Phase 2a.2 — V1 App Development (Integrate into main app) (Completed)
**UI/UX implemented**
- Added `frontend/src/components/Outbox.jsx`
  - `OutboxBar`: Online/Offline badge + outbox count + “Sync now”.
  - `OutboxPanel`: full list with per-item status, retry/remove, clear synced.
- Updated `frontend/src/pages/Mobile.jsx`
  - OutboxBar added to `/mobile` home.
  - `/mobile/outbox` route added.
  - Home shows online/offline mode text.
  - Offline-aware save messaging.

**Notes / constraints**
- Current queuing is limited to JSON mutations; **multipart uploads are intentionally not queued**.

---

### Phase 2b — AI Co‑Pilot (Plain-language Queries) (P1) (Completed)
**Core workflow:** permission-aware natural language → constrained query DSL → safe answer with citations.

**Status:** ✅ Completed

**Backend**
- Added `backend/copilot.py`
  - Two-step pattern: LLM generates a constrained JSON plan; backend validates plan, enforces `require()` permissions and `scope_filter()`, and masks sensitive fields.
  - Then LLM summarizes only the permission-filtered + masked rows.
  - Model picker support:
    - Gemini (default)
    - Claude
    - ChatGPT
    - Perplexity (optional; requires `PERPLEXITY_API_KEY`, user skipped)
  - Endpoints:
    - `GET /api/c/{cid}/copilot/models`
    - `POST /api/c/{cid}/copilot/query`

**Frontend**
- Added `frontend/src/components/CoPilot.jsx` floating panel (global in Shell)
  - Suggested prompts
  - Model selector
  - Chat UI with citations badges

**Security / correctness**
- Permission enforcement: module-level `require()` is applied to the register in plan.
- Masking enforcement: sensitive fields are replaced with `••••` for restricted roles, and the model is instructed not to guess masked values.

**Note**
- “Option to select via Google login” is interpreted as *UI selection for provider*; the system does not use Google OAuth tokens as LLM credentials. Perplexity remains disabled unless the admin configures a key.

---

### Phase 2c — Super Admin 24h Cascading Rollback (P1) (Completed)
**Core workflow:** reversible operations across registers + hooks.

**Status:** ✅ Completed (V1)

**Backend**
- Added `backend/rollback.py`
  - `GET /api/admin/rollback/recent`
  - `GET /api/admin/rollback/preview/{seq}`
  - `POST /api/admin/rollback/execute/{seq}`
  - Reverses record state using audit chain LIFO restore.
  - Reverses linked side-effects (currently):
    - `stock_ledger` compensating entries + mark originals reversed
    - `cost_postings` rollback + project budget actual adjustment
    - pending `vouchers` deletion
    - alert cleanup
  - Super Admin only; 24h window.

**Frontend**
- Added `frontend/src/pages/Rollback.jsx` and route `/admin/rollback`
  - Recent list
  - Preview + reason capture
  - Execute rollback

---

### Phase 2d — Connected Mailboxes (IMAP ingestion) (P1) (Completed)
**Core workflow:** ingest inbound emails → match to vendor/RFQ/project timeline.

**Status:** ✅ Completed (Admin UI + ingestion endpoints)

**Backend**
- Added `backend/mailbox.py`
  - Admin mailbox CRUD:
    - `GET /api/c/{cid}/mailboxes`
    - `POST /api/c/{cid}/mailboxes`
    - `DELETE /api/c/{cid}/mailboxes/{mid}`
  - Manual sync:
    - `POST /api/c/{cid}/mailboxes/{mid}/sync`
  - Inbox timeline read:
    - `GET /api/c/{cid}/inbox`
    - `GET /api/c/{cid}/inbox/{eid}`
  - Matching rules (MVP): sender → vendor; subject/body token/RFQ number → RFQ; RFQ → project.

**Frontend**
- Added `frontend/src/pages/Mailbox.jsx` and route `/admin/mailbox`
  - Connect mailbox dialog
  - Sync now
  - Timeline list + email detail viewer

---

### Phase 2e — PDF Template Studio (P2) (Completed)
**Status:** ✅ Completed (HTML+Jinja preview + versioning)

**Backend**
- Added `backend/templates_studio.py`
  - Templates CRUD + version history.
  - Preview endpoint for sample context:
    - `POST /api/c/{cid}/pdf-templates/{tid}/preview`
  - Render live record as printable HTML:
    - `GET /api/c/{cid}/pdf-templates/{tid}/render/{record_id}`
  - Seed defaults:
    - `POST /api/c/{cid}/pdf-templates/seed-defaults`
  - Uses Jinja2 with a strict environment + `inr` filter.
  - Email templates supported (English/Hindi) as text templates.

**Frontend**
- Added `frontend/src/pages/Templates.jsx` and route `/admin/templates`
  - Template list
  - Editor
  - Preview (iframe for HTML templates; preformatted for email templates)

---

## Phase 3: Full M1 Pre‑Tender Workflow + Post‑Award Integration (Current Priority)

### Scope
Implement the user’s full **pre‑tender** workflow (bulk intake → director approval → NIT/BOQ extraction → BOQ Studio RFQ matrix with dynamic vendor rounds → locking + MD approval → quoting → won→project). Then replicate the BOQ Studio negotiation workflow under Project procurement post‑award.

### M1 State Machine (per user spec)
`Draft` → `Pending Director` → (`Rejected` | `Approved — Study`) → `BOQ & RFQ` → `Costing Locked` → `Pending MD` → (`Rejected` | `MD Approved`) → `Quoted` → (`Won` → auto Project | `Lost`)

### Backend — new file `backend/pretender.py`
**Goal:** a clear stage-gated API (plus reusing existing generic registers where possible) matching the state machine.

1. **Tender intake**
   - `POST /api/c/{cid}/tenders/bulk-import` (Excel: Tender ID, Name, Amount, EMD, Closing Date)
   - `POST /api/c/{cid}/tenders` basic create (5 fields; stage=`Draft`)
2. **Director approval**
   - `POST /api/c/{cid}/tenders/{tid}/submit-for-director`
   - `POST /api/c/{cid}/tenders/{tid}/director-decision` (approve|reject + reason)
3. **Document uploads + AI extraction**
   - `POST /api/c/{cid}/tenders/{tid}/upload-nit` (extract eligibility + docs required)
   - `POST /api/c/{cid}/tenders/{tid}/upload-boq` (extract items → tender.boq, editable)
   - `PUT /api/c/{cid}/tenders/{tid}/eligibility` (edit tech/fin/docs, compliance Yes/No)
4. **BOQ Studio + RFQ**
   - `POST /api/c/{cid}/tenders/{tid}/boq/send-rfq` (multi-vendor; link + optional docs)
   - `GET /api/c/{cid}/tenders/{tid}/boq/matrix` (items × vendors × rounds V1/V2/V3)
   - `POST /api/c/{cid}/tenders/{tid}/boq/pick` { item_id, vendor_id, round, rate }
   - `POST /api/c/{cid}/tenders/{tid}/boq/auto-fill` (pull from `inbox_emails`, AI parse replies, update matrix)
5. **Locking + MD approval + quote**
   - `POST /api/c/{cid}/tenders/{tid}/costing/lock`
   - `POST /api/c/{cid}/tenders/{tid}/md-decision` (approve|reject)
   - `POST /api/c/{cid}/tenders/{tid}/quote` { bid_value }
6. **Results → post-award conversion**
   - `POST /api/c/{cid}/tenders/{tid}/won` { loa_no, wo_value, ... } (uses existing `/award` logic + carry forward BOQ/vendor picks)
   - `POST /api/c/{cid}/tenders/{tid}/lost` { reason, competitor, l1_value }
7. **Pipeline reporting**
   - `GET /api/c/{cid}/pretender/pipeline` stage counts + due soon

### Frontend — M1 UX revamp
1. Rewrite `/pages/Tenders.jsx`
   - Horizontal **stage tab bar** (replace Kanban/Table toggle)
   - “Add tender” (only 5 fields)
   - “Bulk import Excel” (download sample template + upload)
   - Stage lists: Draft / Pending Director / Rejected / Approved / BOQ & RFQ / Pending MD / Quoted / Won / Lost
2. Rewrite Tender detail flow
   - Stage banner + stage-specific CTAs (Submit to Director, Upload NIT, Upload BOQ, Send RFQ, Lock Costing, Request MD approval, Quote, Won/Lost)
   - Tabs: Overview · Documents · Eligibility · **BOQ Studio** · Costing · Decision
3. BOQ Studio UI component
   - Items grid with dynamic vendor columns and rounds (V1/V2/V3…)
   - “Send RFQ” multi-select vendors dialog (secure vendor links)
   - Cell-level pick (vendor + round) and lock state.
4. Post‑award procurement re-use
   - Add “Procurement BOQ Studio” tab in Project detail
   - Second-round negotiation uses the same matrix component, now scoped to project procurement.
   - Action: “Create PO from pick”
5. Interlinking (ERP-style)
   - Project “Timeline” tab showing linked chain:
     tender → NIT/BOQ docs → RFQs/vendor links → inbox emails → quotes → PO → GRN → RA bills

### ERP Inspiration (Zoho/Odoo/Salesforce patterns)
- **Stage-gated pipelines** with role-based approvals.
- **Single record identity** + relational links (tender_id → project_id; ref pointers everywhere).
- **Timeline / chatter** style audit of all actions and communications.
- **Versioning** (costing versions, template versions, RFQ rounds).
- **Locking** after approvals.

---

## Next Actions (Immediate) (Revised)
1. **Phase 3 buildout (M1) priority**
   - Implement `backend/pretender.py` state machine endpoints.
   - Frontend rewrite for `/tenders` and BOQ Studio UX.
   - Post-award procurement BOQ Studio on projects.
2. **Interlinking hardening**
   - Timeline surfaces: include mailbox emails and RFQ links in tender/project context.
3. **Constraint enforcement**
   - Build + compile-check only.
   - **No testing by agent**; user will test.

---

## Overall Success Criteria
- Phase 1 remains stable (no regressions in lifecycle hooks, masking, PDFs, public links).
- Offline mobile mode reliably queues + syncs with idempotency and clear error handling. ✅
- Phase 2 features present and usable:
  - AI Co-Pilot with masking/permissions ✅
  - Rollback within 24h ✅
  - IMAP mailbox ingestion UI ✅
  - Template Studio with Hindi emails ✅
- Phase 3 (M1) matches the user’s described process and ERP-quality interlinking:
  - Bulk tender intake → approvals → AI extraction → BOQ Studio RFQ matrix → lock/MD approval → quote → award → project → procurement reuse.
