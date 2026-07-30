# Handoff — Veent HRIS

**Branch**: `staging` · **Last updated**: 2026-07-28 (through PR #216)

> This file was rebuilt from the actual `staging` state and the merged-PR history. The prior
> version was frozen at `dev/attendance` / 2026-07-14 and had drifted ~30 PRs out of date.

## ⚠️ Environment note (read first)

- **DB is on port 5434** (container `veent-db-5434`, user/pass `veent`, db `veent_hris`). `.env.dev`'s
  `DATABASE_URL` points to `localhost:5434/veent_hris`, and `./start.sh` loads it explicitly
  (`dotenv -e .env.dev`) since prisma no longer auto-loads a plain `.env`. `start.sh` brings up the
  container, syncs the schema, seeds if empty, and runs `pnpm dev` + `pnpm bot`. The dev container
  binds to localhost only and must never be reused outside local development. (Port moved off 5433 to
  avoid a clash with the `veent_wifiportal-db-1` container, which publishes host :5433.)
- **The DB container uses `--network host`** (Postgres binds the host directly via `-c port=5434`),
  _not_ `-p` bridge publishing — so it never depends on the `docker0` bridge (which is kept
  down/IP-less here to stop it shadowing `wlan0`). If you have an old bridge-mode container, recreate
  it once: `docker rm -f veent-db-5434 && ./start.sh`. `start.sh` probes host→DB reachability and
  fails loudly (instead of hanging on Prisma P1001) if the path is broken.
- **After pulling, run `pnpm db:push`** (or `./start.sh`) to apply schema changes, then restart
  `pnpm dev` — the running server caches the Prisma client and will 500 on new columns until
  restarted.
- **⚠️ Enum rename requires a migration script, not just `db:push` (#172).** `EmploymentType.FULL_TIME`
  was renamed to **`REGULAR`**. Renaming a Postgres enum value drops/recreates the type, which
  `db:push` cannot do against existing data. On any DB that predates #172, run
  `pnpm tsx scripts/migrate-employment-type-regular.ts` **before** the push. Fresh/seeded DBs are fine.
- Seeded logins (CEO, Super Admin, Manager, Employee, Payroll Officer, Finance) are created by
  `prisma/seed.ts` — see the seed script for the local-only credentials. Development defaults only;
  never commit real passwords.
- **Multi-tenant shape (#131/#140/#144)**: the seed provisions three tenants under the **Avipa**
  brand — **Veent** (tech/office), **JoJo Potato** and **Sweetleaf** (food service, each with an
  on-branch **Manager = "Head of Operations"** who is that branch's HR, plus reporting crew). A
  single **CEO** account is a member of all three and switches tenants via the header dropdown; the
  CEO is the exclusive role-changer (`MANAGE_USER_ROLES`) and the finance sign-off authority (#174).
  Log in through the Avipa tenant selector: pick the company first, then enter credentials. The seed
  also backfills `/payroll/periods` with the last 6 months (two rows/month: 1–15 and 16–EOM) per org,
  and seeds per-org departments (#181). Food-service tenants also carry **physical store branches**
  (#156) and the Team roster is relabeled "Branches" for them (#182).

## Deployment

- **Dockerized (#151/#153)**: app + Postgres containers, env split. **CI builds the image and pushes
  to GHCR; the DigitalOcean droplet pulls and restarts** (build-in-CI, not on the droplet). App binds
  to localhost on the droplet behind the reverse proxy (#155).

## Schema highlights (current)

Newer models/enums beyond the original core (all in `prisma/schema.prisma`):

- **Tenancy/structure**: `Branch` (physical stores), `PayRateRule`, per-org `employeeNumberPrefix`,
  `Employee.branchId` / `companyEmail` / additional-supervisor relations (#176).
- **Recruitment**: `JobBoard`, `PostingApprover` (posting approvals before publish, #195).
- **Lifecycle**: `OnboardingChecklistItem`, `OffboardingChecklistItem` (editable clearance, #192/#185).
- **Ops**: `InventoryItem` (inventory module, #114).
- **Enums**: `EmploymentType` = `REGULAR`, `PART_TIME`, `CONTRACTUAL`, `PROBATIONARY`, `ON_CALL`,
  `INTERN` (new hires default `PROBATIONARY`); rate basis includes `DAILY`; posting/approval states
  include `PENDING_APPROVAL`.
- **Attendance/timesheets** (carried from before, still current): `AttendanceDay.manuallyEdited`,
  `TimesheetEntry.timeIn` / `timeOut` / `otHours`.

## Feature status

The platform is **feature-complete across all HR modules** and now in a deploy/hardening phase. Every
domain has working services **and** UI pages: Employees/201 file (contacts, docs, bank, history,
benefit enrollments), Attendance (Discord punch → derive → correct → lock), Timesheets, Payroll
(calculator engine, standardized periods, runs, PDF payslips, approval chain, PH statutory),
Leave/Requests (three-stage maker-checker), Recruitment (posting approvals → applicant → interview →
offer → convert), Onboarding & Separation (editable checklists + emails), Benefits, Performance
reviews, Reports, Org chart, RBAC, Audit log, Inventory, and a rebuilt Dashboard.

### Landed since the last handoff (merged into `staging`, #144–#216)

- **Security**: authz holes closed — recruitment authz + payslip IDOR (#213), loan IDOR / temp-password
  logging / CSV injection (#128), data-exposure/replay/tenancy audit batches (#125/#126), upload
  hardening — magic bytes, nosniff, orphan sweep (#93).
- **Payroll**: auto-compute on run create + cross-midnight OT (#201), approval chain (#149),
  standardized 1-15/16-EOM/whole-month periods (#146), rate-basis UI + hourly-aware rates + net floor
  (#147), double-deduction/exact-decimal fixes (#143), idempotent loan amortization + holiday-aware
  compute (#130), recurring allowances/incentives (#77), PDF payslip matching the paper template
  (#127), finance sign-off routed to CEO/Super Admin (#174).
- **Tenancy/auth**: three-org rollout + CEO role + Manager promotion + Verifier/Approver (#144),
  Avipa login + per-org branding + seed (#149), physical store branches (#156).
- **Dashboard rebuild (#216 + #211)**: today's-state layout, upcoming events, birthday greetings,
  employee awards, probationary-regularization warnings, payslip-release notices, Recent Activity,
  announcement authorship.
- **Employees/lifecycle**: tenure/regularization (#136), 5/5/5 leave + SIL gate (#137/#150), additional
  supervisors (#176), government-ID/disbursement validation, offboarded roster section (#184),
  onboarding company email + Discord invite (#186), interview emails (#196).
- **Modules added**: Inventory (#114), HR complaints, job-board tracking (#117), leave-types &
  pay-multiplier settings (#48–#50).

### Tests / CI

`format:check` ✅ · `lint` ✅ · `check` (typecheck) ✅ · **~54 unit test files + ~26 e2e specs** —
including the timesheet/attendance e2e flows that the old handoff listed as "none yet"
(`timesheet-punch`, `timesheet-approval`, `timesheet-create-for-employee`, `manager-org-wide-timesheets`).
Run `pnpm test` for the live pass count before relying on a number.

## ⏳ Not done yet / deferred

1. **External integrations (explicitly deferred in the spec)** — bank-file / GCash disbursement export
   (T175, FR-065); publishing postings to external job boards (T179, FR-070). The internal `JobBoard`
   tracking model exists; the outbound push does not.
2. **Doc reconciliation** — `specs/001-hris-platform/tasks*.md` checkboxes are still stale (many
   `[ ]` items are shipped, e.g. T130/T137/T138/T157–160). This file has been rebuilt; the tasks
   files have not.
3. **Promote `staging` → `main`** — `main` is frozen at #152 (2026-07-21), ~49 commits behind
   `staging`. All the work above lives on `staging`.

## Known gotchas

- **Attendance-driven payroll**: no punches = ₱0 pay; monthly-salaried staff must be marked present
  before lock. Unassigned employees derive against the org default schedule (#148).
- **Unpaid meal break IS deducted now (#83)**: per Labor Code Art. 85, a 12:00–13:00 lunch is netted
  once the employee works **more than 5 hours** (a short day is not docked). A full 8:00–17:00 day =
  **8 regular hours**, not 9. Regular window is 08:00–17:00; time outside it is OT (overridable in the
  timesheet modal's `recalcRow`). _(This reverses the old handoff's "no lunch deduction" note.)_
- Manually-edited attendance days are sticky through Refresh until per-row **Reset**.
- The floating timesheet modal renders all entry rows at once — fine to ~a month; virtualize for
  multi-hundred-row sheets.
