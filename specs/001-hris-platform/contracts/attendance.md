# API Contract: Attendance (FR-052–FR-055)

**Base path**: `/api/v1/attendance`
**Auth**: Session cookie (Lucia). **Roles**: `HR_ADMIN`, `SUPER_ADMIN` (later `PAYROLL_OFFICER`);
employees may read their own days.
**Status**: planned (see [plan-attendance.md](../plan-attendance.md)). Turns `TimeLog` punches
(see [timelog.md](./timelog.md)) into reviewable `AttendanceDay` records that feed payroll.

---

## POST /api/v1/attendance/derive

Derive `AttendanceDay` records from `TimeLog` punches for a date range, against each employee's
`WorkSchedule` + the holiday calendar. Idempotent (re-derives non-locked days).

**Roles**: HR_ADMIN, SUPER_ADMIN
**Request body**: `{ "from": "2026-07-01", "to": "2026-07-15", "employeeId": "…?" }` (omit `employeeId` for all)
**Behavior**: per PHT day computes `timeIn/timeOut`, `lateMinutes`, `undertimeMinutes`, `overtimeHours`,
`nightDiffHours`, `breakMinutes`, hour buckets (regular / rest-day / regular- & special-holiday, incl. OT
variants), and a `status` (`PRESENT|LATE|ABSENT|INCOMPLETE|ON_LEAVE|HOLIDAY|REST_DAY`). Skips `isLocked` days.
**Response 200**: `{ derived: n, flagged: [{ employeeId, date, status }] }`. Side effect: AuditLog.

## GET /api/v1/attendance?employeeId=&from=&to=

List derived attendance days.

**Roles**: owner employee (own only), manager of owner, HR_ADMIN, SUPER_ADMIN
**Response 200**: `AttendanceDay[]` ordered by date.

## PATCH /api/v1/attendance/:id

HR correction of a single day (e.g. fix a missing OUT, adjust OT).

**Roles**: HR_ADMIN, SUPER_ADMIN
**Request body**: any of `{ timeIn?, timeOut?, overtimeHours?, nightDiffHours?, lateMinutes?, undertimeMinutes?, status?, note? }`
**Validation**: recomputes dependent totals; rejects if the day `isLocked` (**409**).
**Response 200**: updated `AttendanceDay`. Side effect: AuditLog `UPDATE`.

## POST /api/v1/attendance/lock

Lock attendance for a range so payroll can import it; locked days become read-only.

**Roles**: HR_ADMIN, SUPER_ADMIN
**Request body**: `{ "from": "2026-07-01", "to": "2026-07-15", "employeeId": "…?" }`
**Response 200**: `{ locked: n }`. Side effect: AuditLog. (Payroll `importAttendance` calls this internally.)

---

## Internal seam (not HTTP)

`buildAttendanceInput(employeeId, periodStart, periodEnd)` sums locked `AttendanceDay` buckets into the
payroll engine's `AttendanceInput`. The payroll period `importAttendance` step derives+locks the period's days;
`generate` then reads them (falling back to approved timesheets when no AttendanceDays exist).
