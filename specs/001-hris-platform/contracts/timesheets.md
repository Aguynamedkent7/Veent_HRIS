# API Contract: Timesheets

**Base path**: `/api/v1/timesheets`
**Auth**: Bearer JWT required.

---

## POST /api/v1/timesheets

Create or update a draft timesheet for the current employee.

**Roles**: `EMPLOYEE`, `MANAGER` (for own timesheet)

**Request body**:

```json
{
	"periodStart": "2025-07-07",
	"periodEnd": "2025-07-11",
	"entries": [
		{ "date": "2025-07-07", "hoursWorked": 8, "notes": "string | null" },
		{ "date": "2025-07-08", "hoursWorked": 8, "notes": null }
	]
}
```

**Validation**: `periodStart` must be Monday; `periodEnd` must be Friday; dates in `entries` must fall within the period; `hoursWorked` 0–24.

**Response 201**: Timesheet object with `status: DRAFT`.
**Error 409**: Duplicate — timesheet for this period already `SUBMITTED` or `APPROVED`.

---

## POST /api/v1/timesheets/:id/submit

Submit a draft timesheet for manager approval.

**Roles**: `EMPLOYEE`, `MANAGER` (own)

**Response 200**: `{ "id": "uuid", "status": "SUBMITTED", "submittedAt": "..." }`
**Side effect**: Manager notified; AuditLog `UPDATE` entry.

---

## GET /api/v1/timesheets

List timesheets.

**Roles**:

- `EMPLOYEE`/`MANAGER`: own timesheets only
- `HR_ADMIN`/`SUPER_ADMIN`: all timesheets

**Query params**: `employeeId`, `status`, `periodStart`, `periodEnd`, `page`, `limit`

**Response 200**: Paginated list of timesheet summaries.

---

## GET /api/v1/timesheets/:id

Get timesheet detail with entries.

**Roles**: Owner, manager of owner, `HR_ADMIN`, `SUPER_ADMIN`.

**Response 200**: Full timesheet object with `entries[]`.

---

## GET /api/v1/timesheets/pending-approvals

Timesheets awaiting current manager's approval.

**Roles**: `MANAGER`, `HR_ADMIN`, `SUPER_ADMIN`

**Response 200**: List of `SUBMITTED` timesheets for direct reports (manager) or all (admin).

---

## POST /api/v1/timesheets/:id/approve

Approve a submitted timesheet.

**Roles**: `MANAGER` (direct reports only), `HR_ADMIN`, `SUPER_ADMIN`

**Response 200**: `{ "status": "APPROVED", "reviewedAt": "..." }`
**Side effect**: Employee notified; AuditLog entry.

---

## POST /api/v1/timesheets/:id/reject

Reject a submitted timesheet.

**Roles**: `MANAGER` (direct reports only), `HR_ADMIN`, `SUPER_ADMIN`

**Request body**: `{ "reason": "string" }` _(required)_

**Response 200**: `{ "status": "REJECTED", "rejectionReason": "string" }`
**Side effect**: Employee notified with reason; AuditLog entry.

---

## Time-log aggregation

Weekly timesheets can also be built from raw Discord punches — see [timelog.md](./timelog.md). HR aggregates a week of `TimeLog` punches into a DRAFT `Timesheet`, edits the per-day hours, then approves via the existing `POST /api/v1/timesheets/:id/approve` flow (feeds payroll unchanged).
