# Implementation Plan (Addendum): Attendance Engine

**Branch**: `001-hris-platform` | **Date**: 2026-07-10 | **Spec**: [spec.md](./spec.md) FR-052–FR-055
**Parent plan**: [plan.md](./plan.md) — scoped addendum for Phase 11.3; does not replace plan.md.

## Summary

Turn raw `TimeLog` punches into reviewable, per-day **AttendanceDay** records — deriving time in/out,
late, undertime, overtime, night differential, breaks, and missing/incomplete flags against each
employee's **WorkSchedule** and the holiday calendar. HR reviews/corrects, then **locks** attendance for
a period, which feeds the payroll engine's `AttendanceInput` (regular/OT/night-diff/holiday/rest-day hours
+ late/undertime). This closes the loop: **Discord punch → attendance → payroll** — replacing the interim
"regularHours from approved timesheets" seam the payroll engine uses today.

## Technical Context

**Language/Deps**: unchanged (TS 5, SvelteKit 2, Prisma 5, Postgres 16). No new runtime deps.
**Reuses**: `TimeLog` (raw punches), `src/lib/utils/dates.ts` PHT helpers (`manilaDayKey/DayStart/WeekStart`),
`pairPunchesToDailyHours` in `timelog.ts`, `PublicHoliday` (holiday classification), and the payroll
`AttendanceInput` type + rate matrix (already built).
**New models** (data-model.md "Phase 11 — Proposed Entities", refined here):
`WorkSchedule`, `WorkScheduleDay`, `AttendanceDay`; `Employee.workScheduleId`; enums
`AttendanceStatus`, `DayType`.
**Storage**: `AttendanceDay` stores the payroll hour-buckets directly, so `buildAttendanceInput` is a pure sum.
**Testing**: Vitest units for the pure derivation (late/undertime/OT/night-diff/holiday/rest-day, missing logs).
**Timezone**: all bucketing in PHT (UTC+8), consistent with `TimeLog` storage/aggregation.

**Cross-epic seam**: `buildAttendanceInput(employeeId, periodStart, periodEnd)` → payroll `AttendanceInput`.
Wire it into the payroll period lifecycle so `importAttendance` derives + locks the period's AttendanceDays
and `generate` reads them (falling back to the current timesheet path when no AttendanceDays exist).

## Key Decisions (Phase 0)

- **D1 — Persist AttendanceDay (not compute-on-read).** HR must correct + lock (FR-054/055), so days are
  materialized: derive from `TimeLog` → upsert `AttendanceDay` → HR edits → lock. `@@unique([employeeId, date])`.
- **D2 — Schedule model.** `WorkScheduleDay` per weekday holds `startMinutes`, `endMinutes`, `breakMinutes`
  (minutes-from-midnight PHT). A weekday with **no** row = **rest day**. `Employee.workScheduleId` (nullable →
  falls back to an org default 9–18, 60-min break, Mon–Fri).
- **D3 — Derivation rules.** `timeIn` = first IN, `timeOut` = last OUT; `workedHours` = paired hours −
  `breakMinutes`; `late` = max(0, timeIn − schedStart); `undertime` = max(0, schedEnd − timeOut);
  `overtime` = max(0, workedHours − scheduledHours). Day type from `WorkScheduleDay` presence + `PublicHoliday`.
- **D4 — Store buckets on AttendanceDay** mirroring `AttendanceInput` (regular/OT/nightDiff/restDay/holiday
  variants + late/undertime), so `buildAttendanceInput` just sums locked days and payroll consumes it unchanged.
- **D5 — Lock is per-day.** "Lock attendance for [range]" sets `isLocked` on those AttendanceDays; locked days
  reject edits (409) and are what payroll imports. No new period entity — the payroll `PayrollPeriod` drives it.
- **D6 — Stacking reuses payroll.** Rest-day/holiday + OT combinations map to the existing payroll bucket set
  (restDayOt, regularHolidayOt, …); attendance only classifies hours into buckets, payroll prices them.

**NEEDS CLARIFICATION** (carry to /speckit-clarify):
1. **Night-differential window** — default DOLE **22:00–06:00 PHT**; make it org-configurable (like pay rates)?
2. **Overtime source** — auto-derive OT from `workedHours > scheduledHours`, or only count OT that has an
   **approved OT request** (Requests module, FR-056)? (Recommend: derive now, gate on approvals when 11.4 lands.)
3. **Breaks** — fixed **scheduled** unpaid break (`breakMinutes`), or real **break punches** (BREAK_IN/OUT)?
   (Recommend: scheduled break for MVP; punch-based later.)
4. **Half-day / leave interplay** — when an approved leave covers a day, mark `ON_LEAVE` and zero worked hours?

## Constitution Check

| Principle | Status |
|-----------|--------|
| I. Data Privacy | ✅ Attendance is personal data — RBAC-gated (employee sees own; HR manages). No new secrets. |
| II. RBAC | ✅ Derive/correct/lock = HR_ADMIN+ (later PAYROLL_OFFICER); employees read-only own days. |
| III. Spec-Driven | ✅ FR-052–055 specified; this plan + clarify precede build. |
| IV. Audit | ✅ Corrections and locks write `writeAuditLog`; derivation is idempotent + traceable. |
| V. Test-First | ✅ Pure `deriveAttendanceDay` unit-tested before wiring (mirrors the payroll engine approach). |

No violations. No Complexity Tracking entries.

## Project Structure (new/changed)

```text
prisma/schema.prisma                         # + WorkSchedule/WorkScheduleDay/AttendanceDay, Employee.workScheduleId, enums
src/lib/server/services/attendance/
├── derive.ts        (new)                   # pure deriveAttendanceDay(punches, scheduleDay, dayType, holidays, cfg)
├── index.ts         (new)                   # deriveRange (upsert AttendanceDays), listDays, correctDay, lockRange
└── input.ts         (new)                   # buildAttendanceInput(employeeId, periodStart, periodEnd) → payroll AttendanceInput
src/lib/server/services/payroll/periods.ts   # importAttendance() derives+locks; generate reads AttendanceDays
src/lib/server/services/payroll/index.ts      # source AttendanceInput from attendance when present (else timesheet fallback)
src/routes/(app)/attendance/                  # HR review: per-day grid, flags, correct, lock
src/routes/(app)/settings/schedules/          # WorkSchedule CRUD + assign to employees
src/routes/api/v1/attendance/                 # derive / list / correct / lock endpoints
tests/unit/attendance-derive.test.ts (new)
```

## Delivery slices (each shippable & verifiable)

1. **Schema + pure derivation engine** — models + `derive.ts` with full unit tests (late/undertime/OT/night-diff/
   rest-day/regular+special holiday/missing/incomplete). No UI. Verifiable by Vitest.
2. **Derive service + payroll seam** — `deriveRange` (upsert AttendanceDays from TimeLogs), `buildAttendanceInput`,
   and wire into payroll `importAttendance`/`generate` (replace the timesheet fallback). Verify: punch → import →
   generate produces payroll entries with OT/holiday buckets.
3. **HR attendance review UI** — per-day grid with flags (no time-in / incomplete / missing), inline correct, and
   **lock period**; employee read-only view of own days.
4. **Work schedules** — `WorkSchedule` CRUD in Settings + assign a schedule to an employee (employee detail).

## Verification

- `pnpm test` — derivation units (incl. night-diff window overlap, holiday classification, missing OUT).
- `pnpm exec svelte-check` — no new errors · `pnpm db:migrate` (additive).
- E2E: seed a schedule + holiday, post punches (via the `/log` endpoint), derive → assert AttendanceDay buckets;
  run payroll import→generate → assert OT/holiday hours flow into the payroll entry; lock rejects edits (409).
- `speckit-analyze` — FR-052–055 mapped.

## Out of scope (this addendum)
Biometric/other punch sources (TimeLog already generic); break-punch support; shift rotation / multiple shifts
per day; geofencing; the Requests-module OT approval gating (Phase 11.4) — attendance derives OT, approval
gating is layered on when Requests lands.
