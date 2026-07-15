# Handoff — Veent HRIS

**Branch**: `dev/attendance` · **Last updated**: 2026-07-14

## ⚠️ Environment note (read first)

- **DB is on port 5433** (local dev container). Credentials come from `.env`'s `DATABASE_URL`
  (not checked in). `./start.sh` brings up the container, syncs the schema, seeds if empty, and runs
  `pnpm dev` + `pnpm bot`. The dev container binds to localhost only and must never be reused outside
  local development.
- **This session changed the Prisma schema** — after pulling, run `pnpm db:push` (or `./start.sh`)
  to apply, then restart `pnpm dev` (the running server caches the Prisma client and will 500 on new
  columns until restarted).
- Seeded logins (Super Admin, Manager, Employee, Payroll Officer, Finance) are created by
  `prisma/seed.ts` — see the seed script for the local-only credentials. These are development
  defaults; never commit real passwords here.

## Schema changes this session (require `pnpm db:push`)

- `AttendanceDay.manuallyEdited Boolean @default(false)` — set when HR hand-corrects a day; keeps a
  Refresh re-derive from overwriting the override.
- `TimesheetEntry` += `timeIn DateTime?`, `timeOut DateTime?`, `otHours Decimal @default(0)`
  (`hoursWorked` is the total worked = regular + OT).

## ✅ Done (this session)

### Settings — Org structure & RBAC (T157–160) — closes #16–19

- **T157** REST routes under `/api/v1/settings`: positions (list/create/get/update), org-chart,
  users, users/`:id`/role.
- **T158** Interactive **Org Chart** (`/settings/org-chart`): collapsible reporting tree from
  `Employee.reportsTo`, people search; hub card added.
- **T159** Position editing (department, salary grade, active) + employee↔position assignment on
  `/settings/org`.
- **T160** Last-active-super-admin guardrail in `setUserRole`; `setUserActive` with the same guard;
  activate/deactivate on the roles page.

### Attendance — corrections & timesheet workflow

- Employee ⇄ Team (day) toggle; `/team` (multi-day matrix) and the attendance team tab cross-linked.
- **Auto-derive on load** (non-destructive, fills only missing days); **Refresh** does a full
  re-derive. A manual correction flags the day (`manuallyEdited`) so Refresh never wipes it; a
  per-row **Reset** discards the override and re-derives from punches.
- **Inline corrections**: Status/In/Out/Reg/OT edit in place (text-like, editable on focus). HR keys
  In/Out manually; **Reg/OT auto-calc** from the times.
- Super-admin-only **Unlock**; **2-month range cap**; **Export CSV** (both tabs); per-employee
  **Save as timesheet** materialises a `Timesheet` (now carries in/out + OT).

### Timesheets — floating review window

- List: rows are **clickable** to open a review **modal** (no Open button); checkboxes + select-all;
  **bulk bar top-right** with role-based actions — Approve/Delete selected (managers) or Submit
  selected (employees).
- Modal (sticky header / scroll body / sticky footer, `max-w-6xl`): edit entries with **Date · In ·
  Out · Reg · OT · Notes**; **auto-OT** — regular window is **08:00–17:00**, time outside it is OT
  (overridable); **arrow-key grid navigation** (Up/Down/Enter rows, Left/Right columns), spinner-free
  number fields; Approve/Reject-with-reason, Submit, and **Delete any timesheet** (incl. approved).
- `updateTimesheetEntries` / `deleteTimesheet` services; `saveEntries`/`review`/`submit`/`delete`/
  `approveMany`/`submitMany`/`deleteMany` actions.
- Seed: 5 sample timesheets across all statuses + a **full-month (21-entry)** one to stress the UI.

## CI / quality gate — all green

`format:check` ✅ · `lint` ✅ (0 errors, ~81 pre-existing a11y warnings) · `check` (typecheck)
✅ **0 errors** · `test` ✅ **103/103**. Verified feature flows in-browser (Playwright) and against
the DB where relevant.

## ⏳ Not done yet / next up

1. **Recruitment/onboarding/separation** — #29 (T177 interviews/offers), #30 (T178 onboarding),
   #32 (T180 separation + final pay).
2. **Employee 201 file** — #23 (T164 emergency contacts, bank/GCash, docs), #24 (T165 assign
   position + work schedule, employment history).
3. E2E specs for the new timesheet/attendance flows (none yet; the existing suite is flaky locally on
   Vite-dev `page.goto` timeouts — an env issue, not a code regression).

## GitHub issues

- **Close after push**: #16–19 (T157–160, Settings/Org-chart). The timesheet/attendance work was
  ad-hoc HR requests with no tracking issues.

## Known gotchas (carried over)

- Attendance-driven payroll → no punches = 0 pay; monthly-salaried staff must be marked present
  before lock.
- Timesheet auto-OT uses the **08:00–17:00** window with **no automatic lunch deduction** (a full
  8–5 day = 9 regular hours). Change the rule in `recalcRow` (modal) / seed if lunch should be netted.
- Manually-edited attendance days are sticky through Refresh until **Reset**.
- The floating modal renders all entry rows at once — fine to ~a month; virtualize if you ever need
  multi-hundred-row sheets.
