---
description: "Task list for Veent HRIS Core Platform"
---

# Tasks: Veent HRIS Core Platform

**Input**: Design documents from `specs/001-hris-platform/`

**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/ ✅

**Stack**: SvelteKit 2 + Svelte 5 + TypeScript 5 | Prisma 5 + PostgreSQL 16 | Lucia v3 | shadcn-svelte + Tailwind | Redis 7 | Vitest + Playwright

**Tests**: Vitest unit tests included for payroll statutory computations only (business-critical math). E2E Playwright tests included in polish phase.

**Organization**: Tasks grouped by user story for independent implementation and testing.

---

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no shared dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)

---

## Phase 1: Setup

**Purpose**: Initialize the SvelteKit project and install all dependencies.

- [ ] T001 Scaffold SvelteKit 2 project with TypeScript template via `npm create svelte@latest` — select TypeScript, ESLint, Prettier
- [ ] T002 Install and configure Tailwind CSS v3: run `npx svelte-add@latest tailwindcss`, verify `tailwind.config.ts` and `src/app.css`
- [ ] T003 [P] Initialise shadcn-svelte: run `npx shadcn-svelte@latest init`, add Button, Input, Table, Card, Dialog, Badge, Select, Dropdown, Skeleton components
- [ ] T004 [P] Install Prisma 5: `npm install prisma @prisma/client`, run `npx prisma init`, set `DATABASE_URL` in `.env`
- [ ] T005 [P] Install Lucia v3 and Prisma adapter: `npm install lucia @lucia-auth/adapter-prisma`
- [ ] T006 [P] Install Redis client and layerchart: `npm install ioredis layerchart`
- [ ] T007 [P] Install Vitest and Svelte Testing Library: `npm install -D vitest @testing-library/svelte @testing-library/jest-dom`, create `vitest.config.ts`
- [ ] T008 [P] Install Playwright: `npm install -D @playwright/test`, run `npx playwright install`, create `playwright.config.ts` targeting `http://localhost:5173`
- [ ] T009 Configure `@sveltejs/adapter-node` in `svelte.config.js` (replace auto adapter)
- [ ] T010 [P] Create `.env.example` with: `DATABASE_URL`, `REDIS_URL`, `LUCIA_SECRET`, `NODE_ENV`, `PORT=3000`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, auth, RBAC, and audit log must be complete before any user story begins.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T011 Write full Prisma schema in `prisma/schema.prisma`: all 15 HR entities (Organization, Department, User, Employee, Timesheet, TimesheetEntry, LeaveType, LeaveBalance, LeaveRequest, PublicHoliday, PayrollConfig, PayrollRun, PayrollEntry, JobPosting, Applicant, ApplicantStageHistory, AuditLog) plus Lucia's `Session` and `Key` models — include all fields, relations, unique constraints, and enums from `data-model.md`
- [ ] T012 Run `npx prisma migrate dev --name init` to generate initial migration and apply to dev database
- [ ] T013 [P] Create `src/lib/server/db.ts`: Prisma client singleton with `globalThis` cache to prevent hot-reload connection exhaustion
- [ ] T014 [P] Create `src/lib/server/redis.ts`: ioredis client singleton, export `getCache(key)` and `setCache(key, value, ttlSeconds)` helpers
- [ ] T015 Create `src/lib/server/auth.ts`: initialise Lucia with `PrismaAdapter`, configure session cookie name `auth_session`, set `sessionExpiresIn` to 30 days
- [ ] T016 Create `src/hooks.server.ts`: read `auth_session` cookie, call `lucia.validateSession()`, set `locals.user` and `locals.session`, call `lucia.createBlankSessionCookie()` on invalid session
- [ ] T017 Update `src/app.d.ts`: declare `App.Locals` with `{ user: User | null; session: Session | null }` using Lucia types
- [ ] T018 Create `src/lib/server/rbac.ts`: export `requireRole(...roles: Role[])` that reads `locals.user.role`, throws SvelteKit `error(403)` if role not in allowed list; export `isOwner(locals, employeeId)` for ownership checks
- [ ] T019 Create `src/lib/server/audit.ts`: export `writeAuditLog(db, entry: AuditLogEntry)` that inserts into `AuditLog` table via a separate Prisma call (outside the caller's transaction)
- [ ] T020 Create `src/lib/server/api-error.ts`: export `apiError(status, title, detail)` returning RFC 7807 `application/problem+json` Response object
- [ ] T021 [P] Create `src/lib/utils/dates.ts`: `getWeekStart(date)`, `getWeekEnd(date)`, `computeWorkingDays(start, end, holidays)`, `formatDateISO(date)`, `formatDateDisplay(date)`
- [ ] T022 [P] Create `src/lib/utils/format.ts`: `formatPHP(amount)` (Philippine Peso formatter), `formatPercent(value)`, `formatHours(decimal)`
- [ ] T023 Create login page `src/routes/(auth)/login/+page.svelte`: email + password form with validation feedback, uses shadcn-svelte Card + Input + Button
- [ ] T024 Create `src/routes/(auth)/login/+page.server.ts`: form action — find User by email, verify bcrypt password hash, call `lucia.createSession()`, set session cookie, redirect to `/dashboard`; write `LOGIN` / `LOGIN_FAILED` AuditLog entry
- [ ] T025 Create `src/routes/(app)/+layout.server.ts`: check `locals.user`, redirect to `/login` if null; pass `user` to layout data
- [ ] T026 Create `src/routes/(app)/+layout.svelte`: app shell with role-aware sidebar (employee sees: Dashboard, Timesheets, Leave, Profile, Payslips; manager adds: Approvals, Team; admin adds: Employees, Departments, Payroll, Reports, Recruitment)
- [ ] T027 Create `src/routes/+page.server.ts`: redirect authenticated users to `/dashboard`, unauthenticated to `/login`
- [ ] T028 Create `src/routes/(auth)/logout/+page.server.ts`: form action — invalidate Lucia session, clear cookie, redirect to `/login`
- [ ] T029 Create `prisma/seed.ts`: seed one Organization, one Department ("Engineering"), and one User+Employee per role (super_admin, hr_admin, manager, employee) with known passwords for local testing
- [ ] T030 Add `"prisma": { "seed": "ts-node prisma/seed.ts" }` to `package.json` and run `npx prisma db seed`

**Checkpoint**: Auth works — `npm run dev`, navigate to `/`, redirected to `/login`, can log in, sees sidebar, logs out. Foundation ready for all user stories.

---

## Phase 3: User Story 1 — Employee Self-Service Portal (Priority: P1) 🎯 MVP

**Goal**: Employee can log in, submit a weekly timesheet, file a leave request, and view their profile.

**Independent Test**: Log in as seeded employee → submit a timesheet for current week → verify status is `SUBMITTED` → file a 2-day leave request → verify it appears as `PENDING`. No other story required.

- [ ] T031 Create `src/lib/server/services/employees.ts`: `getById(db, id)`, `getProfile(db, userId)`, `updateContactDetails(db, id, data, actor)` — includes `writeAuditLog` call on update
- [ ] T032 Create `src/lib/server/services/timesheets.ts`: `listByEmployee(db, employeeId, filters)`, `getById(db, id)`, `create(db, employeeId, data)`, `submit(db, id, actor)` — enforces no-duplicate constraint, sets status to `SUBMITTED`
- [ ] T033 Create `src/lib/server/services/leave.ts`: `listLeaveTypes(db)`, `getBalances(db, employeeId, year)`, `listRequests(db, employeeId, filters)`, `createRequest(db, employeeId, data)` — validates balance, sets status `PENDING`
- [ ] T034 [P] [US1] Create `src/lib/components/timesheets/WeeklyGrid.svelte`: reusable hours-per-day input grid (Mon–Fri), accepts `entries` prop, emits change events, validates 0–24 range per day
- [ ] T035 [P] [US1] Create `src/lib/components/leave/BalanceSummary.svelte`: displays leave balance cards (leave type name, allocated, used, remaining) using shadcn-svelte Card
- [ ] T036 [P] [US1] Create `src/routes/(app)/timesheets/+page.svelte`: list of employee's timesheets with status badges, link to submit new timesheet
- [ ] T037 [US1] Create `src/routes/(app)/timesheets/+page.server.ts`: `load` — fetch own timesheets via `timesheets.listByEmployee`; `action: submit` — call `timesheets.submit()`
- [ ] T038 [P] [US1] Create `src/routes/(app)/timesheets/new/+page.svelte`: week picker + WeeklyGrid component, submit button
- [ ] T039 [US1] Create `src/routes/(app)/timesheets/new/+page.server.ts`: `load` — resolve current week dates; `action: create` — validate entries with Zod, call `timesheets.create()`, then auto-submit if user confirms; return 409 on duplicate
- [ ] T040 [P] [US1] Create `src/routes/(app)/leave/+page.svelte`: leave request list with status, BalanceSummary at top, link to new request
- [ ] T041 [US1] Create `src/routes/(app)/leave/+page.server.ts`: `load` — fetch own requests + balances; `action: cancel` — set request to `CANCELLED` (own pending only)
- [ ] T042 [P] [US1] Create `src/routes/(app)/leave/new/+page.svelte`: leave type selector, date range picker, reason textarea, balance preview showing impact
- [ ] T043 [US1] Create `src/routes/(app)/leave/new/+page.server.ts`: `action: create` — Zod validate, call `leave.createRequest()`, return 422 with `{ remaining, requested }` on balance error
- [ ] T044 [P] [US1] Create `src/routes/(app)/profile/+page.svelte`: read-only employment fields + editable contact fields (phone, address), save button
- [ ] T045 [US1] Create `src/routes/(app)/profile/+page.server.ts`: `load` — own Employee record; `action: update` — Zod validate, call `employees.updateContactDetails()` (writes AuditLog)
- [ ] T046 [P] [US1] Create `src/routes/api/v1/timesheets/+server.ts`: `GET` (list with filters), `POST` (create + submit); enforce ownership via `requireRole` + `isOwner`

**Checkpoint**: Employee self-service is fully functional and independently testable without any other story being complete.

---

## Phase 4: User Story 2 — HR Admin: Employee Lifecycle Management (Priority: P2)

**Goal**: HR Admin can create employees, update records, search, and offboard.

**Independent Test**: Log in as hr_admin → create new employee → verify user receives seeded credentials → update department → offboard → verify account deactivated and record is read-only.

- [ ] T047 Extend `src/lib/server/services/employees.ts`: add `list(db, filters, pagination)`, `create(db, data, actor)`, `update(db, id, data, actor)`, `offboard(db, id, endDate, reason, actor)`, `search(db, query)` — all mutation functions call `writeAuditLog`
- [ ] T048 Create `src/lib/server/services/departments.ts`: `list(db)`, `create(db, data, actor)`, `update(db, id, data, actor)` — calls `writeAuditLog` on mutations
- [ ] T049 [P] [US2] Create `src/lib/components/employees/EmployeeCard.svelte`: compact employee card showing name, number, title, department, status badge — used in list views
- [ ] T050 [P] [US2] Create `src/routes/(app)/employees/+page.svelte`: paginated employee list with search bar, department filter, status filter, EmployeeCard grid, "Add Employee" button (HR Admin only)
- [ ] T051 [US2] Create `src/routes/(app)/employees/+page.server.ts`: `load` — `requireRole(HR_ADMIN, SUPER_ADMIN, MANAGER)`, call `employees.list()` with filters; MANAGER sees only direct reports
- [ ] T052 [P] [US2] Create `src/routes/(app)/employees/new/+page.svelte`: onboarding form — all required Employee + User fields, department selector, reports-to selector
- [ ] T053 [US2] Create `src/routes/(app)/employees/new/+page.server.ts`: `requireRole(HR_ADMIN, SUPER_ADMIN)`; `action: create` — Zod validate, call `employees.create()`, auto-generate `EMP-XXXX` number, call `notifications.sendWelcomeEmail()` stub
- [ ] T054 [P] [US2] Create `src/routes/(app)/employees/[id]/+page.svelte`: full employee profile — employment details (read-only for non-admin), editable fields for HR Admin, offboard button
- [ ] T055 [US2] Create `src/routes/(app)/employees/[id]/+page.server.ts`: `load` — `employees.getById()`, ownership check for EMPLOYEE role; `action: update` — `requireRole(HR_ADMIN, SUPER_ADMIN)`, call `employees.update()`; `action: offboard` — call `employees.offboard()`, deactivate linked User
- [ ] T056 [P] [US2] Create `src/routes/(app)/departments/+page.svelte`: department list with create form inline, edit capability
- [ ] T057 [US2] Create `src/routes/(app)/departments/+page.server.ts`: `requireRole(HR_ADMIN, SUPER_ADMIN)` for mutations; `load` — `departments.list()`; `action: create`, `action: update`
- [ ] T058 [P] [US2] Create `src/routes/api/v1/employees/+server.ts`: `GET` (list, filterable), `POST` (create); role enforcement
- [ ] T059 [P] [US2] Create `src/routes/api/v1/employees/[id]/+server.ts`: `GET`, `PATCH` (update), `POST` offboard action
- [ ] T060 [P] [US2] Create `src/lib/server/notifications.ts`: stub functions `sendWelcomeEmail(employee, tempPassword)`, `sendTimesheetStatusEmail(employee, status)`, `sendLeaveStatusEmail(employee, status, reason?)` — log to console in v1

**Checkpoint**: HR Admin can complete full employee lifecycle (create → update → offboard) independently of manager approvals and payroll.

---

## Phase 5: User Story 3 — Manager: Timesheet & Leave Approval (Priority: P3)

**Goal**: Manager sees pending approvals from direct reports, approves/rejects with comments, views team attendance.

**Independent Test**: Log in as manager → view approvals queue → approve a seeded SUBMITTED timesheet → verify employee's timesheet status changes to APPROVED → reject a leave request with reason → verify employee sees rejection reason.

- [ ] T061 Extend `src/lib/server/services/timesheets.ts`: add `getPendingForManager(db, managerId)`, `approve(db, id, actor)`, `reject(db, id, reason, actor)` — all write AuditLog; `approve` also notifies employee
- [ ] T062 Extend `src/lib/server/services/leave.ts`: add `getPendingForManager(db, managerId)`, `approve(db, id, actor)` (deducts LeaveBalance), `reject(db, id, reason, actor)`, `overrideApprove(db, id, note, actor)` — writes `LEAVE_OVERRIDE` AuditLog entry
- [ ] T063 [P] [US3] Create `src/lib/components/approvals/ApprovalCard.svelte`: card showing submitter name, period/dates, hours/days, approve + reject buttons; reject reveals inline reason textarea
- [ ] T064 [P] [US3] Create `src/routes/(app)/approvals/+page.svelte`: tabbed layout (Timesheets | Leave), lists ApprovalCards for each pending item, shows count badge per tab
- [ ] T065 [US3] Create `src/routes/(app)/approvals/+page.server.ts`: `requireRole(MANAGER, HR_ADMIN, SUPER_ADMIN)`; `load` — call `getPendingForManager` / all pending for admin; `action: approveTimesheet`, `action: rejectTimesheet`, `action: approveLeave`, `action: rejectLeave`, `action: overrideLeave`
- [ ] T066 [P] [US3] Create `src/routes/(app)/team/+page.svelte`: team attendance overview — date range picker, table with employee rows and day columns, colour-coded cells (PRESENT / ABSENT / ON_LEAVE / HOLIDAY)
- [ ] T067 [US3] Create `src/routes/(app)/team/+page.server.ts`: `requireRole(MANAGER, HR_ADMIN, SUPER_ADMIN)`; `load` — query approved timesheets + leave requests for team within date range, compute per-day status per employee
- [ ] T068 [P] [US3] Create `src/routes/api/v1/timesheets/[id]/+server.ts`: `PATCH` (approve / reject actions) with role enforcement
- [ ] T069 [P] [US3] Create `src/routes/api/v1/leave/[id]/+server.ts`: `PATCH` (approve / reject / override-approve) with role enforcement

**Checkpoint**: Manager can process full approvals queue independently. Employee self-service (US1) and HR employee management (US2) can run in parallel with this story.

---

## Phase 6: User Story 4 — HR Admin: Payroll Processing (Priority: P4)

**Goal**: HR Admin computes a payroll run with PH statutory deductions, reviews flagged employees, approves, and issues payslips employees can view.

**Independent Test**: Log in as hr_admin → compute payroll for current period → verify SSS/PhilHealth/Pag-IBIG/BIR amounts for a PHP 30,000 salary employee → approve run → log in as employee → view itemized payslip.

- [ ] T070 Create `src/lib/server/services/payroll/ph-statutory.ts`: `computeSSS(monthlySalary, sssTable)`, `computePhilHealth(monthlySalary, config)`, `computePagIbig(monthlySalary, config)`, `computeBIRWithholding(taxableMonthly, birTable)`, `computeNetPay(gross, sssEe, philhealthEe, pagibigEe, tax)` — all pure functions with no side effects
- [ ] T071 Write Vitest unit tests in `tests/unit/ph-statutory.test.ts`: test each function with PHP 15,000, 30,000, and 100,000 monthly salaries; assert expected SSS, PhilHealth, Pag-IBIG, and BIR values; tests MUST fail before T070 is implemented
- [ ] T072 Create `src/lib/server/services/payroll/index.ts`: `computePayrollRun(db, organizationId, periodStart, periodEnd)` — load PayrollConfig, iterate active employees, collect approved timesheets, call ph-statutory functions, create PayrollRun + PayrollEntries, flag employees with missing/unapproved timesheets; return run with `warnings[]`
- [ ] T073 [P] [US4] Create `src/lib/server/services/payroll/runs.ts`: `listRuns(db, organizationId, filters)`, `getRunWithEntries(db, id)`, `approveRun(db, id, actor, overrideNote?)` — validates overrideNote required when flagged entries exist, writes `PAYROLL_OVERRIDE` AuditLog, triggers payslip visibility
- [ ] T074 [P] [US4] Create `src/lib/components/payroll/PayslipDetail.svelte`: itemized payslip component — earnings table (basic pay, gross), deductions table (SSS, PhilHealth, Pag-IBIG, tax, total), net pay highlight
- [ ] T075 [P] [US4] Create `src/routes/(app)/payroll/+page.svelte`: payroll runs list with status badges, period dates, total net pay, "Compute New Run" button
- [ ] T076 [US4] Create `src/routes/(app)/payroll/+page.server.ts`: `requireRole(HR_ADMIN, SUPER_ADMIN)`; `load` — `listRuns()`; `action: compute` — Zod validate period, call `computePayrollRun()`, redirect to run detail
- [ ] T077 [P] [US4] Create `src/routes/(app)/payroll/[id]/+page.svelte`: run detail — summary totals, employee entries table with flagged warning rows, approve button (shows override note textarea when warnings exist)
- [ ] T078 [US4] Create `src/routes/(app)/payroll/[id]/+page.server.ts`: `requireRole(HR_ADMIN, SUPER_ADMIN)`; `load` — `getRunWithEntries()`; `action: approve` — Zod validate overrideNote when flags exist, call `approveRun()`; `action: void` — `requireRole(SUPER_ADMIN)` only
- [ ] T079 [P] [US4] Create `src/routes/(app)/payroll/config/+page.svelte`: config form — pay frequency, cutoff dates, PhilHealth/Pag-IBIG rate inputs, SSS table JSON editor, BIR table JSON editor
- [ ] T080 [US4] Create `src/routes/(app)/payroll/config/+page.server.ts`: `requireRole(SUPER_ADMIN)`; `load` — PayrollConfig; `action: update` — Zod validate, update config, writeAuditLog UPDATE
- [ ] T081 [P] [US4] Create `src/routes/(app)/payslips/+page.svelte`: employee's payslip list — period, gross, net per row, link to detail
- [ ] T082 [US4] Create `src/routes/(app)/payslips/+page.server.ts`: `load` — fetch own PayrollEntries from APPROVED runs, sorted by period descending
- [ ] T083 [P] [US4] Create `src/routes/(app)/payslips/[id]/+page.svelte`: renders PayslipDetail component with data
- [ ] T084 [US4] Create `src/routes/(app)/payslips/[id]/+page.server.ts`: `load` — fetch PayrollEntry, ownership check (employee can only see own payslip)
- [ ] T085 [P] [US4] Create `src/routes/api/v1/payroll/+server.ts`: `GET` (list runs), `POST` (compute run)
- [ ] T086 [P] [US4] Create `src/routes/api/v1/payroll/[id]/+server.ts`: `GET` (run + entries), `POST` (approve / void)
- [ ] T087 [P] [US4] Create `src/routes/api/v1/payroll/payslips/[id]/+server.ts`: `GET` itemized payslip JSON with ownership enforcement

**Checkpoint**: Full payroll cycle works end-to-end. Employee can view their payslip. PH statutory calculations verified by unit tests.

---

## Phase 7: User Story 5 — Dashboards & Reports (Priority: P5)

**Goal**: Role-appropriate dashboard on login; HR Admin can generate and export headcount, attendance, payroll cost, and leave utilization reports.

**Independent Test**: Log in as hr_admin → open dashboard → verify headcount and next payroll date are correct → generate headcount report for last 3 months → export CSV → open file and verify columns and data.

- [ ] T088 Create `src/lib/server/services/dashboard.ts`: `getEmployeeMetrics(db, userId)`, `getManagerMetrics(db, managerId)`, `getAdminMetrics(db, organizationId)` — each function checks Redis cache (`dashboard:{role}:{id}`, 5-min TTL) before querying DB
- [ ] T089 Create `src/lib/server/services/reports.ts`: `generateHeadcount(db, filters)`, `generateAttendance(db, filters)`, `generatePayrollCosts(db, filters)`, `generateLeaveUtilization(db, filters)`, `exportToCSV(data, columns)` — returns structured data objects and CSV string respectively
- [ ] T090 [P] [US5] Create `src/lib/components/charts/HeadcountTrend.svelte`: layerchart line chart for headcount over time, accepts `{ period, headcount }[]` prop
- [ ] T091 [P] [US5] Create `src/lib/components/charts/PayrollCostBar.svelte`: layerchart bar chart for payroll costs by department, accepts `{ department, totalGross }[]` prop
- [ ] T092 [P] [US5] Create `src/routes/(app)/dashboard/+page.svelte`: role-conditional layout — employee panel (timesheet status, leave balance, next payroll), manager panel (pending approvals count, team headcount), admin panel (total headcount, on-leave today, pending approvals, open job postings, charts)
- [ ] T093 [US5] Create `src/routes/(app)/dashboard/+page.server.ts`: `load` — call the appropriate `dashboard.*Metrics()` function based on `locals.user.role`
- [ ] T094 [P] [US5] Create `src/routes/(app)/reports/+page.svelte`: report type selector cards (Headcount, Attendance, Payroll Costs, Leave Utilization, Audit Log)
- [ ] T095 [US5] Create `src/routes/(app)/reports/+page.server.ts`: `requireRole(HR_ADMIN, SUPER_ADMIN)`; `load` — pass available report types to page
- [ ] T096 [P] [US5] Create `src/routes/(app)/reports/[type]/+page.svelte`: filter controls (date range, department), data table with pagination, "Export CSV" button
- [ ] T097 [US5] Create `src/routes/(app)/reports/[type]/+page.server.ts`: `requireRole(HR_ADMIN, SUPER_ADMIN)`; `load` — call the matching `reports.generate*()` function with filters from URL params
- [ ] T098 [P] [US5] Create `src/routes/(app)/reports/audit-log/+page.svelte`: audit log viewer — actor filter, entity type filter, action filter, date range, paginated table
- [ ] T099 [US5] Create `src/routes/(app)/reports/audit-log/+page.server.ts`: `requireRole(HR_ADMIN, SUPER_ADMIN)`; `load` — paginated AuditLog query; redact `oldValue`/`newValue` for HR_ADMIN (visible only to SUPER_ADMIN)
- [ ] T100 [P] [US5] Create `src/routes/api/v1/reports/[type]/+server.ts`: `GET` JSON report data; `GET ?export=csv` — return CSV with `Content-Disposition: attachment` header
- [ ] T101 [P] [US5] Create `src/routes/api/v1/dashboard/+server.ts`: `GET` role-aware metrics JSON (uses same dashboard service functions)

**Checkpoint**: Dashboard shows correct live metrics. All four reports generate and export correctly. Audit log is accessible and read-only.

---

## Phase 8: User Story 6 — Recruitment (Priority: P6)

**Goal**: HR Admin creates job postings, tracks applicants through stages, and converts a hired candidate to an employee.

**Independent Test**: Log in as hr_admin → create an "OPEN" job posting → submit a test application with resume → advance applicant through all stages to HIRED → convert to employee → verify new employee record exists with pre-populated data.

- [ ] T102 Create `src/lib/server/services/recruitment.ts`: `listPostings(db, filters)`, `createPosting(db, data, actor)`, `updatePosting(db, id, data, actor)`, `listApplicants(db, postingId, filters)`, `createApplicant(db, postingId, data)`, `advanceStage(db, applicantId, stage, notes, actor)`, `convertToEmployee(db, applicantId, employmentData, actor)` — calls `writeAuditLog` on mutations and `employees.create()` on conversion
- [ ] T103 [P] [US6] Create `src/lib/components/recruitment/ApplicantKanban.svelte`: kanban board with columns per stage (Applied, Screening, Interview, Offer, Hired, Rejected), draggable applicant cards (or click-to-advance for simplicity in v1)
- [ ] T104 [P] [US6] Create `src/routes/(app)/recruitment/+page.svelte`: job postings list with status badges (DRAFT, OPEN, CLOSED), applicant count per posting, "New Posting" button
- [ ] T105 [US6] Create `src/routes/(app)/recruitment/+page.server.ts`: `load` — `listPostings()`; employees see OPEN only, HR Admin sees all; `action: create` — `requireRole(HR_ADMIN, SUPER_ADMIN)`, Zod validate, call `createPosting()`
- [ ] T106 [P] [US6] Create `src/routes/(app)/recruitment/[id]/+page.svelte`: posting detail header, ApplicantKanban, "Add Applicant" button, "Close Posting" button
- [ ] T107 [US6] Create `src/routes/(app)/recruitment/[id]/+page.server.ts`: `load` — posting + applicants grouped by stage; `action: updateStatus` — `requireRole(HR_ADMIN, SUPER_ADMIN)`, call `updatePosting()`; `action: advanceStage` — call `recruitment.advanceStage()`; `action: convert` — call `convertToEmployee()`, redirect to new employee profile
- [ ] T108 [P] [US6] Create `src/routes/(app)/recruitment/[id]/apply/+page.svelte`: public-style application form (name, email, phone, cover letter, resume upload)
- [ ] T109 [US6] Create `src/routes/(app)/recruitment/[id]/apply/+page.server.ts`: `action: apply` — parse multipart form, save resume PDF to `static/uploads/{uuid}.pdf` (max 5MB), call `recruitment.createApplicant()`
- [ ] T110 [P] [US6] Create `src/routes/api/v1/recruitment/+server.ts`: `GET` postings, `POST` create posting
- [ ] T111 [P] [US6] Create `src/routes/api/v1/recruitment/[id]/applicants/+server.ts`: `GET` list applicants, `POST` add applicant, `PATCH` advance stage, `POST /convert` convert to employee

**Checkpoint**: Full recruitment flow works end-to-end. Converted hire creates a valid Employee record that can log in.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Hardening, validation, and observability across all stories.

- [ ] T112 [P] Create Zod validation schemas in `src/lib/server/schemas/`: `employees.ts`, `timesheets.ts`, `leave.ts`, `payroll.ts`, `recruitment.ts` — each exports request body schemas used across both page actions and API routes
- [ ] T113 [P] Add `src/routes/+error.svelte`: user-friendly error page with message and back-link for 403 (access denied), 404 (not found), and 500 (server error) using shadcn-svelte Card
- [ ] T114 [P] Add public holiday management: `src/routes/(app)/settings/holidays/+page.svelte` (date picker + name + type form, list of configured holidays) and `+page.server.ts` (`requireRole(HR_ADMIN, SUPER_ADMIN)`; CRUD on PublicHoliday table)
- [ ] T115 [P] Add rate limiting to login form action in `src/routes/(auth)/login/+page.server.ts`: track failed attempts per email in Redis (key: `login_failures:{email}`), lock for 15 minutes after 5 consecutive failures
- [ ] T116 [P] Add loading skeletons to all list pages using shadcn-svelte Skeleton: employees list, timesheets list, approvals queue, payroll runs list, reports table
- [ ] T117 [P] Add Redis caching to report service in `src/lib/server/services/reports.ts`: cache generated report JSON for 60 seconds (key: `report:{type}:{filtersHash}`) to satisfy SC-005
- [ ] T118 Security audit: review all `+server.ts` and `+page.server.ts` files — verify every mutating route has `requireRole()` call, every employee-scoped route has ownership check, no PII fields returned to unauthorized roles
- [ ] T119 [P] Write Playwright E2E tests in `tests/e2e/` covering all 8 quickstart scenarios from `quickstart.md`: login, onboard employee, submit timesheet, approve timesheet, leave request, payroll run, dashboard metrics, audit log integrity

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — **blocks all user stories**
- **US1 (Phase 3)**: Depends on Phase 2; no dependency on US2, US3, US4, US5, US6
- **US2 (Phase 4)**: Depends on Phase 2; no dependency on other stories
- **US3 (Phase 5)**: Depends on Phase 2; requires US1 to have SUBMITTED timesheets/leave available (use seeded data)
- **US4 (Phase 6)**: Depends on Phase 2; requires APPROVED timesheets (US3 or seeded approvals)
- **US5 (Phase 7)**: Depends on Phase 2; best tested after US1–US4 produce operational data
- **US6 (Phase 8)**: Depends on Phase 2 + US2 (`employees.create` is reused in conversion)
- **Polish (Phase 9)**: Depends on all user story phases

### User Story Independence

- **US1 (P1)**: Can start after Phase 2 — no story dependencies
- **US2 (P2)**: Can start after Phase 2 — no story dependencies
- **US3 (P3)**: Can start after Phase 2 — uses seeded timesheets/leave for approval testing
- **US4 (P4)**: Can start after Phase 2 — uses seeded approved timesheets for payroll
- **US5 (P5)**: Can start after Phase 2 — uses seeded data for dashboard/report testing
- **US6 (P6)**: Can start after Phase 2 — conversion calls `employees.create` (implement US2 service first if parallelising)

### Within Each Story

- Service functions before route handlers
- Components (marked [P]) can be built alongside services
- API routes (marked [P]) can be built in parallel with page routes

### Parallel Opportunities

All [P]-marked tasks within a phase can run concurrently (they touch different files). Cross-story [P] tasks can run across phases once the foundational phase is complete.

---

## Implementation Strategy

### MVP First (US1 — Employee Self-Service Only)

1. Complete Phase 1 (Setup)
2. Complete Phase 2 (Foundational) — CRITICAL gate
3. Complete Phase 3 (US1) — T031–T046
4. **STOP AND VALIDATE**: employee logs in, submits timesheet, files leave, views profile
5. Demo / deploy MVP

### Incremental Delivery

1. Setup + Foundational → working auth, RBAC, audit log
2. US1 → employee self-service functional → MVP ✅
3. US2 → HR Admin can manage employees
4. US3 → Manager approvals activate US1 workflows
5. US4 → Payroll unlocked (depends on approved timesheets from US3)
6. US5 → Dashboard and reports operational
7. US6 → Recruitment pipeline
8. Polish → hardening, E2E tests, caching

### Parallel Team Strategy

With multiple developers (after Phase 2 complete):
- Developer A: US1 (Employee Self-Service)
- Developer B: US2 (HR Admin Employee Management)
- Developer C: US6 (Recruitment — independent of US3–US5)
- Once US1+US3 done → Developer D: US4 (Payroll)
- Once data exists → Developer E: US5 (Dashboard/Reports)

---

## Notes

- [P] = different files, no incomplete dependencies — safe to parallelise
- [USN] label maps each task to its user story for traceability
- Tests (T071) MUST be written and FAIL before T070 implementation
- Commit after each phase checkpoint
- `src/lib/server/` files are never bundled to the client (SvelteKit enforces this)
- Never import from `$lib/server/` in `.svelte` files or client-side `+page.ts` files
- Run `npx prisma generate` after any schema change before starting the dev server
