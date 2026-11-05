#!/usr/bin/env python3
"""
JKEE EPC ERP Backend API Test Suite
Tests critical flows: auth, multi-company, tenders, projects, procurement, HR, approvals
"""
import requests
import sys
from datetime import datetime

BASE_URL = "https://new-app-demo-20--5e71avcd.preview.emergentagent.com/api"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'

class APITester:
    def __init__(self):
        self.token = None
        self.user = None
        self.tests_run = 0
        self.tests_passed = 0
        self.tests_failed = 0
        self.failures = []
        self.cid = None  # Current company ID
        self.cid_jkee = None
        self.cid_jkic = None

    def log(self, msg, color=Colors.BLUE):
        print(f"{color}{msg}{Colors.END}")

    def test(self, name, method, endpoint, expected_status, data=None, headers=None, check_fn=None):
        """Run a single API test"""
        url = f"{BASE_URL}/{endpoint}"
        hdrs = {'Content-Type': 'application/json'}
        if self.token:
            hdrs['Authorization'] = f'Bearer {self.token}'
        if headers:
            hdrs.update(headers)

        self.tests_run += 1
        self.log(f"\n🔍 Test {self.tests_run}: {name}", Colors.BLUE)
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=hdrs, timeout=30)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=hdrs, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=hdrs, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=hdrs, timeout=30)

            success = response.status_code == expected_status
            
            if success and check_fn:
                try:
                    result = response.json() if response.text else {}
                    check_result = check_fn(result)
                    if not check_result:
                        success = False
                        self.log(f"   ❌ Check function failed", Colors.RED)
                except Exception as e:
                    success = False
                    self.log(f"   ❌ Check function error: {e}", Colors.RED)

            if success:
                self.tests_passed += 1
                self.log(f"   ✅ PASS - Status: {response.status_code}", Colors.GREEN)
                return True, response.json() if response.text else {}
            else:
                self.tests_failed += 1
                error_msg = f"{name} - Expected {expected_status}, got {response.status_code}"
                try:
                    error_detail = response.json()
                    error_msg += f" - {error_detail.get('detail', '')}"
                except:
                    error_msg += f" - {response.text[:200]}"
                self.failures.append(error_msg)
                self.log(f"   ❌ FAIL - {error_msg}", Colors.RED)
                return False, {}

        except Exception as e:
            self.tests_failed += 1
            error_msg = f"{name} - Error: {str(e)}"
            self.failures.append(error_msg)
            self.log(f"   ❌ FAIL - {error_msg}", Colors.RED)
            return False, {}

    def run_tests(self):
        self.log("\n" + "="*80, Colors.YELLOW)
        self.log("JKEE EPC ERP - Backend API Test Suite", Colors.YELLOW)
        self.log("="*80 + "\n", Colors.YELLOW)

        # ========== AUTH TESTS ==========
        self.log("\n📋 SECTION 1: Authentication & Authorization", Colors.YELLOW)
        
        # Test 1: Invalid login
        self.test("Invalid login should fail", "POST", "auth/login", 401,
                  data={"email": "wrong@test.com", "password": "wrong"})
        
        # Test 2: Locked user (Farooq - onboarding locked)
        success, resp = self.test("Onboarding-locked user should be refused", "POST", "auth/login", 403,
                                   data={"email": "farooq@jkeepl.in", "password": "Demo@2026#"},
                                   check_fn=lambda r: "onboarding" in r.get("detail", "").lower())
        
        # Test 3: Admin login
        success, resp = self.test("Admin login", "POST", "auth/login", 200,
                                   data={"email": "admin@jkeepl.in", "password": "Admin@2026#"},
                                   check_fn=lambda r: "token" in r and "user" in r)
        if success:
            self.token = resp["token"]
            self.user = resp["user"]
            self.log(f"   → Logged in as: {self.user.get('name')}", Colors.GREEN)
        
        # Test 4: Get current user
        self.test("Get current user", "GET", "auth/me", 200,
                  check_fn=lambda r: r.get("email") == "admin@jkeepl.in")

        # ========== COMPANY TESTS ==========
        self.log("\n📋 SECTION 2: Multi-Company & Launchpad", Colors.YELLOW)
        
        # Test 5: List companies
        success, resp = self.test("List companies", "GET", "companies", 200,
                                   check_fn=lambda r: isinstance(r, list) and len(r) >= 2)
        if success:
            for c in resp:
                if c.get("short_code") == "JKEE":
                    self.cid_jkee = c["id"]
                    self.log(f"   → JKEE company ID: {self.cid_jkee}", Colors.GREEN)
                elif c.get("short_code") == "JKIC":
                    self.cid_jkic = c["id"]
                    self.log(f"   → JKIC company ID: {self.cid_jkic}", Colors.GREEN)
            self.cid = self.cid_jkee  # Default to JKEE
        
        # Test 6: Get JKEE company details
        if self.cid_jkee:
            self.test("Get JKEE company", "GET", f"companies/{self.cid_jkee}", 200,
                      check_fn=lambda r: r.get("short_code") == "JKEE" and "theme" in r)
        
        # Test 7: Get JKIC company details (check theme)
        if self.cid_jkic:
            self.test("Get JKIC company (check theme)", "GET", f"companies/{self.cid_jkic}", 200,
                      check_fn=lambda r: r.get("short_code") == "JKIC" and "#0B3048" in str(r.get("theme", {})))

        # ========== DASHBOARD TESTS ==========
        self.log("\n📋 SECTION 3: Dashboard & KPIs", Colors.YELLOW)
        
        # Test 8: Dashboard KPIs
        if self.cid:
            self.test("Dashboard KPIs", "GET", f"c/{self.cid}/dashboard", 200,
                      check_fn=lambda r: "projects_active" in r and "pending_approvals" in r)

        # ========== TENDER TESTS (M1) ==========
        self.log("\n📋 SECTION 4: Tenders (M1)", Colors.YELLOW)
        
        # Test 9: List tenders
        tender_id = None
        if self.cid:
            success, resp = self.test("List tenders", "GET", f"c/{self.cid}/r/tenders", 200,
                                       check_fn=lambda r: isinstance(r, list))
            if success and len(resp) > 0:
                tender_id = resp[0]["id"]
                self.log(f"   → Found tender: {resp[0].get('tender_no')}", Colors.GREEN)
        
        # Test 10: Get tender detail
        if tender_id:
            self.test("Get tender detail", "GET", f"c/{self.cid}/r/tenders/{tender_id}", 200,
                      check_fn=lambda r: r.get("id") == tender_id)
        
        # Test 11: Feasibility check
        if tender_id:
            self.test("Tender feasibility check", "GET", f"c/{self.cid}/tenders/{tender_id}/feasibility", 200,
                      check_fn=lambda r: "checks" in r and "score" in r)

        # ========== APPROVAL TESTS ==========
        self.log("\n📋 SECTION 5: Approvals Workflow", Colors.YELLOW)
        
        # Test 12: List approvals
        if self.cid:
            success, resp = self.test("List approvals", "GET", f"c/{self.cid}/approvals", 200,
                                       check_fn=lambda r: isinstance(r, list))
            if success:
                pending = [a for a in resp if a.get("status") == "Pending"]
                self.log(f"   → Found {len(pending)} pending approvals", Colors.GREEN)

        # ========== PROJECT TESTS (M2) ==========
        self.log("\n📋 SECTION 6: Projects (M2)", Colors.YELLOW)
        
        # Test 13: List projects
        project_id = None
        if self.cid:
            success, resp = self.test("List projects", "GET", f"c/{self.cid}/r/projects", 200,
                                       check_fn=lambda r: isinstance(r, list))
            if success and len(resp) > 0:
                project_id = resp[0]["id"]
                self.log(f"   → Found project: {resp[0].get('code')}", Colors.GREEN)
        
        # Test 14: Project overview
        if project_id:
            self.test("Project overview", "GET", f"c/{self.cid}/projects/{project_id}/overview", 200,
                      check_fn=lambda r: "project" in r and "s_curve" in r and "sites" in r)
        
        # Test 15: List WBS
        if self.cid and project_id:
            self.test("List WBS items", "GET", f"c/{self.cid}/r/wbs?project_id={project_id}", 200,
                      check_fn=lambda r: isinstance(r, list))

        # ========== HR TESTS (M3) ==========
        self.log("\n📋 SECTION 7: HR & Payroll (M3)", Colors.YELLOW)
        
        # Test 16: List employees
        employee_id = None
        if self.cid:
            success, resp = self.test("List employees", "GET", f"c/{self.cid}/r/employees", 200,
                                       check_fn=lambda r: isinstance(r, list))
            if success and len(resp) > 0:
                # Find Farooq
                for emp in resp:
                    if "farooq" in emp.get("name", "").lower():
                        employee_id = emp["id"]
                        self.log(f"   → Found employee Farooq: {employee_id}", Colors.GREEN)
                        break
        
        # Test 17: Verify employee docs (unlock Farooq)
        if employee_id:
            self.test("Verify employee onboarding docs", "POST", 
                      f"c/{self.cid}/employees/{employee_id}/verify-docs", 200,
                      data={"verified": ["Aadhaar", "PAN", "Bank details"]},
                      check_fn=lambda r: r.get("docs_verified") == True)
        
        # Test 18: List payroll runs
        if self.cid:
            self.test("List payroll runs", "GET", f"c/{self.cid}/r/payroll_runs", 200,
                      check_fn=lambda r: isinstance(r, list))

        # ========== PROCUREMENT TESTS (M4) ==========
        self.log("\n📋 SECTION 8: Procurement (M4)", Colors.YELLOW)
        
        # Test 19: List vendors
        if self.cid:
            self.test("List vendors", "GET", f"c/{self.cid}/r/vendors", 200,
                      check_fn=lambda r: isinstance(r, list))
        
        # Test 20: List products
        if self.cid:
            self.test("List products", "GET", f"c/{self.cid}/r/products", 200,
                      check_fn=lambda r: isinstance(r, list))
        
        # Test 21: List RFQs
        rfq_id = None
        if self.cid:
            success, resp = self.test("List RFQs", "GET", f"c/{self.cid}/r/rfqs", 200,
                                       check_fn=lambda r: isinstance(r, list))
            if success and len(resp) > 0:
                rfq_id = resp[0]["id"]
                self.log(f"   → Found RFQ: {resp[0].get('number')}", Colors.GREEN)
        
        # Test 22: RFQ compare matrix
        if rfq_id:
            self.test("RFQ compare matrix", "GET", f"c/{self.cid}/rfqs/{rfq_id}/compare", 200,
                      check_fn=lambda r: "matrix" in r and "vendors" in r)
        
        # Test 23: List POs
        po_id = None
        if self.cid:
            success, resp = self.test("List purchase orders", "GET", f"c/{self.cid}/r/pos", 200,
                                       check_fn=lambda r: isinstance(r, list))
            if success and len(resp) > 0:
                po_id = resp[0]["id"]
                self.log(f"   → Found PO: {resp[0].get('number')}", Colors.GREEN)
        
        # Test 24: Vendor staging submissions
        if self.cid:
            self.test("Vendor staging submissions", "GET", f"c/{self.cid}/staging", 200,
                      check_fn=lambda r: isinstance(r, list))

        # ========== STOCK TESTS (M5) ==========
        self.log("\n📋 SECTION 9: Stock & Inventory (M5)", Colors.YELLOW)
        
        # Test 25: Stock balance
        if self.cid:
            self.test("Stock balance", "GET", f"c/{self.cid}/stock/balance", 200,
                      check_fn=lambda r: isinstance(r, list))
        
        # Test 26: Stock ledger
        if self.cid:
            self.test("Stock ledger", "GET", f"c/{self.cid}/r/stock_ledger", 200,
                      check_fn=lambda r: isinstance(r, list))

        # ========== SITE PROGRESS TESTS (M6) ==========
        self.log("\n📋 SECTION 10: Site Progress (M6)", Colors.YELLOW)
        
        # Test 27: List DPRs
        dpr_id = None
        if self.cid and project_id:
            success, resp = self.test("List DPRs", "GET", f"c/{self.cid}/r/dprs?project_id={project_id}", 200,
                                       check_fn=lambda r: isinstance(r, list))
            if success and len(resp) > 0:
                dpr_id = resp[0]["id"]
                self.log(f"   → Found DPR: {resp[0].get('number')}", Colors.GREEN)

        # ========== BILLING TESTS (M8) ==========
        self.log("\n📋 SECTION 11: Billing & Accounts (M8)", Colors.YELLOW)
        
        # Test 28: List RA bills
        ra_bill_id = None
        if self.cid and project_id:
            success, resp = self.test("List RA bills", "GET", f"c/{self.cid}/r/ra_bills?project_id={project_id}", 200,
                                       check_fn=lambda r: isinstance(r, list))
            if success and len(resp) > 0:
                ra_bill_id = resp[0]["id"]
                self.log(f"   → Found RA bill: {resp[0].get('number')}", Colors.GREEN)
        
        # Test 29: Unbilled work report
        if self.cid and project_id:
            self.test("Unbilled work report", "GET", f"c/{self.cid}/reports/unbilled?project_id={project_id}", 200,
                      check_fn=lambda r: isinstance(r, list))

        # ========== CLOSURE TESTS (M11) ==========
        self.log("\n📋 SECTION 12: Project Closure (M11)", Colors.YELLOW)
        
        # Test 30: Closure gate checks
        if self.cid and project_id:
            self.test("Closure gate checks", "GET", f"c/{self.cid}/projects/{project_id}/closure", 200,
                      check_fn=lambda r: "checks" in r and len(r["checks"]) == 11)

        # ========== TALLY TESTS (M12) ==========
        self.log("\n📋 SECTION 13: Tally Integration (M12)", Colors.YELLOW)
        
        # Test 31: Voucher queue
        if self.cid:
            self.test("Voucher queue", "GET", f"c/{self.cid}/r/vouchers", 200,
                      check_fn=lambda r: isinstance(r, list))
        
        # Test 32: Tally mappings
        if self.cid:
            self.test("Tally mappings", "GET", f"c/{self.cid}/r/tally_mappings", 200,
                      check_fn=lambda r: isinstance(r, list))

        # ========== ALERTS & CALENDAR TESTS (M15) ==========
        self.log("\n📋 SECTION 14: Alerts & Calendar (M15)", Colors.YELLOW)
        
        # Test 33: Alerts
        if self.cid:
            self.test("Alerts", "GET", f"c/{self.cid}/alerts", 200,
                      check_fn=lambda r: isinstance(r, list))
        
        # Test 34: Calendar
        if self.cid:
            self.test("Calendar events", "GET", f"c/{self.cid}/calendar", 200,
                      check_fn=lambda r: isinstance(r, list))
        
        # Test 35: Email log
        if self.cid:
            self.test("Email log", "GET", f"c/{self.cid}/emails", 200,
                      check_fn=lambda r: isinstance(r, list))

        # ========== AUDIT TESTS ==========
        self.log("\n📋 SECTION 15: Audit & Governance", Colors.YELLOW)
        
        # Test 36: Audit log
        if self.cid:
            self.test("Audit log", "GET", f"c/{self.cid}/audit", 200,
                      check_fn=lambda r: isinstance(r, list))
        
        # Test 37: Audit chain verification
        self.test("Audit chain verification", "GET", "audit/verify", 200,
                  check_fn=lambda r: "intact" in r or "verified" in str(r).lower())

        # ========== ADMIN TESTS ==========
        self.log("\n📋 SECTION 16: Admin & Permissions", Colors.YELLOW)
        
        # Test 38: List roles
        self.test("List roles", "GET", "admin/roles", 200,
                  check_fn=lambda r: isinstance(r, list) and len(r) > 0)
        
        # Test 39: List users
        self.test("List users", "GET", "admin/users", 200,
                  check_fn=lambda r: isinstance(r, list) and len(r) > 0)

        # ========== CROSS-COMPANY TESTS ==========
        self.log("\n📋 SECTION 17: Cross-Company Import", Colors.YELLOW)
        
        # Test 40: Cross-company import preview
        if self.cid_jkee and self.cid_jkic:
            self.test("Cross-company import preview", "POST", "import/cross/preview", 200,
                      data={"source_cid": self.cid_jkee, "target_cid": self.cid_jkic, "register": "vendors"},
                      check_fn=lambda r: "rows" in r and "match_key" in r)

        # ========== FINAL SUMMARY ==========
        self.print_summary()

    def print_summary(self):
        self.log("\n" + "="*80, Colors.YELLOW)
        self.log("TEST SUMMARY", Colors.YELLOW)
        self.log("="*80, Colors.YELLOW)
        self.log(f"\nTotal Tests: {self.tests_run}", Colors.BLUE)
        self.log(f"Passed: {self.tests_passed}", Colors.GREEN)
        self.log(f"Failed: {self.tests_failed}", Colors.RED)
        
        if self.tests_failed > 0:
            self.log(f"\n❌ FAILURES ({len(self.failures)}):", Colors.RED)
            for i, failure in enumerate(self.failures, 1):
                self.log(f"  {i}. {failure}", Colors.RED)
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        self.log(f"\nSuccess Rate: {success_rate:.1f}%", Colors.GREEN if success_rate >= 80 else Colors.RED)
        self.log("="*80 + "\n", Colors.YELLOW)

def main():
    tester = APITester()
    try:
        tester.run_tests()
        return 0 if tester.tests_failed == 0 else 1
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        return 1
    except Exception as e:
        print(f"\n\nFatal error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
