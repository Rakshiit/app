// Field DSL: "*key:Label:type:extra"  (* = table column). types: t n m d s(select a|b) r(ref register) ta b f(file) pct
const ST = (o) => `status:Status:s:${o}`;
const PRJ = "*project_id:Project:r:projects";
const SITE = "site_id:Site:r:sites";
const ITEMS = (cols) => ({ k: "items", l: "Items", t: "items", cols });
const PITEMS = ITEMS("product_id:Product:r:products,desc:Description,uom:UOM,qty:Qty:n,rate:Rate:m,gst_pct:GST %:n");

export const REG = {
  // M1
  tenders: { title: "Tenders", fields: ["*tender_no:Tender ID", "*title:Name of work", "*department:Department", "*state:State", "category:Category:s:EPC|O&M Manpower|AMC|Civil|Supply", "*estimated_value:Est. value:m", "emd:EMD:m", "tender_fee:Tender fee:m", "*bid_due_date:Bid due:d", "prebid_date:Pre-bid:d", "opening_date:Opening:d", "location:Location", "min_turnover:Min turnover req.:m", "eligibility:Eligibility:ta", "required_documents:Required documents (; separated):ta", "tender_portal_url:Portal URL", "*stage:Stage:s:Identified|Go/No-Go Pending|Go|No-Go|Bid Preparation|Costing Approved|Submitted|Won|Lost"] },
  maf: { title: "OEM Authorisation (MAF)", fields: ["*tender_id:Tender:r:tenders", "*oem:OEM", "*product:Product", "*requested_on:Requested:d", "*received_on:Received:d", ST("Requested|Received|Rejected")] },
  corrigenda: { title: "Corrigendum log", fields: ["*tender_id:Tender:r:tenders", "*corrigendum_no:Corrigendum no", "*date:Date:d", "*new_bid_due_date:New bid due:d", "*summary_of_changes:Changes:ta", "file_id:File:f"] },
  costings: { title: "Costing versions", approve: true, pdf: true, fields: ["*tender_id:Tender:r:tenders", "*version:Version:n", "*cost_type:Type:s:EPC|O&M Manpower|AMC", "margin_pct:Default margin %:n", "*total_cost:Total cost:m", "*bid_value:Bid value:m", "*margin_pct_effective:Margin %:n"] },
  // M2
  projects: { title: "Projects", fields: ["*code:Project code", "*name:Name", "*client:Client", "*state:State", "loa_no:LOA / WO no", "loa_date:LOA date:d", "*contract_value:Contract value:m", "start_date:Start:d", "*end_date:End:d", "retention_pct:Retention %:n", "*physical_pct:Progress %:n", ST("Active|On Hold|Closed"), "completion_certificate:Completion certificate:f"] },
  sites: { title: "Sites", fields: [PRJ, "*name:Site name", "*state:State", "*location:Location / GPS", "*site_incharge:Site in-charge", "store_name:Site store"] },
  wbs: { title: "WBS", fields: [PRJ, "parent_id:Parent:r:wbs", "*level:Level:n", "*code:Code", "*name:Name", "*uom:UOM", "*qty:Qty:n", "*rate:Rate:m", "weight:Weight (blank=value)", "start_date:Start:d", "end_date:End:d", "*done_qty:Done qty:n", "billed_qty:Billed qty:n"] },
  change_orders: { title: "Change orders", approve: true, pdf: true, fields: [PRJ, "*number:CO no", "*title:Title", "*value_change:Value change:m", "*time_extension_days:Time ext. (days):n", "budget_change:Budget change:m", "budget_head:Budget head:s:Labour|Material|Subcontractor|Equipment|Overheads", "date:Date:d", "reason:Reason:ta", "*status:Status"] },
  hindrances: { title: "Hindrance register", fields: [PRJ, "*title:Hindrance", "*from_date:From:d", "*to_date:To:d", "*impact_days:Impact days:n", "*responsibility:Responsibility:s:Client|Contractor|Force Majeure", ST("Open|Resolved")] },
  // M3
  employees: { title: "Employees & labour", fields: ["*number:Emp code", "*name:Name", "*emp_type:Type:s:Staff|Labour", "*designation:Designation", "email:Email", "phone:Phone", "*state:State", "skill:Skill:s:Unskilled|Semi-skilled|Skilled|Highly Skilled", "salary:Monthly salary:m", "basic:Basic:m", "daily_wage:Daily wage:m", PRJ, "doj:Joining date:d", "*onboarding_stage:Onboarding", ST("Active|Exited")] },
  attendance: { title: "Attendance", fields: ["*employee_id:Employee:r:employees", "*date:Date:d", "*status:Status:s:P|A|HD|L", PRJ, SITE, "*mode:Mode:s:Self (GPS)|Supervisor|Regularisation", "gps:GPS", "photo_id:Photo:f", "remarks:Remarks"] },
  payroll_runs: { title: "Payroll runs", approve: true, fields: ["*number:Run no", "*month:Month", "*employees:Employees:n", "*total_gross:Gross:m", "*total_net:Net:m", "*status:Status"] },
  payslips: { title: "Payslips", pdf: true, readonly: true, fields: ["*month:Month", "*employee_name:Employee", "*present_days:Days:n", "*gross:Gross:m", "epf:EPF:m", "esic:ESIC:m", "pt:PT:m", "*net_pay:Net pay:m", "*min_wage_ok:Min wage OK:b", "*status:Status"] },
  claims: { title: "Expense claims", approve: true, fields: ["*number:Claim no", "*employee_id:Employee:r:employees", PRJ, "*date:Date:d", "*category:Category:s:Travel|Food|Lodging|Site expense|Other", "*amount:Amount:m", "description:Description:ta", "bill_file:Bill:f", "*status:Status"] },
  advances: { title: "Salary advances", approve: true, fields: ["*number:No", "*employee_id:Employee:r:employees", "*amount:Amount:m", "*date:Date:d", "monthly_recovery:Monthly recovery:m", "*status:Status"] },
  petty_cash: { title: "Petty cash", fields: [PRJ, "*date:Date:d", "*head:Head", "*amount:Amount:m", "*paid_to:Paid to", "remarks:Remarks"] },
  hr_letters: { title: "HR letters", pdf: true, fields: ["*number:Letter no", "*employee_name:Employee", "*letter_type:Type:s:Offer|Appointment|Increment|Experience|Relieving|Warning", "*subject:Subject", "body:Body:ta", "*date:Date:d"] },
  trainings: { title: "Training & licences", fields: ["*employee_id:Employee:r:employees", "*title:Training / licence", "issue_date:Issued:d", "*expiry_date:Expiry:d", "certificate:Certificate:f"] },
  min_wages: { title: "Minimum wages", fields: ["*state:State", "*skill:Skill:s:Unskilled|Semi-skilled|Skilled|Highly Skilled", "*daily_rate:Daily rate:m", "*effective_from:Effective from:d"] },
  // M4
  products: { title: "Product master", fields: ["*code:Code", "*name:Name", "*uom:UOM", "*category:Category", "hsn:HSN", "*std_rate:Std rate:m", "gst_pct:GST %:n", "*reorder_level:Reorder level:n", "reorder_qty:Reorder qty:n", "last_po_rate:Last PO rate:m"] },
  vendors: { title: "Vendor master", fields: ["*number:Code", "*name:Name", "*gstin:GSTIN", "pan:PAN", "*category:Category", "*state:State", "*email:Email", "phone:Phone", "contact_person:Contact", "bank_account:Bank a/c", "ifsc:IFSC", "msme:MSME:s:Yes|No", "rating:Rating:n", ST("Active|Blacklisted")] },
  requisitions: { title: "Material requisitions", approve: true, fields: ["*number:MR no", PRJ, SITE, "*title:Title", "*date:Date:d", "required_by:Required by:d", ITEMS("product_id:Product:r:products,desc:Description,uom:UOM,qty:Qty:n"), "*status:Status"] },
  rfqs: { title: "RFQs", pdf: true, fields: ["*number:RFQ no", "*title:Title", PRJ, "tender_id:Tender:r:tenders", SITE, "*due_date:Quote due:d", "delivery_location:Delivery location", "terms:Terms:ta", ITEMS("product_id:Product:r:products,desc:Description,uom:UOM,qty:Qty:n"), "*status:Status"] },
  quotes: { title: "Vendor quotes", fields: ["*rfq_id:RFQ:r:rfqs", "*vendor_id:Vendor:r:vendors", "*revision:Rev (V):n", "freight:Freight:m", "payment_terms:Payment terms", "delivery_period:Delivery", PITEMS, "*landed_total:Landed total:m", ST("Confirmed|Staged|Rejected")] },
  pos: { title: "Purchase orders", approve: true, pdf: true, fields: ["*number:PO no", "*vendor_id:Vendor:r:vendors", PRJ, SITE, "*date:Date:d", "delivery_date:Delivery by:d", "payment_terms:Payment terms", "freight:Freight:m", PITEMS, "*total:Total:m", "*ack_status:Ack", "*delivery_status:Delivery", "*status:Status"] },
  grns: { title: "GRN", pdf: true, fields: ["*number:GRN no", "po_id:PO:r:pos", "*vendor_id:Vendor:r:vendors", PRJ, "site_id:Direct to site (blank = central store):r:sites", "*date:Date:d", "invoice_no:Vendor invoice", ITEMS("product_id:Product:r:products,desc:Description,qty_received:Qty received:n,rate:Rate:m")] },
  vendor_advances: { title: "Vendor advances", approve: true, fields: ["*number:No", "*vendor_id:Vendor:r:vendors", "po_id:PO:r:pos", "*amount:Amount:m", "*date:Date:d", "*status:Status"] },
  // M5
  stock_ledger: { title: "Stock ledger", readonly: true, fields: ["*date:Date:d", "*product_name:Product", "*location_name:Location", "*qty_in:In:n", "*qty_out:Out:n", "*rate:Rate:m", "*ref:Ref"] },
  stock_transfers: { title: "Stock transfers", approve: true, fields: ["*number:No", PRJ, "*from_location:From (CENTRAL or site):loc", "*to_location:To:loc", "*date:Date:d", ITEMS("product_id:Product:r:products,desc:Description,qty:Qty:n"), "*status:Status"] },
  free_issue: { title: "Client free-issue material", fields: [PRJ, "*material:Material", "*uom:UOM", "*qty_received:Received:n", "*qty_consumed:Consumed:n", "*qty_returned:Returned:n", "remarks:Remarks"] },
  equipment: { title: "Equipment master", fields: ["*asset_code:Asset code", "*name:Name", "*type:Type", "*hourly_cost:Hourly cost:m", PRJ, "*next_maintenance:Next maintenance:d", ST("Idle|Deployed|Under Maintenance|Released")] },
  equipment_usage: { title: "Equipment usage", fields: ["*equipment_id:Equipment:r:equipment", PRJ, "*date:Date:d", "*hours:Hours:n", "*cost:Cost:m"] },
  vehicles: { title: "Vehicle master", fields: ["*reg_no:Reg no", "*type:Type", PRJ, "*insurance_expiry:Insurance:d", "*fitness_expiry:Fitness:d", "*puc_expiry:PUC:d", "next_service:Next service:d", ST("Idle|Deployed|Released")] },
  trips: { title: "Trips & fuel", fields: ["*vehicle_id:Vehicle:r:vehicles", PRJ, "*date:Date:d", "*from_place:From", "*to_place:To", "*km:KM:n", "fuel_ltr:Fuel (L):n", "fuel_cost:Fuel cost:m", "toll_other:Toll/other:m", "*cost:Cost:m"] },
  insurance: { title: "Insurance register", fields: ["*policy_no:Policy no", "*insurance_type:Type:s:CAR|Workmen Compensation|Vehicle|Fire|Marine", "*insurer:Insurer", PRJ, "sum_insured:Sum insured:m", "*premium:Premium:m", "start_date:Start:d", "*expiry_date:Expiry:d", ST("Active|Closed|Transferred")] },
  // M6
  dprs: { title: "Daily progress reports", approve: true, pdf: true, fields: ["*number:DPR no", PRJ, "*site_id:Site:r:sites", "*date:Date:d", "weather:Weather", "*manpower:Manpower:n", ITEMS("wbs_id:WBS item:r:wbs,qty:Qty done:n"), { k: "materials", l: "Materials consumed", t: "items", cols: "product_id:Product:r:products,desc:Description,qty:Qty:n" }, "photos:Site photos:files", "remarks:Remarks:ta", "*status:Status"] },
  drawings: { title: "Drawing register", fields: [PRJ, "*drawing_no:Drawing no", "*title:Title", "*revision:Revision", "*date:Date:d", "file_id:File:f", "*status:Status:s:Submitted|Approved for Construction|Superseded|Rejected"] },
  rfis: { title: "RFI log", fields: [PRJ, "*number:RFI no", "*title:Query", "*raised_to:Raised to", "*date:Date:d", "*due_date:Due:d", "response:Response:ta", ST("Open|Answered|Closed")] },
  // M7
  subcontractors: { title: "Subcontractors", fields: ["*name:Name", "*gstin:GSTIN", "*trade:Trade", "email:Email", "*phone:Phone", "state:State", "*performance_score:Score:n"] },
  work_orders: { title: "Work orders", approve: true, pdf: true, fields: ["*number:WO no", "*subcontractor_id:Subcontractor:r:subcontractors", PRJ, "*date:Date:d", "retention_pct:Retention %:n", "advance:Advance:m", ITEMS("desc:Description,uom:UOM,qty:Qty:n,rate:Rate:m,done_qty:Done:n"), "*total:Total:m", "*rating:Rating (1-5):n", "final_bill_done:Final bill done:b", "*status:Status"] },
  sub_dprs: { title: "Subcontractor DPRs", approve: true, fields: ["*work_order_id:Work order:r:work_orders", PRJ, "*date:Date:d", ITEMS("desc:Description,qty:Qty:n"), "remarks:Remarks", "*status:Status"] },
  sub_bills: { title: "Subcontractor bills", approve: true, pdf: true, fields: ["*number:Bill no", "*subcontractor_id:Subcontractor:r:subcontractors", "work_order_id:WO:r:work_orders", PRJ, "*date:Date:d", "retention_pct:Retention %:n", "advance_recovery:Advance recovery:m", "other_deductions:Other deductions:m", ITEMS("desc:Description,qty:Qty:n,rate:Rate:m"), "*gross:Gross:m", "*net_amount:Net:m", "*status:Status"] },
  sub_payments: { title: "Subcontractor payments", fields: ["*sub_bill_id:Bill:r:sub_bills", "*subcontractor_name:Subcontractor", PRJ, "*date:Date:d", "*amount:Amount:m", "*ref_no:UTR / Cheque"] },
  // M8
  ra_bills: { title: "RA bills", approve: true, pdf: true, fields: ["*number:RA no", PRJ, "*bill_date:Bill date:d", "escalation_pct:Escalation %:n", "gst_pct:GST %:n", "retention_pct:Retention %:n", "mob_recovery_pct:Mob. recovery %:n", "tds_pct:TDS %:n", "gst_tds_pct:GST TDS %:n", "labour_cess_pct:Labour cess %:n", "ld_amount:LD:m", "other_deductions:Other deductions:m", { k: "lines", l: "Bill lines", t: "items", cols: "wbs_id:WBS item:r:wbs,current_qty:Current qty:n" }, "*gross:Gross:m", "*invoice_total:Invoice total:m", "*net_payable:Net payable:m", "*status:Status"] },
  invoices: { title: "Tax invoices", pdf: true, fields: ["*number:Invoice no", PRJ, "*date:Date:d", "*client:Client", "client_gstin:Client GSTIN", "*taxable:Taxable:m", "gst_amount:GST:m", "*total:Total:m", "*net_receivable:Net receivable:m", "*received:Received:m", "*submission_status:Submission:s:Not Submitted|Submitted|Under Verification|Certified|Paid", "submitted_on:Submitted on:d"] },
  receipts: { title: "Client receipts", fields: ["*number:Receipt no", PRJ, "*invoice_id:Invoice:r:invoices", "ra_bill_id:RA bill:r:ra_bills", "*date:Date:d", "*amount:Amount:m", "*mode:Mode:s:NEFT|RTGS|Cheque", "utr:UTR"] },
  deductions: { title: "Deduction register", fields: [PRJ, "*ra_no:RA bill", "*type:Type:s:TDS|GST TDS|Labour Cess|Security Deposit / Retention|LD|Other", "*amount:Amount:m", "*date:Date:d", ST("Deducted|Released|Claimed")] },
  credit_notes: { title: "Credit / debit notes", fields: ["*number:No", "*note_type:Type:s:Credit Note|Debit Note", PRJ, "*party:Party", "*amount:Amount:m", "*date:Date:d", "*reason:Reason (reversal of)"] },
  // M9
  bgs: { title: "Bank guarantees", fields: ["*bg_no:BG no", "*bg_type:Type:s:EMD|Mobilisation|Performance|Retention|Advance", PRJ, "tender_id:Tender:r:tenders", "*bank:Bank", "*amount:Amount:m", "issue_date:Issue:d", "*expiry_date:Expiry:d", "claim_date:Claim period:d", "beneficiary:Beneficiary", ST("Active|Renewed|Refund Due|Converted to PBG|Released")] },
  mob_advances: { title: "Mobilisation advance", fields: [PRJ, "*amount:Advance:m", "*recovered:Recovered:m", "*recovery_pct:Recovery % per bill:n", "*date:Date:d", ST("Outstanding|Recovered")] },
  // M10
  checklists: { title: "Checklist templates", fields: ["*name:Name", "*category:Category:s:Safety|Quality|Statutory", "items:Checkpoints (one per line):lines"] },
  checklist_runs: { title: "Checklist submissions", fields: ["*checklist_id:Checklist:r:checklists", PRJ, SITE, "*date:Date:d", "*score:Score %:n", "*by:Filled by"] },
  incidents: { title: "Incidents", fields: ["*number:No", PRJ, "*title:Incident", "*date:Date:d", "*severity:Severity:s:Near miss|Minor|Major|Fatal", "injured:Injured", "action_taken:Action:ta", "*claim_status:Insurance claim", ST("Open|Investigating|Closed")] },
  ncrs: { title: "NCRs", fields: ["*number:NCR no", PRJ, "*title:Non-conformance", "*category:Category:s:Quality|Safety", "severity:Severity:s:Minor|Major|Critical", "subcontractor_id:Subcontractor:r:subcontractors", "wbs_id:Milestone (WBS):r:wbs", "*date:Raised:d", "*due_date:Due:d", "root_cause:Root cause / CAPA:ta", ST("Open|Under CAPA|Closed")] },
  contracts: { title: "Contract repository", fields: [PRJ, "*title:Contract", "*party:Party", "*value:Value:m", "start_date:Start:d", "*end_date:End:d", "file_id:Document:f", ST("Active|Expired|Closed")] },
  compliances: { title: "Statutory compliance", fields: ["*title:Compliance", "*authority:Authority", "*frequency:Frequency:s:Monthly|Quarterly|Annual|One-time", "*due_date:Due date:d", ST("Pending|Filed|Closed")] },
  disputes: { title: "Disputes", fields: [PRJ, "*title:Dispute", "*party:Party", "*amount:Amount:m", "*forum:Forum:s:Negotiation|Arbitration|Court", "next_hearing:Next hearing:d", ST("Open|Settled|Closed")] },
  warranties: { title: "DLP & warranties", fields: [PRJ, "*title:Item", "*kind:Type:s:DLP|OEM Warranty", "start_date:Start:d", "*expiry_date:End:d", ST("Active|Closed")] },
  permits: { title: "Permits & NOCs", fields: [PRJ, "*title:Permit / NOC", "*authority:Authority", "applied_on:Applied:d", "*expiry_date:Valid till:d", ST("Applied|Approved|Rejected|Closed")] },
  correspondence: { title: "Correspondence", fields: ["*number:Ref no", PRJ, "*direction:Direction:s:Inward|Outward", "*subject:Subject", "*party:Party", "*date:Date:d", "*reply_due:Reply due:d", "file_id:Letter:f", ST("Open|Replied|Closed")] },
  // M12/M13/M15
  tally_mappings: { title: "Tally mappings", fields: ["*map_type:Type:s:Voucher ledger|Party ledger|Stock item|Cost centre|Tax ledger", "*erp_key:ERP key", "*tally_ledger:Tally name"] },
  vouchers: { title: "Voucher queue", readonly: true, fields: ["*date:Date:d", "*voucher_type:Type", "*ref_no:Ref", "*party:Party", "*amount:Amount:m", "*status:Status", "error:Error"] },
  tasks: { title: "Tasks", fields: ["*title:Task", PRJ, "*assignee:Assignee", "*due_date:Due:d", "*priority:Priority:s:Low|Medium|High", { k: "subtasks", l: "Sub-tasks", t: "items", cols: "title:Sub-task,done:Done:b" }, ST("Open|In Progress|Done")] },
  documents: { title: "Document management", fields: [PRJ, "*title:Title", "*category:Category:s:Certificate|Drawing|Report|Letter|Other", "*version:Version:n", "file_id:File:f", "*date:Date:d"] },
  vault_docs: { title: "Company vault", fields: ["*category:Tab:s:Registrations & Tax|Licences|Financial & Eligibility|Authorisations", "*name:Document", "doc_key:Doc key (same key = new version)", "*version:Version:n", "issue_date:Issued:d", "*expiry_date:Expiry:d", "*verified:Verified:b", "file_id:File:f", "*status:Status"] },
  communications: { title: "Communication log", fields: ["*date:Date:d", "*channel:Channel:s:Phone|WhatsApp|Email (external)|Meeting", "*party:Party", "*subject:Subject", "notes:Notes:ta", "entity:Linked to:s:projects|tenders|vendors|tasks", "entity_id:Linked record id"] },
  reminders: { title: "Reminders", fields: ["*title:Reminder", "*date:Date:d", "notes:Notes"] },
};

const parse = (f) => {
  if (typeof f === "object") return { ...f, col: false };
  const col = f.startsWith("*");
  const [k, l, t = "t", x] = (col ? f.slice(1) : f).split(":");
  return { k, l, t, x, col };
};
export const fieldsOf = (r) => (REG[r]?.fields || []).map(parse);
export const colsOf = (r) => { const f = fieldsOf(r); const c = f.filter((x) => x.col); return c.length ? c : f.slice(0, 6); };
export const itemCols = (s) => s.split(",").map((c) => { const [k, l, t = "t", x] = c.split(":"); return { k, l, t, x }; });
export const refLabel = (reg, r) => (!r ? "" : reg === "projects" ? r.code : reg === "tenders" ? r.tender_no : reg === "wbs" ? `${r.code} ${r.name}` : r.number && !r.name ? `${r.number} ${r.title || r.vendor_name || ""}` : r.name || r.title || r.reg_no || r.number || r.policy_no || r.id);

export const MODULES = [
  { key: "M1", title: "Tenders", icon: "FileSearch", path: "/tenders", tabs: ["corrigenda", "maf", "costings"] },
  { key: "M2", title: "Award & Projects", icon: "Building2", path: "/projects", tabs: ["projects", "sites", "wbs", "change_orders", "hindrances"] },
  { key: "M3", title: "HR & Payroll", icon: "Users", tabs: ["employees", "attendance", "_payroll", "payslips", "claims", "advances", "petty_cash", "hr_letters", "trainings", "min_wages"] },
  { key: "M4", title: "Procurement", icon: "ShoppingCart", tabs: ["requisitions", "rfqs", "quotes", "_staging", "pos", "grns", "vendors", "products", "vendor_advances"] },
  { key: "M5", title: "Inventory & Assets", icon: "Boxes", tabs: ["_stock", "stock_ledger", "stock_transfers", "free_issue", "equipment", "equipment_usage", "vehicles", "trips", "insurance"] },
  { key: "M6", title: "Site Progress", icon: "HardHat", tabs: ["dprs", "drawings", "rfis"] },
  { key: "M7", title: "Subcontractors", icon: "Handshake", tabs: ["subcontractors", "work_orders", "sub_dprs", "sub_bills", "sub_payments"] },
  { key: "M8", title: "Accounts", icon: "Receipt", tabs: ["ra_bills", "_unbilled", "invoices", "receipts", "deductions", "credit_notes"] },
  { key: "M9", title: "BG & Budget", icon: "Landmark", tabs: ["_budget", "bgs", "mob_advances"] },
  { key: "M10", title: "Safety, Quality & Legal", icon: "ShieldCheck", tabs: ["checklists", "checklist_runs", "incidents", "ncrs", "contracts", "compliances", "disputes", "warranties", "permits", "correspondence"] },
  { key: "M11", title: "Closure & Portal", icon: "Archive", tabs: ["_closure", "_archive", "_clientviews"] },
  { key: "M12", title: "Tally", icon: "RefreshCw", tabs: ["_vouchers", "tally_mappings"] },
  { key: "M13", title: "Governance", icon: "LayoutDashboard", tabs: ["_approvals", "tasks", "_calendar", "documents", "vault_docs", "_audit"] },
  { key: "M14", title: "Documents & PDFs", icon: "FileText", tabs: ["_pdfs"] },
  { key: "M15", title: "Alerts & Email", icon: "Bell", tabs: ["_alerts", "_emails", "communications", "reminders"] },
];
export const CUSTOM_TABS = { _payroll: "Payroll run", _staging: "Vendor submissions", _stock: "Stock balance", _unbilled: "Unbilled work", _budget: "Budget vs actual", _closure: "Closure gate", _archive: "Completed archive", _clientviews: "Client view log", _vouchers: "Voucher queue", _approvals: "Approvals inbox", _calendar: "Calendar", _audit: "Audit trail", _pdfs: "Document generator", _alerts: "Alerts", _emails: "Email log & triage" };
