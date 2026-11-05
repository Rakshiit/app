# JKEE EPC ERP: Multi-Company Project Lifecycle Platform

One connected system for Electrical & Civil EPC companies that covers the full lifecycle: tender, award, execution, billing, and closure. It works across companies, states, projects, and sites.
You enter each piece of data once. A single Project Code carries it from the winning tender through to the final archive.

## Who it's for
- **Management / Directors**: Go/No-Go and costing approvals, a group dashboard across companies, margins.
- **Tender team**: finding tenders, reading tender documents, getting vendor quotes, costing, submitting bids.
- **Project managers, planning and site engineers**: WBS, sites, DPRs, change orders, drawings, RFIs.
- **Procurement and store**: requisitions, RFQs, POs, GRNs, stock, equipment, vehicles.
- **HR and accounts**: onboarding, attendance, payroll, claims, RA bills, receipts, BGs, budget vs actual.
- **Safety, quality and legal**: checklists, NCRs, contracts, permits, correspondence.
- **External users**: clients get a read-only portal. Vendors never log in; they use secure, single-purpose links.

## Core features and experience (Phase 1 / MVP)
Phase 1 covers all 15 modules end to end, with the automatic links between them working. The only exceptions are features that need an outside account or a device. Those are listed under Phases 2 and 3.

**Multi-company foundation**
- After login, everyone lands on a Company Launchpad. It shows cards with logo, GSTIN count, running projects, pending approvals, and the theme swatch. Super Admins also get a "+ Create New Company" card and a Group MIS button.
- A 4-step company wizard covers:
  1. Statutory identity, with a multi-state GSTIN grid and EPF/ESIC/PT.
  2. Banks with BG limits, logo, letterhead, signatories, and Tally company name.
  3. The company document vault.
  4. Colour theme.
- 6 preset palettes plus a custom 3-colour picker. A contrast guard keeps text readable. The whole app re-skins when you switch company.
- Each company's data and files are kept physically separate. They can only cross through the Cross-Company Import wizard, which runs in 4 steps: choose source, filter and select, resolve duplicates, then clone with an audit log. Vendor KYC files can be cloned too if you choose.
- The company vault has 4 tabs: Registrations & Tax, Licences, Financial & Eligibility, and Authorisations. It supports version history and issue/expiry dates, gives 30/15/7/1-day expiry alerts, and shows a "verified" badge.

**Cross-cutting engines**
- **Split-screen AI reader**: upload a NIT, BOQ (PDF, Word, Excel including .xlsm), corrigendum, vendor quote, or invoice. The original appears on the left and the extracted fields on the right, with confidence badges. Nothing is saved until you click "Confirm & Save", and every field stays editable.
- **Permissions in 4 layers**: by company, by module, by tab, and by field. Field masking hides salary, vendor rates, and margin. Records can also be filtered by state, project, and site. There are 15+ predefined roles, role cloning, multiple roles per user, and dated approval delegation.
- **Two-stage HR onboarding gate**: an employee's login stays locked until HR marks their mandatory documents as verified.
- **Tamper-proof audit trail** for every change.
- **Tasks and sub-tasks**, plus a unified calendar showing tasks, tender deadlines, BG, licence and insurance expiries, and reminders.

**Modules**
- **M1 Tenders**
  - Kanban and table pipeline.
  - Single entry or bulk Excel upload.
  - MD Go/No-Go, with a mandatory reason when rejecting.
  - AI reading of dates, EMD, eligibility, and required documents.
  - Feasibility check against the vault.
  - Pre-bid BOQ built from the Product Master.
  - Vendor RFQs with V1/V2/V3 side-by-side quotes and historical rate benchmarks.
  - Document checklist, OEM authorisation (MAF) tracker, and EMD register.
  - Versioned costing for EPC, O&M manpower, and AMC. Bid submission is blocked until final approval, and every rate or margin edit is logged with old and new values.
  - Won: one-click conversion to a project. Lost: records reason, competitor, and L1 rates, which feed win-ratio analytics.
  - Manual corrigendum log, plus search by Tender ID.
- **M2 Award & Project**
  - Confirming the LOA/WO does four things: creates the Project Code (e.g. JKEE-JK-2627-P001), carries the tender data forward, turns the EMD into a Performance BG, and turns the costing into a 5-head baseline budget.
  - 6-level WBS shown as a tree and a Gantt, with multiple sites per project and project roles.
  - Change orders adjust value, timeline, and budget. Any pending change order blocks closure.
  - Hindrance register.
- **M3 HR & Payroll**
  - Employee and labour master, with splits across projects.
  - GPS and photo attendance, supervisor headcounts, and office regularisation. The PM locks attendance before payroll runs.
  - Monthly and daily-wage payroll, with state minimum-wage checks. Labour cost posts to the project budget.
  - Payslips and wage registers.
  - Expense claims, advances, and petty cash.
  - HR letters.
  - Training and licence register with expiry alerts.
  - Employee self-service.
- **M4 Procurement**
  - Product and vendor masters, plus vendor self-onboarding links.
  - Requisitions go to the PM for approval, then to procurement. Low stock creates a requisition automatically.
  - RFQ emails with a secure price-entry link.
  - Landed-cost comparison matrix.
  - Value-based PO approval, with a branded PO PDF sent by email.
  - Acknowledgement and delivery reminders, and vendor advances.
  - GRNs to the central store or direct to site, feeding stock and accounts.
  - Email timeline per vendor.
- **M5 Inventory & Assets**
  - Stock ledger for the central store and each site store.
  - Stock transfers that need approval.
  - Reorder alerts.
  - Client free-issue material register.
  - Equipment master with usage cost posting and maintenance alerts.
  - Vehicle master with trip and fuel logs, plus insurance, fitness, PUC, and service alerts.
  - Insurance register (CAR, WC, vehicle) with premiums posted to overheads. Claims can be started from a safety incident.
- **M6 Site Progress**
  - DPRs tied to project, site, and WBS item, with stamped site photos.
  - Weighted progress %, planned vs actual S-curves, multi-site comparison, and flags for missing DPRs.
  - When the PM approves a DPR, site stock is drawn down and a draft RA bill line is created.
  - Open NCRs can hold back milestone sign-off.
  - Versioned drawing register (superseded revisions are locked) and an RFI log.
- **M7 Subcontractors**
  - Subcontractor master and branded work orders.
  - Subcontractor DPRs reviewed by the site engineer and then the PM.
  - Progress bills with retention, advance recovery, and deductions.
  - Payment ledger.
  - Performance rating that takes NCRs into account.
- **M8 Accounts**
  - RA bills drafted automatically from approved DPRs, covering cumulative, previous, and current quantities, change orders, and escalation. Billing beyond the WO value or the certified quantity is blocked.
  - Unbilled work-done report.
  - GST tax invoices with retention and mobilisation-advance recovery.
  - Bill submission tracker with ageing.
  - Client receipts.
  - Deduction register (TDS, GST TDS, labour cess, SD, LD) and credit/debit notes.
- **M9 BG & Budget**
  - Unified BG register (EMD, mobilisation, performance, retention) with renewals and an expiry calendar.
  - Mobilisation advance recovery schedule.
  - Live budget vs actual across Labour, Material, Subcontractor, Equipment, and Overheads.
  - Earned value: physical % vs billed % vs cost %.
  - Overrun alerts and margin roll-ups.
- **M10 Safety, Quality & Legal**
  - Configurable checklists.
  - Incidents and NCRs with escalation when overdue.
  - Contract repository.
  - Statutory compliance alerts.
  - Disputes, DLP, and warranty tracking.
  - Permit/NOC tracker.
  - Correspondence register with reply-due alerts.
- **M11 Closure**
  - An 11-point live gate. Every failed point is a clickable blocker, and closure is blocked until all 11 pass.
  - Management approval freezes the margin and archives the project as read-only.
  - Excel onboarding for running projects, and a Completed Projects archive.
  - Read-only client portal with projects, milestones, RA bills, payment status, and PDF downloads. Every client view is logged.
- **M12 Tally (in-app part)**
  - Ledger, stock-item, cost-centre, and tax mappings.
  - Voucher queue (sales, purchase, payment, receipt, journal, payroll, notes) showing Pending/Synced/Failed.
  - **Entry locking**: once a record is approved and synced, or its period is closed, it can only be corrected through a reversal or a credit/debit note. Otherwise the Accounts Head has to reopen it with a logged reason.
- **M13 Governance**
  - Role dashboards and a "My Tasks" inbox.
  - Multi-level approvals on web and phone.
  - Consolidated state and company MIS.
  - Excel import/export on the main registers.
  - Versioned document management.
- **M14 Documents**
  - Branded PDFs for every company: RFQ, PO, WO, RA bill, invoice, payslip, and HR letters.
  - Auto-numbering by company/state/FY/type/revision, DRAFT watermarks, signature stamps, and QR verification codes.
  - One-click indexed RA Bill Submission Pack: cover letter, bill, abstract, measurements, photos, GRNs, and certificates.
- **M15 Alerts & Email**
  - Outbound English email from the app, with the send status logged.
  - In-app alerts for expiries and deadlines on 30/15/7/1-day rules.
  - Email Triage list: attach any sent email or logged communication to a project, task, tender, or vendor.

**Vendor links (no vendor portal)**
- Each RFQ, onboarding, PO-acknowledgement, or bill-submission request creates a secure, expiring, single-purpose link.
- The buyer can send it by email from the app, or copy it to share on WhatsApp or their own email. Both options are always available.
- The email includes the full RFQ item list and a download link for the RFQ PDF, so a vendor can reply with prices without opening the entry form.
- Vendor submissions land in a staging queue. Nothing goes live until the buyer confirms it.

**Basic phone version (/mobile)**
- A phone-friendly web app for site engineers and employees: GPS and photo attendance, DPR with photos, material requisition, stock transfer, checklists, vehicle trips, expense claims, payslips and documents, and approvals.
- It works online only in Phase 1.

## User flow
1. Log in, then pick a company on the Launchpad. The theme and data switch to that company.
2. The tender team adds a tender. The MD approves Go. The team uploads the NIT/BOQ, and the AI fills the drawer for them to confirm.
3. The team runs the feasibility check against the vault, builds the BOQ, and sends RFQs. Vendors reply through their link and the team confirms the quotes.
4. The team prepares costing v1, v2, and so on. Management gives final approval, then the bid is submitted and the EMD is logged.
5. When the tender is won and the WO is confirmed, the system creates the Project Code, the Performance BG, and the baseline budget automatically.
6. The PM sets up the WBS and sites. Site engineers record attendance and DPRs on their phones. Procurement runs requisition → RFQ → PO → GRN, and stock updates.
7. When the PM approves a DPR, stock is drawn down and a draft RA bill line is created. Accounts finalises the bill and generates the submission pack, and the client sees it in the portal.
8. Payroll, GRNs, subcontractor bills, and equipment/vehicle costs post to budget vs actual, and the vouchers join the Tally queue.
9. The closure gate shows any remaining blockers. Once all 11 pass, management closes the project and its margin is frozen in the archive.

## UI/UX feel
- A dense, professional operations workspace with a left sidebar for modules M1 to M15, a top bar with the company switcher, and tables built for heavy data entry.
- Each company's chosen palette re-skins the shell, surfaces, and action colours, so it is always clear which company you are working in.
- Solid backgrounds throughout, Indian number formatting (₹ 12,34,567), and dates shown as DD-MM-YYYY.
- The phone version uses large touch targets, one task per screen, and a bottom navigation bar.

## Implementation phases
**Phase 1: MVP (built now)**
Everything listed under "Core features and experience" above. It ships with two demo companies, demo users for each role, and a seeded 33/11kV substation project so every flow can be tried right away.

**Phase 2: Automation and intelligence**
- Offline mode for the phone app, with an outbox that syncs automatically.
- AI Co-Pilot: plain-language questions over company data, respecting each user's permissions, plus drafted actions that you confirm.
- Super Admin 24-hour cascading rollback, which reverses a record and everything that followed from it (stock, budget, statuses, Tally).
- Real Tally Prime two-way bridge: a local sync script, the TDL package, and ledger read-back for reconciliation.
- Connected mailboxes (Google Workspace, Microsoft 365, IMAP), with inbound reply matching to vendor timelines and true triage of received mail.
- PDF Template Studio for client-specific formats.
- Hindi email templates.
- A full alert rules builder with digests, quiet hours, and escalation chains.
- Scheduled DPR, weekly, and monthly email reports.
- Bank statement import and Form 26AS reconciliation.
- EPF ECR, ESIC, and PT return files.
- A scheduled corrigendum checker for tender URLs.

**Phase 3: External services and go-live**
- GSP e-invoice (IRN), e-way bill, and delivery challan, using your GSP account.
- WhatsApp and SMS sending for RFQs, alerts, and approvals.
- Native Android and iOS apps.
- Migration of existing data.
- Deployment on Yotta or E2E under your own cloud account.
- UAT and training.

## Assumptions
- **Phase 1 is very large.** It covers all 15 modules, as you asked. Some screens in secondary areas (for example the disputes or permit registers) will be straightforward registers, not deep workflows.
- **Login**: email and password with session timeout and login history. Optional OTP is left out of Phase 1.
- **AI reading**: tender and quote documents are read by Google Gemini using the Emergent universal key, so no key is needed from you. Usage is drawn from your Emergent balance.
- **Email from Phase 1**:
  - Emails go out through Emergent's managed email service. The sender display name is the company's name, and replies go to a company inbox you set in company settings.
  - **The email service cannot attach files.** So the RFQ email contains the full item table plus a secure link to download the RFQ PDF, in addition to the price-entry link.
  - Incoming vendor replies are not read automatically until Phase 2 (mailbox connection). Until then, the buyer enters an emailed quote, or uploads it for the AI reader.
- **Tally in Phase 1**: Phase 1 covers mappings, the voucher queue, and entry locking inside the app. The local connector that talks to Tally Prime comes in Phase 2.
- **GSP and WhatsApp**: GSP e-invoice and WhatsApp messaging need your own provider accounts, so they come in Phase 3. The "copy link" option covers WhatsApp sharing until then.
- **Statutory rules**:
  - Default GST rates and state minimum-wage tables are pre-filled and editable.
  - Payroll calculates EPF/ESIC/PT figures, but the filing files come in Phase 2.
- **Demo data**:
  - Seed logins follow your spec: admin@jkeepl.in, pm@, site@, accounts@, hr@, and client@demo.in.
  - The two demo companies are JK Electric Engineers (Ocean Instinct) and JK Infra & Civil (Higher Perspective).
  - All seeded records are clearly marked demo and can be deleted.
- **Files**: files are stored inside the app, in a separate vault folder for each company. Moving to Yotta/E2E storage is part of the Phase 3 deployment.
- **Language and money**: the interface is in English, and all amounts are in INR.
- **Hardware is out of scope**, as your spec states: biometric devices, DSC, Aadhaar eSign, and hardware tokens.
