# API Contract: Payroll v2 (Expansion — FR-060–FR-066)

**Base path**: `/api/v1/payroll`
**Auth**: Session cookie (Lucia). **Roles**: `HR_ADMIN`, `SUPER_ADMIN`, and (new) `PAYROLL_OFFICER`;
`FINANCE` is read-only on reports.
**Status**: planned (see [plan-payroll.md](../plan-payroll.md)). Additive to [payroll.md](./payroll.md),
which still covers the statutory core.

---

## POST /api/v1/payroll/periods

Open a payroll period (cutoff window + config snapshot).

**Request body**: `{ "name": "Jul 1–15 2026", "start": "2026-07-01", "end": "2026-07-15", "cutoff": 15 }`
**Response 201**: PayrollPeriod `{ id, status: "OPEN", ... }`
**Error 409**: overlapping period for the same cutoff.

## POST /api/v1/payroll/periods/:id/import

Import validated attendance for the period (per-employee hour buckets). Requires the attendance
period to be locked (FR-055).

**Response 200**: `{ status: "IMPORTED", employees: n, warnings[] }` — warnings for missing/unvalidated attendance.

## POST /api/v1/payroll/periods/:id/generate

Compute the run: earnings (OT, night diff, holiday, rest-day, allowances, incentives) + deductions
(statutory + loans + cash advances) → `PayrollEntry` with `PayrollEarning[]`/`PayrollDeduction[]`.

**Response 200**: run summary `{ status: "GENERATED", totalGross, totalDeductions, totalNet, flagged[] }`
**Side effect**: loan/cash-advance balances staged (committed on lock); AuditLog `UPDATE`.

## POST /api/v1/payroll/periods/:id/lock

Lock the run — immutable thereafter.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`. **Response 200**: `{ status: "LOCKED", lockedAt }`
**Error 409**: unresolved flagged entries without an override note.

## POST /api/v1/payroll/periods/:id/release

Release payslips to employees (visibility gate).

**Response 200**: `{ status: "RELEASED", releasedAt }`. **Precondition**: run is `LOCKED`.

## POST /api/v1/payroll/periods/:id/void

`SUPER_ADMIN` only. Reverses loan/cash-advance decrements; corrections go in a later period.

---

## POST /api/v1/payroll/calculator

What-if preview for one employee — runs the same earnings/deductions engine, **persists nothing**.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`, `PAYROLL_OFFICER`
**Request body**:

```json
{
	"employeeId": "…",
	"attendance": {
		"regularHours": 80,
		"otHours": 10,
		"nightDiffHours": 4,
		"holidayHours": 8,
		"restDayHours": 0,
		"lateMinutes": 0,
		"undertimeMinutes": 0
	},
	"adjustments": { "allowances": 2000, "incentives": 1500 }
}
```

**Response 200**: `{ earnings[], deductions[], grossPay, taxableGross, netPay }` — identical to what a real run would produce for the same inputs.

---

## Loans & Cash Advances

- `GET/POST /api/v1/payroll/loans` , `PATCH /api/v1/payroll/loans/:id` — record loans; balances amortize per run (HR_ADMIN, PAYROLL_OFFICER).
- `GET/POST /api/v1/payroll/cash-advances` — record advances; deducted in the target period.

All mutations write an AuditLog entry. Amounts are PHP `Decimal`; deductions never exceed the outstanding balance.
