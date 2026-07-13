# Handoff — Veent HRIS (resume tomorrow)

**Branch**: `dev/reports` (forked from `dev/payroll`) · **Last updated**: 2026-07-13

## ⚠️ Environment note (read first)
- **DB is on port 5433** (temporary container `veent-db-5433`). `.env`'s `DATABASE_URL` points to
  `localhost:5433`. Start it with `docker start veent-db-5433`.
- Run: `pnpm dev` (app) + `pnpm bot` (Discord), or `./start.sh`.
- **After any schema change, restart `pnpm dev`** — the running server caches the Prisma client and
  will 500 on new tables/enums until restarted.
- Seeded logins: `admin@veent.ph`/`Admin@1234` (Super Admin) · `manager@veent.ph`/`Manager@1234` ·
  `employee@veent.ph`/`Employee@1234` · `payroll@veent.ph`/`Payroll@1234` (Payroll Officer) ·
  `finance@veent.ph`/`Finance@1234`.

## Git state
- `dev/payroll` — pushed (previous session's work: payroll, attendance, requests foundations).
- `dev/reports` — **6 commits, NOT pushed yet.** Everything below is committed here.

## ✅ Done (this session)
- **T161 — Roles/RBAC**: `PAYROLL_OFFICER` + `FINANCE` roles, capability-based RBAC
  (`requirePayrollManage`/`requirePayrollReports` in `rbac.ts`), nav gating, role-management UI.
- **T168/T169 — Requests + multi-stage approvals**: unified `Request` model (7 types), Zod-validated
  payloads, configurable routing (Supervisor→HR→Payroll), Employee Kiosk (`/requests`), approval engine
  (`decide()`), and the **OT gate** (approved OT feeds `deriveRange` → pays `min(raw, approved)`).
  Legacy `LeaveRequest` migrated → `Request(type=LEAVE)`; **table kept dormant, physical DROP deferred**
  (see below).
- **T162 — File uploads**: `EmployeeDocument`, private `UPLOAD_DIR` storage + authenticated download
  route, HR upload UI on `/employees/[id]`, employee read-only view on `/profile`.
- **T163 — Settings master data**: Settings hub, Company Info, Earnings/Deduction codes, **Salary
  Grades** (bands + out-of-band badge). Settings nav collapsed into one expandable group.
- **T176 — Reports**: tardiness, overtime, loan summary, government remittance, BIR withholding
  (+ CSV, RBAC: payroll reports open to Payroll Officer/Finance).
- **T181 — Dashboard tiles**: On Leave Today, Pending Approvals, Attendance Today summary.
- **T182 — Announcements + toast notifications**: `Announcement`/`Notification` models, toast store +
  `<Toaster/>`, request decisions notify the requester, dashboard announcements + HR post form.
- **T145–148 — Benefits**: enrollment UI, My Benefits on `/profile`, REST routes, benefit costs folded
  into payroll deductions (prorated).
- **T151–154 — Performance**: review detail page (self-assessment/manager-review/acknowledge), HR cycle
  management (create/activate/close/open-reviews), manager Team Goals view, REST routes.

All 103 unit tests green. Each feature verified with service/HTTP e2e smoke tests + committed
incrementally. Only 4 **pre-existing** typecheck errors remain (departments, leave/new, payslips/[id],
timesheets/new — none touched this session).

## GitHub issues
- Closed: #20, #25, #26, #21, #22 (T161/168/169/162/163).
- **To close after pushing `dev/reports`**: #28 (T176), #33 (T181), #34 (T182), #8–11 (Benefits),
  #12–15 (Performance).

## ⏳ Not done yet (next up)
1. **Settings / Org chart (#16–19, T157–160)** — REST routes, interactive org-chart viz, position
   edit + employee↔position assignment, last-super-admin guardrail. (Recommended next.)
2. **Recruitment/onboarding/separation** — #29 (T177 interviews/offers), #30 (T178 onboarding
   checklist), #32 (T180 separation + final pay).
3. **Timesheets (#2–7, T137–142)** — largely **superseded by the attendance engine** (`/attendance`
   already does punches→hours→review→lock with richer OT/holiday logic). Low priority; the one
   non-duplicative bit is a `/timesheets/[id]` detail view.

## Deferred cleanup (do once, after QA sign-off)
- **Drop `LeaveRequest`**: migration already copied data to `Request(type=LEAVE)` and all readers are
  repointed. Remove the `LeaveRequest` model + `leave_requests` table + `Employee.leaveRequests` /
  `LeaveType.leaveRequests` relations, and `LeaveRequestStatus` if unused. Reversible until then.
- **RequestDocument** still uses a `url` stub — retro-fit to the T162 storage lib for real file attachments.

## Known gotchas (carried over)
- Attendance-driven payroll → no punches = 0 pay; monthly-salaried staff must be marked present before lock.
- Combined rest-day + holiday stacking not modeled; unworked regular-holiday pay not handled.
- No E2E (Playwright) for payroll/attendance/requests yet.
