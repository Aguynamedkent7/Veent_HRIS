---
phase: sections-a-b
date: 2026-08-24
status: COMPLETE
feature: hr-complaints-112
plan: process/general-plans/active/hr-complaints-112_24-08-26/hr-complaints-112_PLAN_24-08-26.md
---

# EXECUTE report — Sections A and B (#112)

Scope of this run: Implementation Checklist steps 1–12 only. Sections C, D, E, F not started.
No commit made (orchestrator owns the commit).

## What Was Done

### Section A — make it compile (steps 1–8)

| Step | File | Change |
|---|---|---|
| 1 | `src/lib/server/services/types.ts` | Read only. `actorRoles: Role[]` confirmed required. No change. |
| 2 | `src/routes/(app)/complaints/+page.server.ts` | Deleted the dead `const roles = user.roles?.length ? user.roles : [user.role]` in `load`; `isHr` now reads `canAny(user.roles, 'MANAGE_HR')`. **[T10, T11]** |
| 3 | same file, `open` action | Deleted the dead `roles` const; guard is `if (!canAny(user.roles, 'MANAGE_HR'))`. **[T16, T17]** |
| 4 | same file, `open` ctx literal | `actorRole: user.role` → `actorRoles: user.roles`. **[T18]** |
| 5 | `src/routes/(app)/complaints/[id]/+page.server.ts` | Deleted all three dead `roles` consts (`load`, `reply`, `resolve`); all three now use `user.roles` directly. **[T19, T22, T25]** |
| 6 | same file, `reply` + `resolve` ctx literals | `actorRole: user.role` → `actorRoles: user.roles` (both). **[T24, T26]** |
| 7 | `tests/unit/complaints.test.ts:28` | `actorRole: 'HR_ADMIN'` → `actorRoles: ['HR_ADMIN']`. **[T27]** |
| 7b | `src/routes/(app)/complaints/[id]/+page.svelte` | `pnpm prettier --write` on that one file. Diff inspected: 3 insertions / 2 deletions, a whitespace reflow of one `<p>` template expression. **No logic, markup or copy change.** **[T30]** |
| 7c | `src/routes/(app)/complaints/+page.server.ts`, `[id]/+page.server.ts` | `format:check` flagged both after my edits (my `if (!canAny(...))` line wrapping). Both are files I touched, so per **E7** I prettier-wrote exactly those two and re-ran. No blanket `pnpm format`. No untouched file was ever flagged. |

Semantics are unchanged in every case: `User.roles` is a non-optional `Role[]`, so the deleted
ternary was dead in both arms.

### Section B — close the org-scoping hole (steps 9–12)

| Step | File | Change |
|---|---|---|
| 9 | `src/lib/server/services/complaints/index.ts:180-182` | `listComplaintsForEmployee(employeeId: string, organizationId: string)`; `where: { employeeId, organizationId }`. `include` and `orderBy` untouched. **[T8]** |
| 10 | `src/routes/(app)/complaints/+page.server.ts:57` | Caller now passes `user.organizationId`. Prettier wrapped the ternary onto three lines. **[T15]** |
| 11 | `tests/unit/complaints-scoping.test.ts` | **New file.** Contains test **N1** only. |
| 12 | — | Mutation **M-N1** run — see below. |

**New test file mock strategy (per E2/E3):** the complaints service is **not** mocked. The file
mocks only `$lib/server/db`, `$lib/server/audit` (via a hoisted `writeAuditLogMock`, which N15 will
consume in Section D), and `$lib/server/services/notifications`. The db mock already carries
`hrComplaint.count: vi.fn()` and `beforeEach` `mockResolvedValue(0)`s it, so `paginate(url, total)`
will not receive `undefined` when N13 lands. `$lib/server/services/employee-access` is **not** yet
mocked here — nothing in Section B calls it; it is a Section C addition.

**Mock-discipline note (plan §"Mock discipline"):** N1 asserts on
`dbMock.hrComplaint.findMany.mock.calls[0][0].where` — the arguments the query was **built** with —
never on returned rows. The `project()` helper from `approval-queues.test.ts` is a returned-shape
tool and is deliberately not used here.

## Test Gate Outcomes

### Gate A (literal output)

`pnpm prisma generate && pnpm check`:
```
1787538173342 COMPLETED 984 FILES 0 ERRORS 1 WARNINGS 1 FILES_WITH_PROBLEMS
```
The 1 warning is the pre-existing a11y warning on `CalculatorWindow.svelte:82` — not mine, present
in the baseline. **0 errors** (baseline was 12, at exactly the lines Section A names).

`pnpm test`:
```
 Test Files  153 passed (153)
      Tests  1713 passed (1713)
```

`pnpm format:check`:
```
Checking formatting...
All matched files use Prettier code style!
```

**Gate A: GREEN.** Section B was not started until this was true.

### Gate B — mutation M-N1

Backup taken first: `cp src/lib/server/services/complaints/index.ts <scratchpad>/complaints-index.ts.bak`.
Restored with `cp` from that backup. **`git checkout` / `git restore` were never used.**

**M-N1 — mutated state (deleted `organizationId` from the `where` at `index.ts:182`): RED.**
```
AssertionError: expected { employeeId: 'emp1' } to deeply equal { employeeId: 'emp1', …(1) }

- Expected
+ Received

  Object {
    "employeeId": "emp1",
-   "organizationId": "org1",
  }

 ❯ tests/unit/complaints-scoping.test.ts:45:62

 Test Files  1 failed (1)
      Tests  1 failed (1)
```

**M-N1 — restored state: GREEN.**
```
 Test Files  154 passed (154)
      Tests  1714 passed (1714)
```
(153 baseline files + `complaints-scoping.test.ts`; 1713 + N1 = 1714.)

Post-restore `pnpm check`: `COMPLETED 985 FILES 0 ERRORS 1 WARNINGS`.
Post-restore `pnpm format:check`: `All matched files use Prettier code style!`

**Gate B: GREEN.** M-N1 recorded RED under mutation, GREEN restored — the test is not vacuous.

## What Was Skipped or Deferred

- Sections **C, D, E, F** — out of this run's scope by instruction. Mutations M-N2 … M-N17 (19 of
  the 20) are **not** run; only M-N1 is recorded.
- `src/routes/(app)/reports/audit-log/+page.server.ts` (T29, Section D) — **not touched**, as
  instructed.
- Gate E preconditions (`./start.sh`, `pnpm db:push`, `pnpm db:seed:e2e`, `pnpm dev`) — not run.
  Not needed for Gates A–B; the unit suite mocks Prisma.

## Plan Deviations

None material. One mechanical note:

- **Line wrapping.** Replacing `roles` with `user.roles` pushed two `if (!canAny(...)) return fail(...)`
  statements and one `listComplaintsForEmployee(...)` ternary past Prettier's print width, so
  Prettier rewrapped them onto multiple lines. This is formatting forced by the plan's own edits,
  applied via the E7 procedure (prettier-write a file **you touched**, then re-run). Within
  blast radius, no semantic change.

## Test Infra Gaps Found

None new. Recorded residuals carried forward for the EXECUTE report at the end of the program:

- **G6 (E9) — the `AND: [...]` intersection residual.** Not yet in play: T9 is a Section C step and
  `complaintWhere` is untouched in this run. The dead `filters.employeeId` field is **left alone**
  per E9 — deleting it is a scope change requiring a decision.
- N1 proves what the query **asked for**, not what Postgres **returns**. The DB is mocked
  (`all-tests.md:108`). Nothing in Sections A–B is live-verified.

## Closeout Packet

- **Selected plan:** `process/general-plans/active/hr-complaints-112_24-08-26/hr-complaints-112_PLAN_24-08-26.md`
- **Finished:** Section A (steps 1–8) VERIFIED via Gate A; Section B (steps 9–12) VERIFIED via Gate B.
- **Verified:** `pnpm check` 0 errors, `pnpm test` 154 files / 1714 tests, `pnpm format:check` 0,
  M-N1 RED-then-GREEN.
- **Still unverified:** everything from Section C onward — per-employee scoping, the 19 remaining
  mutations, the live Gate E, `pnpm lint` (not run this session; it was green at baseline and no
  lint-relevant construct was introduced).
- **Cleanup remaining:** none. Working tree holds only the intended edits; scratchpad backup can be
  discarded once Section C starts (or kept — it is the pre-Section-C state of the service file).
- **Next valid state:** `Keep in active/testing` — the plan is mid-flight, Sections C–F remain.

## Forward Preview

### Test Infra Found
`tests/unit/complaints-scoping.test.ts` now exists with the db/audit/notifications mock scaffold
already shaped for Sections C and D: hoisted `dbMock` (incl. `hrComplaint.count` +
`employee.findMany`), hoisted `writeAuditLogMock`, hoisted `notifyMock`. Section C must add
`vi.mock('$lib/server/services/employee-access', …)` with a hoisted `assertCanTouchEmployee` fn, and
must add the same mock to `tests/unit/complaints.test.ts` (T28) or its six existing tests break the
moment the service starts calling `assertCanTouchEmployee`.

### Blast Radius Changes
Files changed this run: 5 of the plan's 7 (+1 new). Untouched so far:
`src/routes/(app)/reports/audit-log/+page.server.ts`, `tests/unit/audit-log-reveal.test.ts`.

### Commands to Stay Green
```bash
pnpm check          # 0 errors
pnpm test           # 154 files / 1714 tests
pnpm format:check   # 0
```

### Dependency Changes
None. No package added, no schema touched, `prisma/schema.prisma` untouched, no `db:push` run.

---

# EXECUTE report — Section C (#112)

Scope of this run: Implementation Checklist steps 13–21 only, ending at Gate C. Sections D, E, F
not started (no T29, no N2–N17, no Gate E preconditions, no `db:push`, no seed, no dev server).
No commit made (orchestrator owns the commit).

## What Was Done

### Section C — per-employee scoping (steps 13–21)

| Step | File | Change |
|---|---|---|
| 13 | `src/lib/server/services/complaints/index.ts` | Added `import { canAny } from '$lib/rbac'` and `import { assertCanTouchEmployee } from '$lib/server/services/employee-access'`. **[T1]** |
| 14 | same file, `ComplaintFilters` | Added `employeeIds?: string[]` with a doc-comment saying `null` from `listVisibleEmployeeIds` means unrestricted so the caller omits the field. **[T2]** |
| 15 | same file, above `openComplaint` | Added exported `assertCanReachComplaint(ctx, complaintEmployeeId, actorEmployeeId)`. **Two arms**, exactly as Decision 1 specifies: `canAny(ctx.actorRoles,'MANAGE_HR')` → `assertCanTouchEmployee({id: ctx.actorId, roles: ctx.actorRoles, organizationId: ctx.organizationId}, complaintEmployeeId)`; otherwise `actorEmployeeId !== complaintEmployeeId` → `error(403,'You do not have access to this inquiry.')`. Doc-comment names #112/#228, cites `rbac.ts:29-36`, states why the `else` arm is not `assertCanTouchEmployee` (it admits `reportsToId` reports regardless of role, so a plain EMPLOYEE supervisor would reach their report's thread), and why the check lives in the service. **[T3]** |
| 16 | `openComplaint` | `await assertCanReachComplaint(ctx, employee.id, null)` placed **after** the org 404 and **before** `db.hrComplaint.create`. Comment records the ordering reason (out-of-org id stays 404, never 403) and why `null` is passed (opening is HR-only). **[T4]** |
| 16 | `postComplaintMessage` | `await assertCanReachComplaint(ctx, complaint.employeeId, actorEmployeeId)` after the 404 **and** after the 400 already-resolved check. **[T5]** |
| 16 | `resolveComplaint` | `await assertCanReachComplaint(ctx, complaint.employeeId, null)` after the 404 and **above** the `if (complaint.status === 'RESOLVED') return complaint` early return. Comment records why. **[T6]** |
| 16 | `getComplaint` | Signature is now `(id: string, ctx: AuditContext, actorEmployeeId: string \| null)`; `where` uses `ctx.organizationId`; the admission call sits after the 404 and before the return. **[T7]** |
| 17 | same file, `complaintWhere` | Kept `...(filters.employeeId && { employeeId: filters.employeeId })` **unchanged** and added a **separate** `...(filters.employeeIds && { AND: [{ employeeId: { in: filters.employeeIds } }] })`. Comment states narrow-vs-ceiling and that a scoping filter must never widen. The dead `filters.employeeId` field was **left in place** per E9. **[T9]** |
| 18 | `src/routes/(app)/complaints/+page.server.ts` | Imported `listVisibleEmployeeIds`; in the HR branch `const visibleIds = await listVisibleEmployeeIds(user)`; `const filters = { status, ...(visibleIds && { employeeIds: visibleIds }) }`, threaded into **both** `countComplaintsForOrg` and `listComplaintsForOrg` (they share the one `filters` variable); the employee-dropdown `where` gained `...(visibleIds && { id: { in: visibleIds } })`. Written with plain `visibleIds &&`, **never** `visibleIds?.length &&` — `[]` stays truthy and the filter stays emitted (fail-closed). **[T12, T13, T14]** |
| 19 | `src/routes/(app)/complaints/[id]/+page.server.ts` `load` | Reordered: `myEmployee` resolved first, then a `ctx` of `{organizationId, actorId, actorRoles}` (no `ipAddress` — `load` has no `getClientAddress` and `getComplaint` writes no audit row), then `getComplaint(params.id, ctx, myEmployee?.id ?? null)`. The redundant `isSubject`/403 block was deleted; `{ complaint, isHr, isSubject }` is still returned unchanged for `+page.svelte`. **[T20, T21]** |
| 20 | same file, `reply` | `ctx` moved above the fetch; `.catch(() => null)` **replaced** with a `try/catch` that does `if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })` and re-throws otherwise, so a 403 stays a 403. The redundant `isSubject`/403 block deleted. **[T23]** |
| — | `tests/unit/complaints.test.ts` | Added the mandatory half of **T28**: hoisted `assertCanTouchEmployeeMock` plus `vi.mock('$lib/server/services/employee-access', …)`. Without it the six existing tests 403 the moment the service starts calling it. The `writeAuditLog` mock was left as the bare `vi.fn()` it already was — the inspectable one lives in `complaints-scoping.test.ts` (E3). |

**Files changed this run: 4.** `services/complaints/index.ts`, `complaints/+page.server.ts`,
`complaints/[id]/+page.server.ts`, `tests/unit/complaints.test.ts`. No `.svelte` file touched
(E10). `reports/audit-log/+page.server.ts` untouched (T29 is Section D, per E6). No new test
written this run.

## Test Gate Outcomes

### Gate C (literal output)

`pnpm check`:
```
1787539034675 START "/home/hyuse/Desktop/VeentApps/veent_hris"
1787539034681 WARNING "src/lib/components/payroll/CalculatorWindow.svelte" 82:2 "`<div>` with a pointerdown, pointermove or pointerup handler must have an ARIA role
https://svelte.dev/e/a11y_no_static_element_interactions"
1787539034683 COMPLETED 985 FILES 0 ERRORS 1 WARNINGS 1 FILES_WITH_PROBLEMS
```
**0 errors.** The 1 warning is the pre-existing a11y warning on `CalculatorWindow.svelte:82`,
present in the baseline and not mine.

`pnpm test`:
```
 Test Files  154 passed (154)
      Tests  1714 passed (1714)
   Duration  32.05s
```
All 6 pre-existing tests in `tests/unit/complaints.test.ts` still pass, and N1 in
`tests/unit/complaints-scoping.test.ts` still passes.

`pnpm format:check`:
```
Checking formatting...
All matched files use Prettier code style!
```

**Gate C: GREEN.**

#### format:check intermediate run (E7 procedure, recorded)

The first `pnpm format:check` after the Section C edits flagged exactly one file:
```
[warn] src/lib/server/services/complaints/index.ts
[warn] Code style issues found in the above file. Run Prettier with --write to fix.
```
That is a file **I touched**, so per **E7** I ran
`pnpm prettier --write "src/lib/server/services/complaints/index.ts"` — that one file only, never a
blanket `pnpm format` — and re-ran all three gates from scratch. The prettier change was one line
join on the `error(403, …)` statement; no logic change. **No untouched file was ever flagged.**

## What Was Skipped or Deferred

- **Section D** — step 21b (`'HrComplaint'` into the audit-log `entityTypes`), tests N2–N17, N15,
  N16, and Gate D's 20 mutations. Out of this run's scope by instruction. Only M-N1 (Section B)
  is recorded to date; M-N2 … M-N17 are **not** run.
- **Gate E preconditions (step 24b)** — `./start.sh`, `pnpm db:push`, `pnpm prisma generate`,
  `pnpm db:seed:e2e`, `pnpm dev` — none run. Gates A–C need none of it; the unit suite mocks Prisma.
- **Gate E, Gate F** — not run. `pnpm lint` not run this session (Gate F item; green at baseline).
- No commit. No push. No PR.

## Plan Deviations

Three, all mechanical and inside the blast radius. Nothing was widened, nothing renamed.

1. **Two orphaned symbols removed in `[id]/+page.server.ts`.** T20 deletes `load`'s
   `error(403, …)` line and T23 deletes `reply`'s `isSubject`/403 line. That left the
   `error` import (its only use was in `load`) and `reply`'s `const isHr` (its only use was in the
   deleted line) unused, which is a `pnpm check` error. Both removed. This is cleaning up orphans my
   own changes created, not an adjacent improvement. `canAny` stays imported — `load` and `resolve`
   still use it.
2. **`reply`'s 404 copy shifted by one character.** It was `fail(404, { error: 'Inquiry not
   found.' })`, hand-written in the route; it is now `fail(404, { error: 'Inquiry not found' })`
   propagated from the service's own `error(404, 'Inquiry not found')`. That is a direct consequence
   of T23's specified replacement (the whole point is to stop the route inventing its own status and
   message), not a copy edit. No trailing period.
3. **Prettier reflow of `services/complaints/index.ts`.** Formatting forced by my own edits, fixed
   via the E7 procedure. See the intermediate run above.

Things the plan warned about and that were **not** done: the two arms were not collapsed; the
`employeeIds` allow-list was not merged onto the `employeeId` key; `visibleIds?.length` was not
used anywhere; the dead `filters.employeeId` field was not deleted (E9); no guard was added for a
CEO/SUPER_ADMIN with no Employee row (`canTouchEmployee` short-circuits at `employee-access.ts:39`
before the self lookup).

## Test Infra Gaps Found

None new. Carried forward:

- **G6 (E9) — the `AND: [...]` residual, now live in the code.** `complaintWhere` is the first use
  of `AND: [...]` in this repo (`grep -rn "AND: \[" src/` was zero hits before this edit). It
  type-checks against the real `Prisma.HrComplaintWhereInput` (`pnpm check` 0 errors), but nothing
  runs it: `filters.employeeId` still has zero callers, so the intersecting path is unreachable at
  runtime and no SQL is ever emitted for it. N17 (Section D) will prove the `where` object is
  **built** correctly, not that Postgres executes it. Accepted residual; backlog note
  `complaint-filter-intersection-sql_NOTE_24-08-26.md`.
- Section C added four object-level guards and two list filters, and **none of them is proven by a
  test yet** — N2–N14 and N17 are Section D work. `pnpm test` being green here means "nothing broke",
  not "the guards hold". The guards are currently **unproven**, which is exactly what Gate D and
  Gate E exist to fix.
- The DB is mocked throughout (`all-tests.md:108`), so nothing in Sections A–C is live-verified.

## Closeout Packet

- **Selected plan:** `process/general-plans/active/hr-complaints-112_24-08-26/hr-complaints-112_PLAN_24-08-26.md`
- **Finished:** Section C (steps 13–21) `CODE DONE` and `VERIFIED` against Gate C.
- **Verified:** `pnpm check` 0 errors, `pnpm test` 154 files / 1714 tests, `pnpm format:check` clean.
- **Still unverified:** every guard added in Section C — no mutation-checked test covers them yet.
  Also unrun: T29, tests N2–N17, Gate D's 20 mutations, `pnpm lint`, and the whole live Gate E.
- **Cleanup remaining:** none. Working tree holds exactly the 4 intended modified files.
- **Next valid state:** `Keep in active/testing` — Sections D, E, F remain.

## Forward Preview

### Test Infra Found
`tests/unit/complaints-scoping.test.ts` already has the db/audit/notifications mock scaffold
(hoisted `dbMock` with `hrComplaint.count` + `employee.findMany`, hoisted `writeAuditLogMock`,
hoisted `notifyMock`). Section D must still add
`vi.mock('$lib/server/services/employee-access', …)` with a hoisted `assertCanTouchEmployee` fn to
**that** file — N2/N3/N4/N12 drive it via `mockImplementation(() => error(403, …))`, never
`mockRejectedValue`. `tests/unit/complaints.test.ts` now has its own copy of that mock (T28 half
one), so the two files do not share it.

### Blast Radius Changes
6 of the plan's 7 files touched across Sections A–C (+1 new test file). Still untouched:
`src/routes/(app)/reports/audit-log/+page.server.ts` (T29, step 21b) and
`tests/unit/audit-log-reveal.test.ts` (N16, step 23b).

### Commands to Stay Green
```bash
pnpm check          # 0 errors
pnpm test           # 154 files / 1714 tests
pnpm format:check   # clean
```

### Dependency Changes
None. No package added, no schema touched, no `db:push` run, `prisma/schema.prisma` untouched.
