# Handoff — Veent HRIS (resume tomorrow)

**Branch**: `dev/payroll` · **Last updated**: 2026-07-10

## ⚠️ Environment note (read first)
- **DB is on port 5433** (temporary container `veent-db-5433`) because another project's DB
  (`jojo-mobile`) is holding 5432. `.env`'s `DATABASE_URL` points to `localhost:5433`.
- To return to the normal setup: stop `veent-db-5433`, start `veent_wifiportal-db-1` (needs 5432
  free), and revert `.env` `DATABASE_URL` back to `:5432`. `start.sh` assumes the 5432 container.
- The 5433 DB is a fresh seed; the original 5432 volume is untouched.
- Run: `pnpm dev` (app) + `pnpm bot` (Discord), or `./start.sh` (DB + app + bot in one command).
- Seeded logins: `admin@veent.ph` / `Admin@1234` · `manager@veent.ph` / `Manager@1234` ·
  `employee@veent.ph` / `Employee@1234`.

## ✅ Done this session (Phase 11)

**Payroll expansion (spec `plan-payroll.md` / `tasks-payroll.md`, PAY-001…025):**
- Config-driven earnings engine (OT/night-diff/rest-day/holiday incl. stacked OT, allowances,
  incentives) + deductions engine (tardiness, loans/cash-advance amortization) — all unit-tested.
- Schema: `PayrollPeriod`, itemized `PayrollEarning/Deduction`, `Loan/LoanPayment`, `CashAdvance`,
  `EarningType/DeductionType`, `PayRateRule` (seeded with DOLE defaults).
- Period lifecycle `open→import→generate→lock→release→void` (service + API + UI at `payroll/periods`),
  loan amortization committed at lock / reversed on void, payslips gated on **RELEASED**.
- **Payroll Calculator** (shared engine, preview == run) at `payroll/calculator`.
- **Loans & Cash Advances** CRUD (service + API + employee-detail panel).
- **Payroll Register** report + CSV export.

**Attendance engine (spec `plan-attendance.md`, FR-052–055):**
- Schema: `WorkSchedule/WorkScheduleDay`, `AttendanceDay`, `Employee.workScheduleId`.
- Pure `deriveAttendanceDay` (late/undertime, **OT gated on approval**, night-diff configurable PHT
  window, break punches, rest-day/holiday buckets, ON_LEAVE/INCOMPLETE/ABSENT) — unit-tested.
- `deriveRange` + `buildAttendanceInput` wired into payroll (`importAttendance` derives+locks,
  `computePayroll` reads attendance, falls back to timesheets).
- HR **attendance review UI** (`/attendance`): derive, per-day correct, lock; employees see own read-only.
- **Work schedules** CRUD (`settings/schedules`) + assign to an employee (employee form).

**Discord bot**: reworked to slash commands **`/in` `/out` `/break`** (break toggles START/END) with an
optional backfill **time** arg (`/in 9:00`, PHT); public announcement + private ack; auto-registers to
guilds. `PunchType` gained `BREAK_START/BREAK_END`; endpoint accepts `IN|OUT|BREAK`.

**Misc**: `db:migrate` made idempotent (db push); Discord-ID field on employee form; `start.sh` runs
app + bot; `TESTING.md` QA runbook; **73 unit tests green**; each slice verified with DB checks +
screenshots and committed incrementally.

## ⏳ Not done yet (next up)

**Highest leverage — Requests + multi-stage approvals (T168, T169):**
- Generalize `LeaveRequest` → `Request` with 7 types (Leave, Overtime, Undertime, Official Business,
  Rest-Day Work, Holiday Work, Info-Update) + supporting docs (Employee Kiosk).
- Configurable multi-stage routing (`ApprovalStep`: Employee→Supervisor→HR→Payroll) with
  Approve/Reject/Return.
- **This unblocks the attendance OT gate**: today `deriveAttendanceDay` takes `approvedOtHours` and it's
  hard-wired to `0`. Once approved-OT requests exist, feed them in `deriveRange` so overtime actually pays.

**Other Phase 11 remaining (see `specs/001-hris-platform/tasks.md`):**
- **T161** new roles `PAYROLL_OFFICER` / `FINANCE` (payroll routes currently use HR_ADMIN/SUPER_ADMIN).
- **T162 / T164** file uploads (contracts/IDs/exit docs), emergency contacts, bank/GCash details.
- **T163** Settings master data — *partial*: work schedules ✅ + earning/deduction codes seeded;
  company info / salary structures / payroll cutoffs UI remain.
- **T170–T174** payroll epics — done via `tasks-payroll.md`; **T175** disbursement (bank/GCash) deferred.
- **T176** more reports — *partial*: payroll register ✅; tardiness/overtime/loan-summary/BIR remain
  (tardiness/OT now derivable from `AttendanceDay`).
- **Benefits / Performance / Settings-Org** are scaffolds only — full UIs pending (T145–T160).
- **T177–T178** recruitment interviews/offers + onboarding checklist; **T180** Separation;
  **T181–T182** dashboard tiles + announcements/notifications.

**Known follow-ups / gotchas:**
- Attendance-driven payroll means **no punches = 0 pay** for that period (absences flagged). Monthly
  staff must punch or be marked present in the review UI before lock — decide the policy for
  monthly-salaried employees who don't punch.
- Combined **rest-day + holiday** stacking isn't modeled (holiday takes precedence in `deriveRange`).
- Unworked **regular-holiday pay** (100% when not worked) isn't handled — attendance records worked
  hours only.
- E2E (Playwright) covers only the original flows; no E2E yet for payroll/attendance — worth adding.

## Suggested next step
Plan + build the **Requests module + multi-stage approvals** (T168/T169) — it's the last big gap and it
lights up the OT path the payroll+attendance engines already expect.
