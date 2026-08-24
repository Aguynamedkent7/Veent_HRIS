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
