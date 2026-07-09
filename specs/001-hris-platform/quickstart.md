# Quickstart Validation Guide: Veent HRIS Core Platform

**Date**: 2026-07-09
**Purpose**: Runnable scenarios to validate the system works end-to-end after implementation.

---

## Prerequisites

- SvelteKit dev server running on `http://localhost:5173` (`npm run dev`)
- PostgreSQL running and seeded with an organization record and at least one `SUPER_ADMIN` user
- Redis running on `localhost:6379` (dashboard cache)
- `.env` configured (see `.env.example`): `DATABASE_URL`, `REDIS_URL`, `LUCIA_SECRET`

---

## Scenario 1: Onboard a New Employee (P2 — HR Admin story)

**Validates**: FR-002, FR-003, FR-006, FR-007, SC-001

1. Log in as `hr_admin@veent.com`
2. Navigate to **Employees → Add Employee**
3. Fill in: First Name, Last Name, Email, Department, Job Title, Employment Type, Start Date, Basic Monthly Salary
4. Click **Create Employee**

**Expected**:
- New employee appears in employee list with auto-generated `EMP-XXXX` number
- Welcome email sent to new employee's email with temporary password
- AuditLog contains a `CREATE` entry for the new Employee record

**Timing check (SC-001)**: Complete steps 2–4 in under 5 minutes.

---

## Scenario 2: Employee Submits a Timesheet (P1 — Employee self-service)

**Validates**: FR-009, FR-010, FR-012, SC-002

1. Log in as the newly created employee
2. Navigate to **My Timesheets → New Timesheet**
3. Select current week (Monday–Friday)
4. Enter 8 hours for each weekday
5. Click **Submit for Approval**

**Expected**:
- Timesheet status changes to `SUBMITTED`
- Manager receives a notification
- Attempting to submit again for the same week returns an error (duplicate prevention)

**Timing check (SC-002)**: Complete steps 2–5 in under 2 minutes.

---

## Scenario 3: Manager Approves Timesheet (P3 — Manager approval)

**Validates**: FR-011, SC-003

1. Log in as `manager@veent.com`
2. Navigate to **Approvals → Timesheets**
3. Find the submitted timesheet from Scenario 2
4. Click **Approve**

**Expected**:
- Timesheet status changes to `APPROVED`
- Employee receives a notification
- Timesheet appears in the employee's history with `APPROVED` status

---

## Scenario 4: Employee Submits a Leave Request (P1 — Employee self-service)

**Validates**: FR-013, FR-014, FR-015, FR-016, FR-017

1. Log in as employee
2. Navigate to **Leave → Request Leave**
3. Select "Annual Leave", choose start and end dates (3 working days)
4. Submit

**Expected**:
- Request status is `PENDING`
- Manager notified
- Employee's remaining leave balance still shows pre-request amount (balance deducted only on approval)

**Edge case**: Submit another request that exceeds remaining balance → expect error with `{ remaining, requested }` values.

---

## Scenario 5: Run Payroll (P4 — HR Admin payroll)

**Validates**: FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, SC-004

1. Ensure at least one approved timesheet exists for the pay period
2. Log in as `hr_admin@veent.com`
3. Navigate to **Payroll → New Run**
4. Select period (e.g., July 1–15, 2025)
5. Click **Compute**

**Expected**:
- PayrollRun created with `status: COMPUTED`
- Each PayrollEntry shows: `basicPay`, `sssEe`, `philhealthEe`, `pagibigEe`, `withholdingTax`, `netPay`
- Employees with unapproved timesheets appear in a warning list (flagged)

6. Click **Approve** (with `overrideNote` if flagged employees exist)

**Expected**:
- PayrollRun status → `APPROVED`
- Employees can now view their payslip under **My Payslips**
- Payslip shows itemized deductions matching PH statutory rules

**Verify PH computations** for an employee with `basicMonthlySalary = 30,000`:
- SSS EE ≈ PHP 1,350 (lookup table)
- PhilHealth EE = PHP 750 (30,000 × 2.5%)
- Pag-IBIG EE = PHP 100 (capped)
- Taxable income = 30,000 − 1,350 − 750 − 100 = 27,800/month → 333,600/year → TRAIN bracket
- Withholding tax ≈ PHP 1,290/month
- Net pay ≈ PHP 26,510

**Timing check (SC-004)**: Full payroll cycle for 10 test employees in under 5 minutes.

---

## Scenario 6: Dashboard Metrics (P5 — Dashboard)

**Validates**: FR-024, FR-025, SC-005

1. Log in as `hr_admin@veent.com`
2. Open **Dashboard**

**Expected**:
- See: total headcount, employees on leave today, pending approvals count, next payroll date
- Numbers match what's in the database (verify against employee list counts)

3. Navigate to **Reports → Headcount**
4. Set date range to last 3 months, click **Generate**

**Expected**:
- Report generates in under 60 seconds
- Headcount numbers match employee list for each period
- Click **Export CSV** → file downloads with correct columns

---

## Scenario 7: Recruit and Convert a Hire (P6 — Recruitment)

**Validates**: FR-028, FR-029, FR-030

1. Log in as `hr_admin@veent.com`
2. Create a job posting: **Recruitment → New Posting** (status: OPEN)
3. Submit an application via **POST /api/v1/recruitment/postings/:id/applicants**
4. Move applicant through stages: Applied → Screening → Interview → Offer → Hired
5. Click **Convert to Employee**

**Expected**:
- New Employee record created with pre-populated data from the application
- User account created; welcome email sent
- Applicant record shows `convertedToEmployeeId`

---

## Scenario 8: Audit Log Integrity

**Validates**: FR-031, FR-032, FR-033, SC-008

1. Log in as `hr_admin@veent.com`
2. Navigate to **Reports → Audit Log**
3. Filter by `entityType: Employee`

**Expected**:
- All employee creates, updates, and offboardings from previous scenarios appear
- Each entry has: `actorId`, `timestamp`, `entityType`, `entityId`, `action`, `oldValue`, `newValue`
- Attempting to delete an audit log entry via API returns **403 Forbidden**
- Log entry for Scenario 5 payroll override includes `PAYROLL_OVERRIDE` action with note

---

## Verification Checklist

- [ ] All 6 user stories independently testable (each scenario completes without others)
- [ ] PH statutory deductions compute correctly for sample salary (Scenario 5)
- [ ] RBAC enforced: employee cannot access another employee's data
- [ ] Audit log records all mutations across all scenarios
- [ ] Dashboard reflects real-time data (refresh after each scenario)
- [ ] CSV exports download and open correctly in spreadsheet software
