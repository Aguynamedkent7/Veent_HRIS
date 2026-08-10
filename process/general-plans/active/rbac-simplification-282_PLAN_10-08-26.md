# PLAN — Collapse four authorization mechanisms to two (#282, then `User.role`)

Date: 2026-08-10
Branch: `refactor/rbac-simplification-282` (off `staging` @ `d0e5c33`)
Mode: RIPER-5 — PLAN complete, VALIDATE pending, EXECUTE not authorised.

---

## Problem

The authorization layer has FOUR overlapping mechanisms. Two answer "WHAT may you do",
two answer "WHO are you":

| # | Mechanism | Question | Live sites in `src/` |
|---|---|---|---|
| 1 | `ROLE_HIERARCHY` + `hasMinRole`/`hasAnyMinRole`/`requireAnyMinRole` (`src/lib/rbac.ts:16-39`) | "is your rank >= X?" | **66** (28 files) |
| 2 | `CAPABILITIES` + `can`/`canAny` (`src/lib/rbac.ts:53-175`) | "does your role hold capability X?" | ~88 |
| 3 | `User.role` (scalar) | identity | ~107 reads |
| 4 | `User.roles` (`Role[]`) | identity | ~174 reads — **dormant**, every writer sets one element |

Zero hardcoded role-list checks remain in `src/` (#279 cleaned those up).

Object-level access control already exists and is the answer to "WHOSE data":
`assertCanTouchEmployee` / `canTouchEmployee` (`src/lib/server/services/employee-access.ts`),
plus the `scopedToEmployee` actions wrapper (`src/routes/(app)/employees/[id]/+page.server.ts:390-401`).

### Target design

```
can(user, 'SOME_CAPABILITY')        // WHAT may you do
canTouchEmployee(user, employeeId)  // WHOSE data may you do it to
```

**Part 1 (#282)** — delete `ROLE_HIERARCHY` and the rank helpers; each of the 66 sites becomes a
capability check, an object-scope check, or both.
**Part 2** — delete the scalar `User.role`, keeping `User.roles: Role[]` as the single source of truth.

### Industry validation (research, 2026-08-10)

- Cerbos's **action-led** policy modelling ("focus on an action, list all roles that can perform
  it") is recommended exactly when actions are high-risk and roles have heavily overlapping
  capabilities. Both hold here. The existing `CAPABILITIES` table is already that shape — the
  comment at `rbac.ts:44-52` restates the same rationale, arrived at independently.
- Role hierarchy is NIST Hierarchical RBAC (RBAC1), designed for permission inheritance along org
  lines. This codebase does not use it that way: 4 of 9 roles sit at rank 0 off the ladder entirely
  and draw everything from the capability table (`rbac.ts:12-15` says so).
- The "WHOSE" check is industry-named a **derived role** (Cerbos) / **ReBAC**. Decision: keep the
  hand-rolled implementation — 9 roles, one relationship, one app; a policy engine
  (Cerbos/OpenFGA/Oso) earns its keep at 50+ roles and multi-service policy sharing. Adopt the
  vocabulary in doc comments only.
- The textbook `user_roles` junction table is **not** warranted: `Role` is a compile-time
  enum with no per-role metadata. A Postgres array column is correct.
- **Role explosion** is the named failure mode arguing against tenant-editable custom roles.
  Out of scope; see #283.

---

## Corrections to the original framing

**(a) The helper is `requireAnyMinRole`, not `requireMinRole`.** `requireMinRole` exists nowhere in
`src/` as code — only in doc comments (e.g. `src/lib/rbac.ts:23`,
`src/routes/(app)/employees/+page.server.ts:14`).

**(b) 66 live call sites, not ~20.** Verified: 61 `requireAnyMinRole(` + 5 `hasAnyMinRole(`,
excluding imports, comments, and `src/lib/rbac.ts` / `src/lib/server/rbac.ts` themselves.
28 files. This matches #282's own count. The earlier "~20" came from a grep for `requireMinRole`,
which does not match `requireAnyMinRole`.

**(c) THE KEY FINDING — every rank floor is set-identical to an existing capability.**

Only two floor values are ever passed: `'HR_ADMIN'` (54x) and `'MANAGER'` (13x). Per
`src/lib/rbac.ts:16-30`, `MANAGER = HR_ADMIN = CEO = 2`, `SUPER_ADMIN = 3`, all else `0`. Therefore:

```
clears 'MANAGER'  = {MANAGER, HR_ADMIN, CEO, SUPER_ADMIN}
clears 'HR_ADMIN' = {MANAGER, HR_ADMIN, CEO, SUPER_ADMIN}   <- identical
CAPABILITIES.MANAGE_HR (rbac.ts:55)  = ['MANAGER','HR_ADMIN','SUPER_ADMIN','CEO']  <- identical
CAPABILITIES.VIEW_TEAM (rbac.ts:77)  = ['MANAGER','HR_ADMIN','SUPER_ADMIN','CEO']  <- identical
```

`tests/unit/employee-access.test.ts:60-67` already asserts this equality live.

**Consequence:** the mechanical conversion of all 66 sites is **provably zero behaviour change**,
and **no new capability is required**. The four genuine policy questions isolate into small,
individually-approvable commits instead of being smeared across 66 sites.

---

## 1. What gets deleted

| File | Lines | What |
|---|---|---|
| `src/lib/rbac.ts` | 12-39 | `ROLE_HIERARCHY`, `hasMinRole`, `hasAnyMinRole` (~28 lines) |
| `src/lib/server/rbac.ts` | 10, 14, 15 | three re-exports |
| `src/lib/server/rbac.ts` | 36-39 | `requireAnyMinRole` |

Net ~35 lines deleted from `$lib`; 66 call sites rewritten in place (same arity, same argument,
different function name). `requireAnyCapability` (`src/lib/server/rbac.ts:32`) and `canAny`
(`src/lib/rbac.ts:162`) already exist with matching signatures.

**No new helper layer, no `Scope` enum, no new abstraction, no new dependency.**

---

## 2. Every call site, classified

Legend: **W** = WHAT only; **O** = WHOSE already answered downstream (converts as WHAT, object
scope untouched); **!** = the rank floor is the *only* object gate (see §3).

### 2a. Pure WHAT — org-level configuration. `-> requireAnyCapability(..., 'MANAGE_HR')`. Exactly equivalent.

| file:line | floor | note |
|---|---|---|
| `src/routes/(app)/attendance/+page.server.ts:167,184,203,214,265,288,303` | HR_ADMIN | W. Same file already computes `canManage = canAny(user.roles,'MANAGE_HR')` at `:36` and gates the load on it. `unlock`/`unlockTeam` (`:232,:249`) already use `OVERRIDE_FINALIZED` — leave alone. |
| `src/routes/(app)/settings/schedules/+page.server.ts:13,31,67,79` | HR_ADMIN | W |
| `src/routes/(app)/settings/org/+page.server.ts:17,61,91,124` | HR_ADMIN | W (positions, org chart, salary grades) |
| `src/routes/(app)/settings/org-chart/+page.server.ts:7` | HR_ADMIN | W |
| `src/routes/api/v1/settings/org-chart/+server.ts:8` | HR_ADMIN | W — v1 twin |
| `src/routes/api/v1/settings/positions/+server.ts:9,23` | HR_ADMIN | W |
| `src/routes/api/v1/settings/positions/[id]/+server.ts:9,24` | HR_ADMIN | W |
| `src/routes/(app)/recruitment/+page.server.ts:17,46,68,89,119` | HR_ADMIN | W — job postings are org-level |
| `src/routes/(app)/benefits/+page.server.ts:16,51,106` | HR_ADMIN | W (plan CRUD + enrollment status) |
| `src/routes/(app)/separations/+page.server.ts:10,37` | HR_ADMIN | W — see §9-R10 |
| `src/routes/(app)/separations/[id]/+page.server.ts:14,30,54` | HR_ADMIN | W |
| `src/routes/(app)/reports/+page.server.ts:14` | MANAGER | W -> `MANAGE_HR`. `:22` already narrows the *pay* report to `VIEW_PAY_ORGWIDE` (#249); HR reports stay org-wide for MANAGER deliberately. |

### 2b. WHAT, with WHOSE already enforced downstream. Convert as WHAT; do not touch the object check.

| file:line | floor | object check already running |
|---|---|---|
| `src/routes/(app)/employees/+page.server.ts:18` | MANAGER | `listVisibleEmployeeIds` `:35` -> `VIEW_TEAM` |
| `src/routes/(app)/employees/+page.server.ts:69` | MANAGER | `assertCanTouchEmployee` `:79` -> `MANAGE_HR` |
| `src/routes/(app)/employees/[id]/+page.server.ts:88` | MANAGER | `assertCanTouchEmployee` `:101` -> `VIEW_TEAM` |
| `src/routes/(app)/employees/[id]/+page.server.ts:421,483,509,558,579,597,615,633,652,671` | HR_ADMIN | all ten wrapped by `scopedToEmployee` (`:390-401`) -> `MANAGE_HR`. See §3-D. |
| `src/routes/api/v1/employees/+server.ts:12` | MANAGER | `listVisibleEmployeeIds` `:23` -> `VIEW_TEAM` |
| `src/routes/api/v1/employees/[id]/+server.ts:65` | MANAGER | `canTouchEmployee` `:78` -> `VIEW_TEAM`. Siblings at `:93,:230` already use `requireAnyCapability(...,'MANAGE_HR')`. |
| `src/routes/api/v1/requests/+server.ts:14` | MANAGER | `listVisibleEmployeeIds` + explicit id check `:27-34` (#275) -> `VIEW_TEAM` |
| `src/routes/(app)/team/+page.server.ts:10` | MANAGER | `listReportIdsFor` `:35-37`, gated on `ADMINISTER_HR_RECORDS` `:13` -> `VIEW_TEAM` |
| `src/routes/(app)/performance/+page.server.ts:24` | MANAGER | `listGoalsForManager(myEmployee.id)` `:46` self-scoped -> `VIEW_TEAM` |
| `src/lib/server/services/employees.ts:282` | HR_ADMIN | field-masking gate -> `canAny(opts.viewerRoles,'MANAGE_HR')`. Comment `:277-280` documents MANAGER is deliberately above this line. |

### 2c. WHAT, org-wide-for-MANAGER by deliberate prior decision. Convert as-is; do NOT narrow.

| file:line | floor | -> |
|---|---|---|
| `src/routes/(app)/timesheets/+page.server.ts:173,192,218` | HR_ADMIN | `MANAGE_HR` (matches `isHrAdmin` `:27`) |
| `src/routes/(app)/timesheets/+page.server.ts:317` | MANAGER | `VIEW_TEAM` (matches `isManager` `:26`) |
| `src/routes/api/v1/timesheets/+server.ts:11` | MANAGER | `VIEW_TEAM` |
| `src/routes/api/v1/timesheets/[id]/+server.ts:17` | MANAGER | `VIEW_TEAM`; per-record authority is the approval chain's |
| `src/routes/api/v1/timesheets/aggregate/+server.ts:24` | HR_ADMIN | `MANAGE_HR`; see §3-E |
| `src/routes/api/v1/leave/[id]/+server.ts:17` | MANAGER | `VIEW_TEAM`; stage authority is `decide()`'s |

> **`src/lib/server/services/timesheets.ts:100-116` is load-bearing.** It records a *deliberate
> reversal*: MANAGER was once narrowed to direct reports on timesheets and that was dropped on
> purpose, because it "failed outright for the many employees with no `reportsTo` set at all".
> Narrowing any timesheet site regresses that decision. Most likely place for a well-meaning
> reviewer to break something.

### 2d. ! The rank floor IS the object gate — three genuine leaks

| file:line | floor | what leaks today |
|---|---|---|
| `src/routes/api/v1/timesheets/[id]/punches/+server.ts:28` | HR_ADMIN | any MANAGER reads **any** employee's raw punches org-wide |
| `src/routes/(app)/performance/reviews/[id]/+page.server.ts:26` | HR_ADMIN | any MANAGER reads **any** employee's private review |
| `src/routes/api/v1/leave/[id]/+server.ts:38` | HR_ADMIN | any MANAGER may `override-approve` a leave request |

---

## 3. The decisions that change behaviour — each needs explicit user approval

Everything in §2 outside 2d is exactly equivalent. These are not.

### A. `punches/+server.ts:28` — CONFIRMED leak, recommend fixing

Current (`:26-37`) computes `isHrOrAbove = hasAnyMinRole(user.roles,'HR_ADMIN')` — which admits
MANAGER — and only falls through to a hand-rolled `isOwner || target.reportsToId === requester.id`
check when it is false. The route's own doc comment at `:10` says *"Access: the owner, the owner's
manager, HR_ADMIN, or SUPER_ADMIN."* The code admits every MANAGER to everyone.

**Proposed:** delete all twelve lines, replace with
```ts
if (!(await canTouchEmployee(user, employeeId))) return apiError(403, 'Insufficient permissions')
```

Behaviour delta:
- **Narrows** for MANAGER: no longer reaches a stranger's punches. <- the fix
- **Widens** for MANAGER: now reaches additional supervisees (#176) and branch staff, matching
  `/employees/[id]`. Consistency win.
- CEO/SUPER_ADMIN/HR_ADMIN unchanged (`ADMINISTER_HR_ORGWIDE` short-circuit, `employee-access.ts:43`).
- Plain EMPLOYEE with reports unchanged (`listReportIdsFor` covers it).

Net **-12 lines**, one existing helper.

### B. `performance/reviews/[id]/+page.server.ts:26` — CONFIRMED leak, three options

Comment `:22-24`: *"A review is private to its two participants... HR may read any review in the
org."* Any MANAGER currently clears that floor.

| option | effect | net |
|---|---|---|
| B1 `requireAnyCapability(user.roles,'MANAGE_HR')` | status quo, leak preserved | 0 |
| B2 `requireAnyCapability(user.roles,'ADMINISTER_HR_ORGWIDE')` | narrows; matches the comment exactly | 0 |
| **B3** `await assertCanTouchEmployee(user, review.employee.id)` | narrows to strangers, keeps a manager's own team | +1 import |

**Recommend B3**, fallback B2. B3 is the object-level answer and preserves a real use case (a
department head reading their own report's review when someone else was the reviewer). **B1 is a
decision to ship a known leak** — if chosen, say so in a comment.

### C. `api/v1/leave/[id]/+server.ts:38` — the error message contradicts the code

`requireAnyMinRole(user.roles,'HR_ADMIN')` with `catch { return apiError(403, 'override-approve
requires HR_ADMIN or higher') }`. The message is false: MANAGER clears it, and `override-approve`
bypasses the approval chain outright.

**Proposed:** `requireAnyCapability(user.roles,'ADMINISTER_HR_ORGWIDE')`. Narrows for MANAGER;
HR_ADMIN/CEO/SUPER_ADMIN unchanged. This is a WHAT question, not WHOSE — overriding a chain is an
authority level, not a data scope. No new capability needed.

Alternative if MANAGER should keep it: use `MANAGE_HR` and **fix the message**. Do not leave the
message as-is either way.

### D. `employees/[id]/+page.server.ts:481, 507` — comment-only; code must NOT change

```
:481  // #170: ... HR_ADMIN and up (a MANAGER may edit their reports' profile but must not move pay).
:507  // #222: ... Same HR_ADMIN+ gate as changeCompensation: it moves pay, so a MANAGER must not reach it.
```

Both statements are false as written — MANAGER clears both floors. **The system is nonetheless
correct**, because `proposeIfRequired` (`src/lib/server/services/employees.ts:691-712`) routes a
MANAGER's pay change through propose->confirm instead of writing it (#243).

**Action: convert both to `MANAGE_HR`, rewrite the two comments to name `proposeIfRequired` as the
actual control. Do NOT convert to `ADMINISTER_HR_ORGWIDE`** — that would 403 the MANAGER before
they can file a proposal, breaking maker-checker (#243) and killing
`tests/unit/pay-proposal-routing.test.ts`.

### E. `api/v1/timesheets/aggregate/+server.ts:17` — stale doc comment, no code change

`// Roles: HR_ADMIN, SUPER_ADMIN.` — actually admits MANAGER and CEO. Per §2c, narrowing regresses
`timesheets.ts:104-111`. **Fix the comment, convert to `MANAGE_HR`, change nothing else.**

---

## 4. `MANAGE_HR` vs `VIEW_TEAM` — naming, not behaviour

The lists are byte-identical today. Assigned above by *meaning* (read-a-team -> `VIEW_TEAM`;
administer-HR -> `MANAGE_HR`), which makes a future divergence a one-line edit rather than an audit.
`tests/unit/rbac.test.ts` pins both lists longhand and independently, so they cannot drift silently.

Collapsing `VIEW_TEAM` into `MANAGE_HR` would delete a further ~15 lines but destroys the ability to
express "sees a team but doesn't administer HR". **Recommend keeping both.**

---

## 5. Part 2 — the `User.role` -> `User.roles` collapse

### 5a. Where the scalar is read, by purpose

**Group 1 — authorization (~11 sites).** After Part 1 there are **zero** direct authorization reads
of `user.role`. What remains is the `AuditContext` fallback idiom, written identically in eleven
places:

```ts
const roles = ctx.actorRoles?.length ? ctx.actorRoles : [ctx.actorRole]
```

`action-proposals.ts:85` · `approvals.ts:31` · `attendance/index.ts:588` · `employees.ts:703` ·
`payroll/index.ts:547` · `payroll/loans.ts:42` · `payroll/periods.ts:308` · `payroll/runs.ts:94` ·
`requests/index.ts:18` · `settings/org.ts:242` · plus `employee-access.ts:36` (`rolesOf`, on
`EmployeeAccessActor.role`).

**Replacement:** make `AuditContext.actorRoles: Role[]` **required**
(`src/lib/server/services/types.ts:6-9`), delete `actorRole` from the interface, delete all eleven
fallbacks, delete `EmployeeAccessActor.role` (`employee-access.ts:29`) and `rolesOf` (`:36`).

This is the largest genuine deletion in the project and it turns an entire bug class (#247, #272,
#275 — "the route forgot `actorRoles`") into a **type error** rather than a silent narrowing.
Strongest argument for doing Part 2 at all.

**Group 2 — audit-log actor (~120 assignments).** `actorRole: user.role` feeding
`AuditLog.actorRole` (`prisma/schema.prisma:1361`, written at `src/lib/server/audit.ts:31`).

> **Critical finding: `AuditLog.actorRole` is WRITE-ONLY.** Nothing in `src/`, `tests/`, `scripts/`
> or `prisma/` ever reads it. The audit-log UI (`src/routes/(app)/reports/audit-log/+page.svelte:176`)
> renders `log.actor.role` — the User relation's *current* role, not the historical column. The
> historical value has never been surfaced.

This is the one and only place that would force a "primary role" ranking. See §5b.

**Group 3 — display labels (5 sites).**
- `src/routes/(app)/employees/[id]/+page.svelte:283` `{employee.user.role}` -> `roles.join(', ')`
- `src/routes/(app)/settings/roles/+page.svelte:123` `{u.role.replace('_',' ')}` -> map over `u.roles`
- `src/routes/(app)/settings/roles/+page.svelte:107` `value={u.role}` — **danger spot, §5c**
- `src/routes/(app)/reports/audit-log/+page.svelte:176` `{log.actor.role}` — depends on §5b
- `src/routes/(app)/+layout.svelte:92` `const role = $derived(data.user.role)` — no other use of
  `role` found in that file; everything below uses `roles`. **Verify, then delete the line.**

**Group 4 — role assignment (the real design work).** `src/lib/server/services/settings/org.ts`:
`listOrgUsers` `:153,:166`; `IRREPLACEABLE_ROLES` lookup `:202`; `assertNotLastOfRole` count `:217`;
`setUserRole` `:268,:279,:291`. Plus `src/routes/(app)/settings/roles/+page.server.ts:57` and
`src/routes/api/v1/settings/users/[id]/role/+server.ts:26,33`.

- `setUserRole:279` `data: { role: newRole, roles: [newRole] }` -> `data: { roles: [newRole] }`.
  **Keep the single-valued API** — widening it to a set is #283, not this.
- `assertNotLastOfRole` (`:198-226`) is the one place with genuine set semantics: it must check
  *each irreplaceable role being lost*, not `target.role`. Signature takes `roles: Role[]`; loop
  `for (const r of target.roles) if (IRREPLACEABLE_ROLES[r] && !newRoles.includes(r))`; the count at
  `:217` becomes `roles: { has: r }`. **Not a ranking** — per-role, which is why it is safe.
- Guard `:268` `if (newRole !== existing.role)` -> `if (!existing.roles.includes(newRole) || existing.roles.length > 1)`.
- Audit payload `:291` `oldValue: { role: existing.role }` -> `{ roles: existing.roles }`.

**Group 5 — seeding & scripts.** `prisma/seed-core.ts` (`backfillMembershipsAndRoles` `:13-27` —
**delete the `roles` half entirely**; `role:` writes at
`:208,213,264,446,472,477,510,515,524,529,683,688,694,699,728,759` -> `roles: ['X']`),
`src/lib/server/services/employees.ts:480-481` (hire flow — drop the `role:` line, keep
`roles: [input.role]`), `scripts/promote-probationary.ts:39,133`, `scripts/prod-delete.ts:110`,
`scripts/seed-payslip-demo.ts:86`, `scripts/seed-separation-demo.ts:37,42`,
`scripts/seed-issues-demo.ts:60`. Queries become `roles: { has: 'X' }` / `roles: { hasSome: [...] }`.
**Delete `scripts/migrate-user-roles-backfill.ts`** — it repairs a desync that can no longer exist.

> `scripts/migrate-leave-to-request.ts:63,71` and `seed-issues-demo.ts:227,229` are
> `ApprovalStep.role` (schema `:837`), a different column. **Leave alone.**

**Group 6 — type plumbing.** `src/lib/server/auth.ts:17` (`role: attributes.role`), `:20` (the
`roles?.length ? ... : [attributes.role]` fallback — delete), `:37`
(`DatabaseUserAttributes.role` — delete). Then `src/routes/(app)/+layout.server.ts:17,42` and
`src/routes/(app)/dashboard/+page.server.ts:53` drop `role:` from the `countPendingApprovals`
argument and the returned user shape.

**Group 7 — dual-read queries that collapse.** Real simplification, two sites:
- `src/lib/server/services/action-proposals.ts:122-123`
  `OR: [{roles:{hasSome}}, {roles:{isEmpty}, role:{in}}]` -> `roles: { hasSome: [...roles] }`
- `src/lib/server/services/recruitment.ts:345`
  `OR: [{role:'HR_ADMIN'}, {roles:{has:'HR_ADMIN'}}]` -> `roles: { has: 'HR_ADMIN' }`

**Group 8 — tests.** 58 `actorRole:` occurrences and ~25 files constructing `{ role: ... }` mocks.
See §8c for why the compiler will NOT catch these.

### 5b. The one forced decision: `AuditLog.actorRole`

You cannot delete `User.role` without answering what feeds this non-nullable scalar column.

| | approach | verdict |
|---|---|---|
| B1 | `actorRole: user.roles[0]` | **Reject.** The back-door primary-role pick. Array order is not a policy. |
| B2 | Drop `AuditLog.actorRole` entirely | Shortest diff (~120 lines deleted, no column added). Destroys the role-held-at-the-time record. For a PH HRIS handling payroll and 201 files, compliance-relevant even though the UI never showed it. |
| **B3** | `actorRole Role` -> `actorRoles Role[]` | **Recommend.** Same ~120-site diff as B2, preserves history, more accurate than today for multi-role users. |

Under B3, `audit-log/+page.svelte:176` should switch from the relation (`log.actor.role`, which
shows *today's* role for a year-old event — arguably a latent bug) to `log.actorRoles.join(', ')`.

**Needs a decision before any code is written** — it determines the migration script's shape.

### 5c. Ranking danger spots — where `ROLE_HIERARCHY` could return through the back door

1. **`AuditLog.actorRole`** — the primary one. Neutralised by B3.
2. **`src/routes/(app)/settings/roles/+page.svelte:107`** `<select value={u.role}>`. A single-valued
   `<select>` prefilled from a set requires picking one. Options: (i) `value={u.roles[0]}` with a
   comment that this holds *only* while the picker is single-valued (#283); (ii) leave unprefilled
   when `roles.length > 1`. **Uncertain — product call.** Today `roles.length` is always 1, so (i) is
   behaviourally identical and (ii) is dead code. Lean (i) + comment.
3. **Any "show the user's role" label.** Must render the whole set, never "the highest". The
   `route-guard-multirole.test.ts` scan will not catch this.

---

## 6. Schema + migration

### 6a. Repo constraints (verified)

- No `prisma/migrations/` directory. `pnpm db:push` only.
- `scripts/prestart.sh` is the deploy sequence, run by `docker-compose.yml:57` and CI's
  `schema-upgrade` job. It runs `migrate-employment-type-regular.ts` then
  `prisma db push --skip-generate`. Established pattern: **destructive change -> idempotent raw-SQL
  script -> push.**
- `prisma db push` refuses/warns on dropping a populated `NOT NULL` column without
  `--accept-data-loss`. `prestart.sh:18` passes no such flag. **A naive push halts the deploy.**

### 6b. Proposed `scripts/migrate-user-role-to-roles.ts`

Follows `scripts/migrate-employment-type-regular.ts` exactly: existence-guarded, idempotent, no-op
on a fresh database, safe to run before every push forever.

```
1. if information_schema has no users.role column -> log "already migrated", return
     (idempotency + fresh-DB guard)

2. UPDATE "users" SET roles = ARRAY[role]::"Role"[]
     WHERE cardinality(roles) = 0 OR NOT (role = ANY(roles));
   -- superset of migrate-user-roles-backfill.ts's guard; runs #255's repair one last time

3. SELECT count(*) FROM "users" WHERE cardinality(roles) = 0;  -> if > 0, THROW
   -- never drop live authority; an empty roles set after the drop is an unrecoverable lockout,
   -- because assertNotLastOfRole cannot be satisfied

4. [only if AuditLog decision = B3]
   ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actorRoles" "Role"[] NOT NULL DEFAULT '{}';
   UPDATE "audit_logs" SET "actorRoles" = ARRAY["actorRole"]::"Role"[] WHERE cardinality("actorRoles") = 0;
   SELECT count(*) FROM "audit_logs" WHERE cardinality("actorRoles") = 0;  -> if > 0, THROW

5. ALTER TABLE "users"      DROP COLUMN IF EXISTS "role";
   ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "actorRole";
```

**Why step 5 lives in the script rather than being left to push:** the drop here means `db push` sees
nothing to drop, emits no data-loss warning, and `prestart.sh` needs no `--accept-data-loss`. That
flag, once added, silently permits *every future* destructive change — a permanent widening of blast
radius for a one-time need.

**Why step 4 must create the column itself:** the backfill must happen before the drop, and
`db push` does add-and-drop in one pass. Raw SQL is the only ordering that works — same reasoning as
`migrate-employment-type-regular.ts:53-54`.

### 6c. Wiring

Insert into `scripts/prestart.sh` **between** the employment-type rename and the push. Same comment
style, same idempotency rationale.

### 6d. Schema edits

- `prisma/schema.prisma:383-387` — delete the `role` line; rewrite the comment (`roles` is now simply
  *the* role set; the #133 backfill note is historical).
- `:1361` — `actorRole Role` -> `actorRoles Role[]` (or delete under B2).
- `:1502-1504` — the "role management edits `User.role`" comment needs correcting.

### 6e. Session invalidation

`src/lib/server/auth.ts` uses `PrismaAdapter(db.session, db.user)`; Lucia re-reads the user row on
every `validateSession`, so nothing role-shaped is cached in the session. Dropping the column should
not require a session flush. **Confidence high, but verify on staging before prod.**

---

## 7. Sequencing

**#282 first, then the `role` -> `roles` collapse.** Confirmed — but *not* for the originally
assumed reason. The assumption was "with rank gone, nothing forces a primary-role ranking"; in fact
all 66 rank floors already take `user.roles` (a set), so the rank helpers never force a primary role
either way. The real reasons:

1. **Diff hygiene.** 66 of the sites Part 2 must touch are in files Part 1 already rewrites. Part 1
   first means Part 2's diff contains only `.role` changes, so a reviewer of the far riskier half
   isn't reading 66 unrelated guard rewrites.
2. **The finish-line guard.** #282's "zero callers" scan test (§8b T1) is trivial to verify on a tree
   whose `.role` reads are untouched. Interleaving makes it a moving target.
3. **Part 1's classification is the audit trail Part 2 depends on.** Once §2 is committed, "does
   anything still authorize on a scalar?" is provably *no* — which is what licenses deleting the
   eleven `?? [actorRole]` fallbacks without re-deriving each one.

Commit sequence — **one PR, many commits** (house rule: do not split):

```
 1  rbac: convert org-config rank floors to MANAGE_HR (§2a - 30 sites, no-op)
 2  rbac: convert object-scoped rank floors (§2b - 20 sites, no-op)
 3  rbac: convert timesheet/leave rank floors (§2c - 6 sites, no-op) + fix stale comments (§3-C,E)
 4  fix: scope raw punch reads to the actor's team (§3-A)              <- behaviour change
 5  fix: keep performance reviews to participants and HR (§3-B)        <- behaviour change
 6  fix: restrict leave override-approve to org-wide HR (§3-C)         <- behaviour change [if approved]
 7  rbac: delete ROLE_HIERARCHY and the three rank helpers + guard test
 --- #282 complete, suite green, deployable ---
 8  schema: add AuditLog.actorRoles, migration script, prestart wiring
 9  refactor: AuditContext.actorRoles becomes required; delete 11 fallbacks
10  refactor: role assignment, seeds, scripts, display labels read roles
11  schema: drop User.role and AuditLog.actorRole
```

Commits 1-3 and 7 are green by construction (set-identical). 4-6 each carry their own new test.
8-11 must land together to stay green; 11 is schema-only and follows the script.

---

## 8. Test strategy

### 8a. Tests that must change

| file:line | change | why |
|---|---|---|
| `tests/unit/rbac.test.ts:8-10` | drop `hasMinRole`, `hasAnyMinRole`, `ROLE_HIERARCHY` imports | deleted |
| `tests/unit/rbac.test.ts:162-190` | **delete** the whole `describe('hasMinRole')` block | tests a deleted function |
| `tests/unit/rbac.test.ts:255-264` | delete the floor half of the one-element-equivalence loop; **keep the capability half** | that loop is #256's no-op proof, still load-bearing for `canAny` |
| `tests/unit/rbac.test.ts:232,242` | drop the two `hasAnyMinRole` assertions | |
| `tests/unit/employee-access.test.ts:3,60-67` | **rewrite, do not delete** — see below | encodes the whole trap |
| `tests/unit/route-guard-multirole.test.ts:77` | fixture string `hasAnyMinRole(user.roles,'HR_ADMIN')` -> `requireAnyCapability(user.roles,'MANAGE_HR')` | string literal; no compile error, but the doc would lie |
| `tests/unit/route-guard-multirole.test.ts:37,65,81` | **keep** the `ROLE_HIERARCHY[...]` pattern and fixtures | now guards against *reintroduction*. Cheap. |
| `tests/e2e/auth.spec.ts:44`, `tests/e2e/manager-org-wide-timesheets.spec.ts:11` | comment-only | |
| prose in `action-proposals.test.ts:102`, `employee-patch-authorization.test.ts:11-12`, `pay-proposal-routing.test.ts:15`, `self-action-guards.test.ts:9`, `requests-read-scoping.test.ts:7`, `benefits-enroll-scoping.test.ts:12` | comment-only; keep the history, note the mechanism is gone | **rewrite, never delete** — hard-won context |

**`employee-access.test.ts:60-67` rewrite.** It currently proves the empty set by computing
`clearsManagerFloor` from `ROLE_HIERARCHY`; after deletion that is unwriteable. State the claim
directly instead:
```ts
expect([...CAPABILITIES.MANAGE_HR].sort()).toEqual(['CEO','HR_ADMIN','MANAGER','SUPER_ADMIN'])
expect(CAPABILITIES.ADMINISTER_HR_ORGWIDE).not.toContain('MANAGER')
```
*Mutation it must kill:* adding `'MANAGER'` to `ADMINISTER_HR_ORGWIDE` (`rbac.ts:65`), which would
silently re-open the entire #228 hole via `employee-access.ts:43,88,180`.

### 8b. New tests

**T1 — the finish-line guard (#282 asks for this explicitly).** A `readdirSync` scan over `src/`,
modelled on `route-guard-multirole.test.ts:93-103`, asserting zero occurrences of
`ROLE_HIERARCHY|hasMinRole|hasAnyMinRole|requireAnyMinRole` outside whole-line comments. ~20 lines.
*Mutation killed:* reintroducing any of the four names anywhere in `src/`.

**T2 — punch access (§3-A).** New `tests/unit/punch-access.test.ts`, mocking `$lib/server/db` and
`listReportIdsFor` in the style of `employee-access.test.ts:14-22`. Assert: MANAGER **denied** a
stranger's punches; MANAGER **allowed** a report's; MANAGER **allowed** branch staff; owner allowed;
HR_ADMIN allowed without a team lookup.
*Mutations killed:* reverting the guard to `canAny(roles,'MANAGE_HR')` (stranger case fails);
deleting the guard entirely; swapping `canTouchEmployee` for `listVisibleEmployeeIds` truthiness
(`null` is falsy — a classic slip that would deny HR).

**T3 — review privacy (§3-B).** Extend `tests/unit/performance-redact.test.ts` or add a sibling: a
MANAGER who is neither subject nor reviewer gets 403 on a stranger's review; HR_ADMIN gets it; under
B3 the manager gets their own report's.
*Mutation killed:* `ADMINISTER_HR_ORGWIDE` -> `MANAGE_HR` at that line.

**T4 — leave override (§3-C, if approved).** MANAGER gets 403 on `override-approve`, 200 on plain
`approve`. The plain-approve half pins that the fix did not over-narrow.
*Mutation killed:* moving the override check outside the `action === 'override-approve'` branch.

**T5 — `setUserRole` writes only `roles` (Part 2).** Extend
`tests/unit/user-admin-self-guard.test.ts`. Assert the `tx.user.update` payload has no `role` key,
and that `assertNotLastOfRole` still 409s when the last active CEO's set would lose `CEO`.
*Mutations killed:* `roles: { has: r }` -> `roles: { hasSome: [r] }` in the holder count (counts the
wrong users); dropping the `!newRoles.includes(r)` guard (would 409 on a no-op re-save, which
`:262-266` exists to prevent).

**T6 — the scan gets stronger for free.** `route-guard-multirole.test.ts:26-27` currently carves out
`actorRole: user.role` as "not an authority decision". After Part 2 that carve-out is unnecessary —
**remove it and line 79's fixture**, and the scan then catches *any* singular `.role` read anywhere
in `src/lib` and `src/routes`. Strongest available pin on Part 2's completeness, and it costs a
deletion.

### 8c. Two coverage gaps

**The compiler will NOT find the test-side `.role` mocks.** `.svelte-kit/tsconfig.json`'s `include`
covers `../src/**` and `../test/**` — but this repo's tests live in `tests/**`. So `pnpm check` does
not typecheck the suite, and Vitest strips types without checking. The 58 `actorRole:` occurrences in
`tests/` become dead properties that **silently keep passing**. Sweep by grep; do not trust the build.
Same for `{ role: 'X' }` mocks in ~25 files.

**No e2e evidence.** Per #287 (`page.goto('/login')` 120s timeouts) nothing above depends on the e2e
suite. `tests/e2e/manager-org-wide-timesheets.spec.ts` is the only spec that directly exercises the
trap, and its value here is its comment, not its run.

**Migration script has no test precedent.** None of the seven existing `scripts/migrate-*.ts` has a
test. Recommend matching that precedent — the script's own step-3/step-4 count-and-throw assertions
are its verification. **Uncertain** whether to break precedent here.

---

## 9. Risks, unknowns, decisions

**Decisions needed before coding:**
1. **`AuditLog.actorRole`: array-ify (B3) or drop (B2)?** Blocks the migration script. Recommend B3.
2. **§3-A punches fix** — approve the narrow-for-MANAGER? Recommend yes.
3. **§3-B review privacy** — B1 (ship the leak), B2 (org-wide HR only), or B3 (object-scoped)?
   Recommend B3.
4. **§3-C leave override** — narrow to `ADMINISTER_HR_ORGWIDE`, or keep `MANAGE_HR` and fix the
   message? Recommend narrow.
5. **§5c `settings/roles` `<select>` prefill** under a set. Uncertain; low stakes today.

**Will fight you:**
6. **`--accept-data-loss`.** Mitigated by putting the DROP in the script (§6b step 5). Adding the flag
   to `prestart.sh:18` instead leaves it there forever, permitting every future destructive push.
7. **`timesheets.ts:104-116`.** Several sites *look* like they should be narrowed to a manager's
   reports; that was tried and reverted. Point any reviewer suggesting it at this comment.
8. **Untypechecked tests** (§8c) — most likely source of a silently-wrong Part 2.

**Adjacent, OUT OF SCOPE, file separately:**
9. `employees/[id]/+page.server.ts:597` (`endEarning`) and `:652` (`endDeduction`) take an
   *earning/deduction* id, not `params.id`. `scopedToEmployee` (`:390-401`) checks `params.id`, so it
   guards the wrong object; `endEmployeeEarning`/`endEmployeeDeduction` scope by `organizationId`
   only. IDOR-shaped gap. **Pre-existing; neither Part touches it.**
10. `benefits/+page.server.ts:76` (`enroll`) and `separations/+page.server.ts:37` (`create`) take an
    `employeeId` from the form with no `canTouchEmployee`. `benefits.ts:136-139` documents that the
    org check was deliberately put in the service; team-scoping was never added. Same shape as #275.
    Pre-existing.
11. `api/v1/leave/[id]` and `api/v1/timesheets/[id]` gate on `VIEW_TEAM`, which excludes
    `VERIFIER`/`APPROVER` — the sign-off roles cannot use the v1 twins of surfaces they can use in the
    UI. #247-family gap. `APPROVE_REQUESTS` would fix it but **widens access**, so `VIEW_TEAM` is kept
    for the no-op.

**Uncertain:**
12. Whether Lucia sessions survive the column drop cleanly (§6e) — high confidence yes, verify on staging.
13. Whether `+layout.svelte:92`'s `role` binding is genuinely unused. Grep says yes; confirm before deleting.
14. Exact size of the Part-2 `actorRole:` sweep — ~160 raw occurrences in `src/`, of which ~30 are
    `actorRoles` and 11 are the fallbacks; true assignment count near 120. Mechanical either way.
