# API Contract: Payroll

**Base path**: `/api/v1/payroll`
**Auth**: Bearer JWT required.

---

## PayrollConfig

### GET /api/v1/payroll/config

Get organization's payroll configuration.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Response 200**: PayrollConfig object (excludes raw SSS/BIR JSON tables from response body for brevity; use dedicated endpoints for tables).

---

### PATCH /api/v1/payroll/config

Update payroll configuration (rates, schedules, statutory tables).

**Roles**: `SUPER_ADMIN` only

**Request body**: Any subset of PayrollConfig fields.

**Response 200**: Updated config.
**Side effect**: AuditLog `UPDATE` entry.

---

## Payroll Runs

### GET /api/v1/payroll/runs

List payroll runs.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Query params**: `status`, `year`, `page`, `limit`

**Response 200**: Paginated list of PayrollRun summaries.

---

### POST /api/v1/payroll/runs

Compute a new payroll run.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**:
```json
{
  "periodStart": "2025-07-01",
  "periodEnd": "2025-07-15"
}
```

**Response 201**: PayrollRun with `status: COMPUTED` and all PayrollEntry rows.
**Response 409**: A run for this period already exists.

**Computation logic**:
1. Collect all active employees
2. For each employee, sum hours from `APPROVED` timesheets within the period
3. Compute `grossPay`, `sssEe/Er`, `philhealthEe/Er`, `pagibigEe/Er`, `withholdingTax`, `netPay`
4. Flag employees with no `APPROVED` timesheet as `isFlagged = true`
5. Return run with `warnings` array listing flagged employees

---

### GET /api/v1/payroll/runs/:id

Get a payroll run with all entries.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Response 200**: Full PayrollRun object including `entries[]`.

---

### POST /api/v1/payroll/runs/:id/approve

Approve a computed payroll run and issue payslips.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**If `isFlagged` entries exist**, request body must include override confirmation:
```json
{ "overrideNote": "string" }
```
If flagged entries exist and `overrideNote` is absent → **Response 422** with list of flagged employees.

**Response 200**: `{ "status": "APPROVED", "approvedAt": "...", "payslipsIssued": 95 }`
**Side effect**: Payslips become visible to employees; AuditLog `PAYROLL_OVERRIDE` if `overrideNote` provided.

---

### POST /api/v1/payroll/runs/:id/void

Void a computed (not yet approved) run.

**Roles**: `SUPER_ADMIN` only

**Response 200**: `{ "status": "VOIDED" }`
**Note**: Approved runs cannot be voided — create a new adjustment run instead.

---

## Payslips

### GET /api/v1/payroll/payslips

List payslips for the current employee.

**Roles**: `EMPLOYEE`, `MANAGER` (own payslips)

**Query params**: `year`, `page`, `limit`

**Response 200**: Paginated list of payslip summaries (period, grossPay, netPay, status).

---

### GET /api/v1/payroll/payslips/:payrollEntryId

Get detailed payslip (itemized breakdown).

**Roles**: `EMPLOYEE`/`MANAGER` (own); `HR_ADMIN`/`SUPER_ADMIN` (any)

**Response 200**:
```json
{
  "employee": { "id": "uuid", "name": "string", "employeeNumber": "EMP-0001" },
  "period": { "start": "2025-07-01", "end": "2025-07-15" },
  "earnings": {
    "basicPay": 15000,
    "grossPay": 15000
  },
  "deductions": {
    "sssEe": 675,
    "philhealthEe": 375,
    "pagibigEe": 100,
    "withholdingTax": 0,
    "total": 1150
  },
  "netPay": 13850
}
```
