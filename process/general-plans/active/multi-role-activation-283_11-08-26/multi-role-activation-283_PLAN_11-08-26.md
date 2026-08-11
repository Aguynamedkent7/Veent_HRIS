---
name: plan:283-multi-role-activation
description: "Activate multi-role assignment (Settings → Roles + v1 twin) and close every same-actor separation-of-duties hole: F1 request chain, F2 statutory rates, F3 document verification, F4 job postings, F5 payroll verify→approve"
keywords: rbac, roles, multi-role, separation of duties, maker-checker, statutory rates, settings, approvals, request documents, job postings, posting approvers, payroll sign-off
date: 11-08-26
issue: 283
complexity: COMPLEX
spec: process/general-plans/active/multi-role-activation-283_11-08-26/multi-role-activation-283_SPEC_11-08-26.md
---

# PLAN — #283 Multi-role activation + decision-time separation of duties

**Date**: 11-08-26
**Status**: PLANNED (awaiting VALIDATE)
**Complexity**: COMPLEX
**Issue**: #283

## Overview

**TL;DR** — **Nine** commits on one branch, one PR. Commits 1–3 turn the role picker into a set
(service → form → API); commits 4–7 close **all five** same-actor separation-of-duties holes
(F1 request chain + F5 payroll verify→approve, F3 document verification, F2 statutory rates,
F4 job postings); commit 8 adds E2E + a seeded two-hat account; commit 9 is the
live-verification/cleanup commit. The tree is green at every commit. `setUserRole` becomes
`setUserRoles(userId, organizationId, newRoles: Role[], ctx)`. The F1/F3/F5 guard becomes a
**required 5th parameter `sod` on `canActOnStage`**, so TypeScript forces every caller — including
the badge counters — to answer it.

**Scope note (11-08-26):** the user folded F3, F4 and the payroll verify→approve gap this plan
itself discovered into #283. The issue is no longer "activate multi-role + close what multi-role
opens" — it is **"activate multi-role AND close every same-actor separation-of-duties hole."** One
issue, one PR. The "reachable today with a single role" test that previously excluded F3/F4 is
**retired**; see D7/D8/D9 in §1 and the SPEC edits in §16.

Contract: the SPEC's 8 user stories and 18 acceptance criteria
(`process/general-plans/active/multi-role-activation-283_11-08-26/multi-role-activation-283_SPEC_11-08-26.md`), **plus AC-19..AC-27 defined in
§8 of this plan**. The SPEC does not yet carry the new scope; §16 lists the exact edits to apply to
it. This plan implements them; it does not re-derive them.

---

## 0. Session Setup

| Field | Value |
|---|---|
| feature | none (general-plans; issue-scoped) |
| phase | PLAN |
| session-goal | Activate multi-role assignment and close F1/F2 SoD gaps for #283 |
| branch | **to cut:** `feat/multi-role-activation-283` |
| worktree | main |
| context-group | none — `process/context/` is deliberately empty in this repo |
| blast-radius-packages | `src/lib/server/services/{settings,approvals,payroll,requests}`, `src/routes/(app)/settings/roles`, `src/routes/api/v1/settings/users`, `tests/unit`, `tests/e2e`, `prisma/seed-core.ts` |
| active-plan | this file |
| test-runner | `vitest` (`pnpm test`) \| `playwright` (`pnpm test:e2e`) |
| validate-contract | pending — see §12 |

**Branch command (first action of EXECUTE):**

```bash
git switch staging && git pull && git switch -c feat/multi-role-activation-283
```

**Gate order — non-negotiable, CI runs `format:check` FIRST and skips everything after it on
failure (this has burned the repo four times):**

```bash
pnpm format:check && pnpm lint && pnpm check && pnpm test
```

`pnpm check` does **NOT** typecheck `prisma/**` or `scripts/**`. Every seed/script touched in this
plan must be proved by actually running it (`pnpm db:seed`), not by `pnpm check`.

---

## 1. Approved Decisions Carried In (do not re-open)

D1 any role set, no forbidden-pairs matrix · D2 SoD scope = F1 + F2 only · D3 only Settings → Roles
and its v1 twin become multi-valued; the hire form and `HIRE_ROLES` are untouched · D4 empty set
illegal in service **and** schema, no DB check constraint · D5 `MANAGE_USER_ROLES` stays CEO-only ·
D6 the "remove `roles` entirely" branch is dead.

Q1 the F1 bar is **attempt-scoped** · Q2 statutory rates bar **CONFIRM only**, self-REJECT allowed ·
Q3 **rename** the v1 endpoint to `.../roles` taking `{ roles: [...] }` · Q4 **fix** the audit
asymmetry, no backfill of historical entries.

**Added 11-08-26 when the user widened the scope (also not to be re-opened):**

**D7 — F3 is in scope, with an `ADMINISTER_SYSTEM` carve-out.** Whoever verified a supporting
document on a request is barred from deciding that request — **except** a holder of
`ADMINISTER_SYSTEM` (`rbac.ts:58` → SUPER_ADMIN, CEO), who may do both. The user's words were
"those who have high enough roles are the ones who can do that". That is translated to a **named
capability** and to nothing else: #282 deleted `ROLE_HIERARCHY`, and
`tests/unit/rbac-no-rank-helpers.test.ts` is a static scan that keeps rank floors deleted. **No
rank, level, seniority or hierarchy concept may be introduced.** The predicate is literally
`canAny(actorRoles, 'ADMINISTER_SYSTEM')`.

**D8 — the F4 department mapping must BIND.** In `canApprovePosting` (`recruitment.ts:114-123`),
delete line `:122` (`return canAny(actorRoles, 'MANAGE_HR')`) and **keep** `:121`. A department
*with* a mapped approver becomes decidable only by that designated approver; a department *without*
one still falls back to any `MANAGE_HR` holder. This is what the function's own comment and
`posting-approvers.ts:6-11` already claim it does.

**D9 — no HR-steps-in fallback for F4(b).** If a department's designated approver also holds
`MANAGE_HR` and submits a posting for their own department, that posting is **undecidable** until
HR remaps or unmaps the department in Settings → Posting approvers. That escape hatch is accepted,
and **the 403 message must name it** so the user is not stranded. Recorded in the risk register as
R-K.

**D10 — F5 (payroll VERIFY→APPROVE by one actor) is in scope**, reusing the F1 mechanism. This
supersedes DECISION-3 below, which is rewritten accordingly.

---

## 2. Research Corrections (facts that differed from the brief)

The handed-over research was accurate on every line it named. Three things it did **not** name, all
of which change the commit contents:

| # | Correction | Consequence |
|---|---|---|
| **RC-1** | `tests/unit/approvals.test.ts` calls `canActOnStage` **15 times** (`:17,20,25,27,32,34,40,41,42,49,50,51,76,77`) and `canActOnPayrollStage` 4 times. The brief listed only `approval-self-guard.test.ts` as F1's home. | Commit 4 must update `approvals.test.ts` too, or `pnpm check`/`pnpm test` goes red at that commit. |
| **RC-2** | `canActOnStage` has **three more production callers** the brief did not list: `src/lib/server/services/timesheets.ts:362`, `src/routes/(app)/requests/timesheets/+page.server.ts:50`, and `countActionableTimesheets` (`approvals.ts:~318`). Timesheets run the **same** `STAGE_CAPABILITY` maker-checker chain. | Forces DECISION-2 below (timesheets are in or out of the F1 guard — this plan says **in**). |
| **RC-3** | `tests/unit/route-guard-multirole.test.ts:86` hard-codes the literal source line `const updated = await setUserRole(params.id, user.organizationId, parsed.data.role, {` as a "real near-miss in the tree today" fixture. `:89` hard-codes `roles: [input.role]`. | Renaming the service/param makes that fixture stale (it stops mirroring reality). Commit 3 must update the string. This is *not* weakening the scan — the scan's assertion is unchanged; only its sample corpus is refreshed. |
| **RC-4** | The request-queue counterpart the brief called "`listActionableRequests` or equivalent" is actually **`listPendingRequestsForApprover`** at `approvals.ts:205`, consumed by `countPendingApprovals` (`:246`) and by `src/routes/(app)/requests/approvals/+page.server.ts:21`. | Names the exact AC-15 mirror site. |
| **RC-5** | `tests/e2e/settings-roles.spec.ts` and `tests/e2e/multi-role-sod.spec.ts` (named by AC-3 and AC-17) **do not exist**. | Both are new files in commit 6. |

### Verified for the widened scope (F3 / F4 / F5), all against `9a5df08`

| # | Fact | Consequence |
|---|---|---|
| **RC-6** | `RequestDocument` (`prisma/schema.prisma:859-876`) has **no `attempt` column** — only `requestId`, `verifiedById`, `verifiedAt`. There is no way to key a document sign-off to an approval attempt without adding one. | Forces DECISION-6: the F3 bar is **per-request**, not attempt-scoped. |
| **RC-7** | `decide()` (`approvals.ts:~104`) loads the request with `include: { steps, employee }` — **no `documents`**. `listPendingRequestsForApprover` (`:205`) *already* includes `documents: { select: { id: true, verifiedAt: true } }` but **not `verifiedById`**. | `decide()` needs a new `documents` include (+1 Prisma relation query on a `@@index([requestId])` FK, on a low-frequency write path). The queue mirror needs **only** `verifiedById: true` added to a select that already exists — zero cost. |
| **RC-8** | There is **no v1 API twin for `verifyDoc`**. `setRequestDocumentVerified` has exactly one caller: the `verifyDoc` form action at `src/routes/(app)/requests/[id]/+page.server.ts:145-165`, gated on `canAny(user.roles, 'APPROVE_REQUESTS')` — held by **seven of nine roles** (`rbac.ts:77-85`). | One door only. But the guard still goes in the **service side of the decision** (`canActOnStage`), not the verify route — see DECISION-6. |
| **RC-9** | The F4 decide path is **not** the recruitment page. `recruitment/+page.server.ts:17` is `MANAGE_HR`-gated, but the live decide action is the dashboard card `decidePosting` (`src/routes/(app)/dashboard/+page.server.ts:168-198`), which has **no capability gate at all** — it resolves the actor's employee id and hands straight to `decideJobPosting`. | D8's binding is genuinely reachable: a designated approver holding only `EMPLOYEE` can already decide from the dashboard today. Deleting `:122` therefore does not orphan the flow. |
| **RC-10** | Payroll's MAKE step **is** auto-decided with an actor: `ensurePayrollApprovalChain` (`approvals.ts:382`) calls the same `buildApprovalChain`, which writes `decision: 'APPROVED', actorId: makerUserId` for MAKE (`routing.ts:43-49`). | `decidedActorIds()` therefore already contains the payroll maker, so the F1 mechanism **strictly subsumes** the existing maker-vs-signer guard at `:443-446` and the `makeActorId !== userId` clause at `:~315`. F5 falls out of F1 — see DECISION-3 (rewritten). |
| **RC-11** | `canApprovePosting`'s `:122` reachability claim holds: `:121` and `:122` return the same expression when `resolvedApproverEmployeeId` is null, and `:122` is the only reachable answer when it is non-null and the actor is not the approver. The trailing `(approver != null \|\| isHr)` clause at `:199` is provably redundant once `:122` is deleted (proof in DECISION-8). | F4(a) and F4(c) are both safe as the user specified them. |
| **RC-12** | `MANAGE_HR` = `['MANAGER','HR_ADMIN','SUPER_ADMIN','CEO']` (`rbac.ts:26`). | Names exactly who loses posting-approval reach when D8 binds the mapping — risk R-J. |

Everything else in the brief — every file:line, `assertNotLastOfRole`'s multi-role correctness, the
`decidePayrollRun` precedent at `:443-446`, `assertMayDecide` at `action-proposals.ts:70-72`, the
`buildApprovalChain` auto-MAKE at `routing.ts:41-48`, the `Object.fromEntries` trap, the read-only
branch already joining the full set — was verified correct against the tree at `9a5df08`.

---

## 3. Plan-Level Decisions

### DECISION-1 — the skip-optimisation at `org.ts:276` is **deleted**, not translated

The current branch is:

```ts
if (!existing.roles.includes(newRole) || existing.roles.length > 1) {
    await assertNotLastOfRole(tx, existing, [newRole])
}
```

The obvious set-semantics translation is a set-equality check. **Do not write it.** Read
`assertNotLastOfRole` `:209`:

```ts
const lost = target.roles.filter((r) => IRREPLACEABLE_ROLES[r] && !newRoles.includes(r))
if (lost.length === 0) return
```

It already short-circuits — *before* the `userOrganization.findMany` query — whenever nothing
irreplaceable is lost. Re-saving an identical set loses nothing, so `lost` is empty, so the guard
returns immediately. The caller's branch is therefore a **pure optimisation guarding a function
that already optimises itself**, and it is the fragile half: it reasons about `newRole` membership
rather than about loss, which is exactly the reasoning `assertNotLastOfRole`'s own comment warns
against.

**Replacement:** call it unconditionally.

```ts
await assertNotLastOfRole(tx, existing, roles)
```

AC-7 ("re-saving an unchanged set succeeds") then holds *by construction* rather than by a branch
that has to be kept in sync. Cost of removal: zero extra queries. The existing test at
`user-admin-self-guard.test.ts:233` that pins this branch is rewritten (not deleted) to pin the
outcome instead of the branch — see §7 AC-7.

### DECISION-2 — timesheets are **inside** the F1 guard

Per RC-2, timesheets share `canActOnStage` and `STAGE_CAPABILITY`. Once the guard is a required
parameter, the timesheet call sites must pass *something*. Passing the sentinel
`{ actorId: null, decidedActorIds: [] }` there would be **writing a deliberate hole** — a
`[VERIFIER, APPROVER]` user could verify and approve the same timesheet attempt, which is the
identical defect the SPEC bars on requests, opened by the identical change.

Decision: pass the real values for timesheets. Cost: `countActionableTimesheets`' `select` gains
`actorId`, and two call sites gain a `userId` argument. This is ~6 lines and is a direct
consequence of the chosen placement, not scope drift.

**Escape hatch for VALIDATE:** if VALIDATE rules this out of scope, flipping timesheets back is a
one-line change per call site (`{ actorId: null, decidedActorIds: [] }`) with no structural rework.

### DECISION-3 (REWRITTEN 11-08-26 per D10) — payroll runs are **inside** the F1 guard, and F5 falls out for free

The earlier version of this decision passed the sentinel `{ actorId: null, decidedActorIds: [] }`
through `canActOnPayrollStage` and filed the verify→approve gap as a separate issue. **That is
reversed.** F5 is now in scope.

**F5 restated.** `VERIFY_REQUESTS` (VERIFIER) and `APPROVE_FINANCE` (CEO, SUPER_ADMIN) are disjoint
*only while multi-role is off*. A `[VERIFIER, CEO]` user can verify **and** approve the same payroll
run. The existing guard at `approvals.ts:443-446` covers **maker-vs-signer only**. This gap is
multi-role-CREATED, exactly like F1 and F2 — it belongs in this PR, not in the pre-existing-debt
pile.

**Does it fall out of the F1 parameter for free? Substantially, yes.** `canActOnPayrollStage`
already delegates to `canActOnStage`, and per RC-10 the payroll MAKE step is written already-decided
with an `actorId`, so `decidedActorIds()` — the F1 helper, unchanged — already returns the payroll
maker. What F5 costs beyond F1 is:

1. `canActOnPayrollStage(stage, actorRoles)` gains a third parameter `sod: StageSoD` and stops
   passing the sentinel. (1 line + signature.)
2. `decidePayrollRun` computes the real `sod` from `run.approvalSteps` (already selected with
   `actorId`) — no new query.
3. `countActionablePayrollRuns` does the same; its select already carries `attempt`, `decision` and
   `actorId` (`:305-315`), so **no select change is needed** (unlike the timesheet counter — see R-C).

That is ~6 lines. **No new commit is invented for it; it folds into commit 4.**

**Two now-redundant clauses are deleted as part of the same change** (they exist only because the
generic bar did not exist; leaving them is dead code that will decay):

- `countActionablePayrollRuns`' trailing `&& makeActorId !== userId` (`:~318`) — strictly subsumed
  by the sod bar per RC-10.
- `decidePayrollRun`'s maker-vs-signer block (`:443-446`) is **NOT deleted** — it is **moved above**
  the `canActOnPayrollStage` call. Reason: the generic bar returns the generic message *"You cannot
  act on this stage"*, and the specific block's message *"You cannot sign off a payroll run you
  prepared"* is materially better. Left where it is, the generic bar fires first and the specific
  message becomes unreachable. Moving it two statements up keeps the better message and makes the
  subsumption harmless.

**Still OUT of scope, restated:** SUPER_ADMIN's ability to run + approve + void the same payroll via
`OVERRIDE_FINALIZED` (`rbac.ts:62-73`). That is single-role reachable today **and** is a
capability-table question, not a same-actor one — the capability table is untouched by this PR
(§11 item 6). `rbac.ts:69-71` already says so in its own comment.

### DECISION-6 — F3: the bar lives in `canActOnStage`, is **per-request**, and covers **all stages**

Three sub-decisions, each with its justification.

**(a) Placement — `canActOnStage`, not the `verifyDoc` route and not inline in `decide()`.** The
repo rule (from #282's own record) is that guards belong in the service, and #290's record adds that
a route-only guard *was* the bug. RC-8 confirms there is only one door into verification today, but
the bar is not on *verifying* — it is on *deciding after having verified*. That decision has two
service-layer surfaces (`decide()` and the queue/badge mirror), which is exactly the situation
DECISION-4 already solved for F1. Reusing `canActOnStage` makes AC-21 (the badge mirror) structural
instead of hand-duplicated.

**Cost, stated exactly (RC-7):** `decide()`'s `findFirst` gains
`documents: { select: { verifiedById: true } }` — one extra Prisma relation query against the
`@@index([requestId])` FK, on a path that already runs a transaction and two audit writes. Negligible
and on a write path. `listPendingRequestsForApprover` already includes `documents`; it gains only
`verifiedById: true` inside the existing select — **zero** extra queries. `countActionableTimesheets`
and the payroll counters pass `verifiedDocActorIds: []`, which is honest, not a hole: timesheets and
payroll runs have no `RequestDocument` rows at all.

**(b) Scope — per-REQUEST, not per-attempt.** RC-6: there is no attempt column on `RequestDocument`,
so attempt-scoping would require a schema change this PR has explicitly promised not to make
(AC-18). But the stronger argument is substantive: Q1 scoped the *stage* bar per attempt because a
RETURN means the document was **materially changed and re-submitted**. That argument does not
transfer. `deleteRequestDocument` (`documents.ts:192`) refuses with 409 to remove a **verified**
document, so after a RETURN the owner can swap unverified files but the verified one is
byte-for-byte the file the actor already signed. There is no new version to look at. Per-request is
both the only implementable scope and the correct one.

*This does not contradict Q1.* Q1 governs stage decisions, which are attempt-keyed rows. F3 is keyed
on a row a RETURN provably cannot change.

**(c) Coverage — ALL stages of the chain, not only the stage that consumes the evidence.** The user
chose the capability carve-out over the stage-scoped option; that choice only makes sense if the bar
is broad enough to need an escape hatch. Confirmed here on the merits too: nothing in the code
designates a stage as "the one that reads documents" — `listPendingRequestsForApprover` surfaces
`documents` to every approver at every stage — so a stage-scoped bar would have to invent that
designation. It does not exist, so it is not invented.

**(d) The carve-out must be auditable.** `ADMINISTER_SYSTEM` waiving the bar is a privileged path
and must leave a trace (risk R-L). `decide()`'s existing audit entry gains
`selfVerifiedEvidence: true` when and only when the waiver actually fired.

### DECISION-7 — F4 keeps its own guard shape; it is **not** folded into `canActOnStage`

Job postings do not run the `ApprovalStage` maker-checker chain at all — there are no
`ApprovalStep` rows, no attempts, and the authority function is `canApprovePosting`, a pure 3-arg
predicate. Forcing it through `canActOnStage` would mean inventing a fake stage. The F4 guard is
therefore a direct `jp.submittedById === ctx.actorId` check inside `decideJobPosting`, with the
queue mirror applied by hand in `listPostingsAwaitingApprover` — the same two-surface discipline,
different mechanism.

### DECISION-8 — proof that F4(c)'s trailing clause is redundant

`listPostingsAwaitingApprover:199` filters on
`canApprovePosting(approver, actorEmployeeId, actorRoles) && (approver != null || isHr)`.

After D8 deletes `:122`, `canApprovePosting` is exactly:

- `approver != null && actorEmployeeId === approver` → `true`; then `(approver != null)` is `true`.
- `approver == null && isHr` → `true`; then `(isHr)` is `true`.
- otherwise → `false`, and the `&&` short-circuits before the clause is evaluated.

In every branch where the left operand is `true`, the right operand is also `true`. **The clause can
never change the result. Verified — remove it.** (Before D8 it was load-bearing: `:122` made
`canApprovePosting` return `true` for every HR admin regardless of mapping, and the clause was the
compensation.)

### DECISION-4 — the guard lives in `canActOnStage`, not inline in `decide()`

Four reasons, in priority order:

1. **The repo's guard-placement rule** (from #282's own record): guards belong in the service, not
   the route — every form action has a v1 API twin. `canActOnStage` *is* the service-layer authority
   function; `decide()` is one of its five consumers.
2. **The badge mirror is the whole point of AC-15.** `decidePayrollRun` put its guard inline at
   `:443-446` and then had to hand-duplicate it into `countActionablePayrollRuns` at `:~305`. That
   duplication is the precedent's one weakness. Putting the F1 guard inside `canActOnStage` makes
   `listPendingRequestsForApprover` (RC-4) and `countActionableTimesheets` inherit it for free —
   AC-15 becomes structural.
3. **A required parameter is compile-enforced coverage.** Inserting the new argument at position 5
   (before the existing *optional* `stageCapability`) makes every one of the 5 production call sites
   and 19 test calls a TypeScript error until updated. A 6th optional parameter would let a future
   caller silently opt out — that is precisely how the payroll duplication decayed.
4. **`decide()` still needs its own inline check? No.** `decide()` already resolves `liveSteps`
   (`:120-122`); it passes them to the helper. One expression, no duplication.

### DECISION-5 — Q1's safety argument is recorded as a code comment

Per Q1, the bar is attempt-scoped. The non-obvious safety argument must be recorded **in the code**,
verbatim in substance, at `canActOnStage`:

> An actor barred from a stage cannot RETURN the request either — the bar is on *deciding* that
> stage at all, in either direction — so nobody can manufacture a fresh attempt to escape their own
> bar. Across attempts the worst case is that A verified a superseded version and approves a version
> someone else verified: still two humans on the live attempt.

---

## Touchpoints (4)

**Changed — production**

| File | Change |
|---|---|
| `src/lib/server/services/settings/org.ts` | `setUserRole` → `setUserRoles`; empty-set refusal; dedupe; delete skip-optimisation; audit `newValue` → `{ roles }` |
| `src/routes/(app)/settings/roles/+page.server.ts` | `roleSchema` → `rolesSchema`; `formData.getAll('roles')` |
| `src/routes/(app)/settings/roles/+page.svelte` | `<select multiple>`, prefill from full set, aria-label |
| `src/routes/api/v1/settings/users/[id]/role/` → `.../roles/` | directory rename (`git mv`), body `{ roles: [...] }` |
| `src/lib/server/services/approvals.ts` | `canActOnStage` gains required `sod` param (F1 + F3) + `decidedActorIds` / `usedDocVerifierCarveOut` helpers; `decide`, `listPendingRequestsForApprover`, `countActionableTimesheets`, `countPendingApprovals` updated; `canActOnPayrollStage` gains `sod` (F5); `decidePayrollRun`'s maker guard moved above the stage check; `countActionablePayrollRuns`' `makeActorId !== userId` clause deleted |
| `src/lib/server/services/timesheets.ts` | `:362` call site passes `sod` |
| `src/routes/(app)/requests/timesheets/+page.server.ts` | `:50` call site passes `sod` |
| `src/routes/(app)/requests/approvals/+page.server.ts` | `:21` passes `user.id` |
| `src/lib/server/services/payroll/statutory-rates.ts` | `confirmProposal` gains proposer-vs-confirmer bar (F2) |
| `src/lib/server/services/recruitment.ts` | **F4** — `canApprovePosting:122` deleted (mapping binds); `decideJobPosting` gains the submitter bar with the remap escape hatch named in the message; `listPostingsAwaitingApprover` gains `actorUserId`, drops the now-redundant `(approver != null \|\| isHr)` clause and adds the submitter filter |
| `src/routes/(app)/dashboard/+page.server.ts` | `listPostingsAwaitingApprover` call site gains `user.id` (the card's own data load) |

**Changed — tests**

`tests/unit/user-admin-self-guard.test.ts` (14 cases) · `tests/unit/approvals.test.ts` (19 calls) ·
`tests/unit/approval-self-guard.test.ts` · `tests/unit/payroll-statutory-proposal.test.ts` ·
`tests/unit/proposal-queue.test.ts` · `tests/unit/route-guard-multirole.test.ts` (fixture strings
only)

**New**

`tests/unit/api-v1-user-roles.test.ts` · `tests/unit/recruitment-posting-sod.test.ts` ·
`tests/e2e/settings-roles.spec.ts` · `tests/e2e/multi-role-sod.spec.ts`

**Read, not changed — added for the widened scope**

`src/lib/server/services/requests/documents.ts` (F3's write site — `setRequestDocumentVerified:151`
and the 409 at `:192` that pins DECISION-6b; **the file itself is not edited**) ·
`src/routes/(app)/requests/[id]/+page.server.ts:145-165` (`verifyDoc`; unchanged — the bar is on
deciding, not verifying) · `src/lib/server/services/posting-approvers.ts` ·
`prisma/schema.prisma:859-876` (`RequestDocument` — read to confirm no `attempt` column)

**Changed — seeds**

`prisma/seed-core.ts` — one new two-hat account (see commit 6). All 21 existing single-role
`roles: [X]` writes across `prisma/seed-core.ts`, `scripts/seed-separation-demo.ts:37,42` and
`scripts/seed-issues-demo.ts:60` **stay exactly as they are and stay valid** — a one-element array
is a legal set and none of them calls `setUserRole`. No seed edit is *required* by the signature
change; the one addition in commit 6 is for manual/E2E testing only.

**Read, not changed**

`src/lib/rbac.ts` (`ASSIGNABLE_ROLES`, `HIRE_ROLES` — untouched per D3) ·
`src/lib/server/services/requests/routing.ts` · `src/lib/server/services/action-proposals.ts`
(the F2 shape to mirror) · `src/lib/server/auth.ts` · `src/hooks.server.ts`

---

## Public Contracts (5)

| Contract | Before | After | Breaking? |
|---|---|---|---|
| `setUserRole(userId, orgId, newRole: Role, ctx)` | single role | **`setUserRoles(userId, orgId, newRoles: Role[], ctx)`** | internal only — 2 call sites, both in this PR |
| `PATCH /api/v1/settings/users/:id/role` body `{ role }` | singular | **`PATCH /api/v1/settings/users/:id/roles` body `{ roles: string[] }`** | no consumers — `/api/v1/*` authenticates by Lucia session cookie only, no API-key or bearer mechanism exists, zero in-repo callers (verified) |
| `canActOnStage(stage, roles, actorEmpId, ownerEmpId, stageCapability?)` | 5 params, last optional | **`canActOnStage(stage, roles, actorEmpId, ownerEmpId, sod, stageCapability?)`** — `sod` required at position 5, carrying **both** the F1 attempt bar and the F3 document bar | internal; compile-enforced |
| `canActOnPayrollStage(stage, roles)` | 2 params, sentinel inside | **`canActOnPayrollStage(stage, roles, sod)`** | internal, 2 call sites (F5) |
| Payroll decision | maker may not sign off | **maker may not sign off AND the verifier of an attempt may not approve it** | behaviour change, intended (AC-27) |
| Request decision | stage capability + not-your-own-request | **+ not a second stage of the live attempt (F1) + not the verifier of any document on the request (F3), unless `ADMINISTER_SYSTEM`** | behaviour change, intended (AC-19/AC-20) |
| `canApprovePosting(approver, actorEmpId, roles)` | any `MANAGE_HR` holder may decide **any** posting | **a mapped department is decidable only by its designated approver; unmapped falls back to `MANAGE_HR`** | behaviour change, intended (AC-23/AC-24) — see risk R-J |
| `decideJobPosting(...)` | the submitter may decide their own posting | **403 for the submitter**, message naming the remap escape hatch | behaviour change, intended (AC-25) |
| `listPostingsAwaitingApprover(orgId, actorEmployeeId, actorRoles)` | — | **`(orgId, actorEmployeeId, actorRoles, actorUserId)`** | internal, 1 call site |
| Audit `Request` UPDATE `newValue` | `{ attempt, stage, decision, status }` | **+ `selfVerifiedEvidence: true` when and only when the D7 carve-out fired** | additive, forward-only |
| `listPendingRequestsForApprover(orgId, roles, actorEmployeeId)` | — | **`(orgId, roles, actorEmployeeId, actorUserId)`** | internal, 2 call sites |
| `countActionableTimesheets(orgId, roles, actorEmployeeId)` | — | **`(orgId, roles, actorEmployeeId, actorUserId)`** | private to module |
| `confirmProposal(orgId, proposalId, ctx)` | applied for anyone with the capability | **403 for the proposer** | behaviour change, intended (AC-13) |
| Audit `User` UPDATE `newValue` | `{ role: 'X' }` | `{ roles: ['X','Y'] }` | forward-only; historical entries keep the singular key, no backfill (Q4) |
| DB schema | `User.roles Role[]` | unchanged | **no migration, no backfill, no downtime** (AC-18) |

---

## Blast Radius (6)

- **Files:** **11** production, 6 tests changed, **4** tests new, 1 seed, 1 directory rename.
  ~22 files.
- **Packages:** one (single SvelteKit app).
- **Risk class:** **HIGH** — auth/permission + trust-boundary logic. **Five of the six** sub-changes
  are authorisation guards; the sixth widens a privilege-granting form.
- **Schema/data:** none. No Prisma migration, no `db push` needed for the code (only for a fresh
  seed). **RC-6 confirms F3 does not add an `attempt` column** — DECISION-6b exists precisely so
  AC-18 survives the widened scope.
- **Worst-case failure:** a wrong `sod` predicate either (a) blocks all approvals (loud, caught by
  `approvals.test.ts` + E2E) or (b) silently blocks nothing (quiet — which is why every guard test
  in §8b carries a named mutation check). **F4's worst case is different and louder:** D8 binds the
  mapping, so a mis-seeded `PostingApprover` row makes a department's postings undecidable by
  anyone. That is the accepted D9 hatch, but it is why AC-24 (unmapped fallback still works) is a
  named test and not an afterthought.

---

## 7. Implementation Checklist — Commit-by-Commit Breakdown

One issue → one PR → **nine** commits. **The tree must be green (`format:check`, `lint`, `check`,
`test`) at the end of every commit.** Each commit therefore carries its own call-site and test
updates.

**Commit map after the 11-08-26 scope widening:**

| # | Subject | Was |
|---|---|---|
| 1 | `refactor(rbac): setUserRoles takes a role set` | 1, unchanged |
| 2 | `feat(settings): multi-select role picker` | 2, unchanged |
| 3 | `feat(api): rename v1 user role endpoint to /roles and take a set` | 3, unchanged |
| 4 | `feat(approvals): bar an actor from two stages of the same attempt` — **F1 + F5** | 4, extended |
| 5 | `feat(requests): the verifier of a document may not decide that request` — **F3** | new |
| 6 | `feat(payroll): the proposer of a statutory rate change cannot confirm it` — F2 | was 5 |
| 7 | `feat(recruitment): bind the department posting approver and bar the submitter` — **F4** | new |
| 8 | `test(rbac): E2E for multi-role assignment and decision-time SoD` | was 6 |
| 9 | `docs(rbac): record the #283 scope boundary and live verification` | was 7 |

F5 is deliberately **not** its own commit: per DECISION-3 it is ~6 lines that fall out of commit 4's
shared parameter. F3 **is** its own commit: it adds a third field to `StageSoD`, a privileged
carve-out, and an audit marker, and it is the one guard a reviewer must read carefully.

### Commit 1 — `refactor(rbac): setUserRoles takes a role set (#283)`

*Service only. Callers keep posting one role, wrapped as a one-element set, so behaviour is
unchanged from the outside.*

**Files:** `src/lib/server/services/settings/org.ts`,
`src/routes/(app)/settings/roles/+page.server.ts` (call-site wrap only),
`src/routes/api/v1/settings/users/[id]/role/+server.ts` (call-site wrap only),
`tests/unit/user-admin-self-guard.test.ts`, `tests/unit/route-guard-multirole.test.ts` (fixture).

**Exact new signature:**

```ts
export async function setUserRoles(
	userId: string,
	organizationId: string,
	newRoles: Role[],
	ctx: AuditContext
)
```

**Body changes, in order:**

1. `requireAnyCapability(ctx.actorRoles, 'MANAGE_USER_ROLES')` — unchanged, stays first (an
   unauthorised caller must not learn whether the target exists).
2. Self-change block — unchanged.
3. **New, before the transaction** (cheap, no DB round trip, and no existence probe):
   ```ts
   // GUARDRAIL (#283/D4): a role-less user can authenticate, holds no capability, and can never
   // be repaired — assertNotLastOfRole can never be satisfied to give one back. The database
   // default for this column is `[]` and there is no check constraint behind it (db push cannot
   // express one), so this refusal and the request schemas are the whole enforcement.
   const roles = [...new Set(newRoles)]
   if (roles.length === 0) error(400, 'A user must keep at least one role.')
   ```
   Dedupe is deliberate: the multi-select cannot post duplicates but the JSON API can, and a
   duplicated set would write a nonsense array and a misleading audit entry.
4. Transaction, target read — unchanged.
5. **Skip-optimisation deleted** per DECISION-1:
   ```ts
   // Keyed on the roles LOST (see assertNotLastOfRole), so re-saving an unchanged set is never
   // blocked and the caller needs no branch of its own: nothing lost means it returns before it
   // queries anything.
   await assertNotLastOfRole(tx, existing, roles)
   ```
6. Write: `data: { roles }`. Replace the stale `// widening the picker to a set is #283` comment.
7. **Audit (Q4/R4):** `newValue: { roles: updated.roles }`. Add a comment: *historical entries keep
   the singular `role` key and are not backfilled.*

**Call sites in this commit:** both callers pass `[parsed.data.role]` — no external behaviour
change yet.

**`route-guard-multirole.test.ts` fixture (RC-3):** update the `:86` near-miss string to the new
real line. The scan's patterns and assertions are **unchanged** — only the sample corpus is
refreshed so it keeps mirroring the tree.

**Test updates — all 14 `describe('setUserRole')` cases move, none dropped:** rename the describe to
`setUserRoles`, change every `'MANAGER'` → `['MANAGER']` etc. Specifically preserved:
`:118` (writes only the role set), `:233` (re-save case — rewritten per AC-7 below), `:250`
(serializable isolation assertion — must survive verbatim).

**Satisfies:** AC-4 (service half), AC-5, AC-6, AC-7, AC-8, and the Q4 audit fix.

**Proved by:** `pnpm test tests/unit/user-admin-self-guard.test.ts` green;
`pnpm check` clean (both call sites compile).

---

### Commit 2 — `feat(settings): multi-select role picker (#283)`

**Files:** `src/routes/(app)/settings/roles/+page.server.ts`,
`src/routes/(app)/settings/roles/+page.svelte`.

**The form-data trap (mandatory):** a `<select multiple>` posts the key `roles` once per selected
option. `Object.fromEntries(await request.formData())` **keeps only the last value** — silently
turning a 3-role save into a 1-role save with no error anywhere. Do not use it for this action.

```ts
const rolesSchema = z.object({
	userId: z.string().min(1, 'User ID is required'),
	// D4: the empty set is refused here as well as in the service, so the form surfaces a field
	// error instead of a 400 error page.
	roles: z
		.array(z.enum(ASSIGNABLE_ROLES))
		.nonempty('A user must keep at least one role.')
})
```

```ts
// A multi-select posts `roles` once per selected option; Object.fromEntries collapses repeated
// keys to the last one, which would silently drop every role but the last. getAll is the only
// correct read here.
const formData = await request.formData()
const parsed = rolesSchema.safeParse({
	userId: formData.get('userId'),
	roles: formData.getAll('roles')
})
```

**Where else this pattern is copied:** the sibling `setActive` action at `:69` also uses
`Object.fromEntries`. It posts no repeated keys, so it is **correct as written and must not be
touched** (surgical-changes rule). No other action in the tree posts a repeated key. EXECUTE must
grep `Object.fromEntries(await request.formData())` before finishing and confirm no *other* action
gained a multi-valued field in this PR.

**Svelte component:**

```svelte
<select
	name="roles"
	multiple
	size={4}
	aria-label="Roles for {u.email}"
	class="... h-auto w-40 ..."
>
	{#each ASSIGNABLE_ROLES as r (r)}
		<option value={r} selected={u.roles.includes(r)}>{r.replace('_', ' ')}</option>
	{/each}
</select>
```

**Runes note — no `$state` is needed and none should be added.** The selected set is held by the
DOM and posted natively as repeated `roles` keys; `use:enhance` forwards the same `FormData`. A
`$state` array plus `bind:value` would be a second source of truth for something the platform
already tracks, and Svelte 5 warns when a bound `<select>`'s options also carry `selected`.
Prefilling with the `selected` attribute is the native answer to US-2/AC-3. Delete the stale
`roles[0]` comment at `:105-108`.

**Making the two branches agree (SPEC "read-only view and editable control always show the same
list"):** the read-only branch at `:126-129` already renders
`u.roles.map((r) => r.replace('_', ' ')).join(', ')`. After this change the editable branch renders
the same nine options with the same `replace` label and the same set pre-selected. Both branches now
read `u.roles` in full; neither indexes `[0]`. No shared helper is introduced for a two-line label
expression.

**Accessibility — what is acceptable and what is out of scope.** Acceptable: a native
`<select multiple size={4}>` with an `aria-label` naming the user, which is keyboard-operable and
screen-reader-labelled. Known and **out of scope**: multi-select is awkward on touch (ctrl/cmd-click
semantics), and there is no "0 of 9 selected" live-region summary. A checkbox-list replacement or a
picker component is explicitly not built here — no picker library, per the native-platform rung.

**Satisfies:** AC-3 (implementation), AC-4 (form half), US-1, US-2.

**Proved by:** `pnpm check` clean; manual step M-2 in §9 (this commit's UI cannot be proved by unit
tests — its E2E lands in commit 6).

---

### Commit 3 — `feat(api): rename v1 user role endpoint to /roles and take a set (#283)`

**Files:** `git mv src/routes/api/v1/settings/users/[id]/role src/routes/api/v1/settings/users/[id]/roles`,
`+server.ts`, new `tests/unit/api-v1-user-roles.test.ts`, `tests/unit/route-guard-multirole.test.ts`
(fixture string again, now that the call reads `parsed.data.roles`).

```ts
const rolesSchema = z.object({
	roles: z.array(z.enum(ASSIGNABLE_ROLES)).nonempty('A user must keep at least one role.')
})
```

Update the handler comment block: the guardrails still all live in `setUserRoles`; add that the
rename is safe because `/api/v1/*` authenticates by session cookie only, there is no API-key or
bearer mechanism anywhere in the tree, and there were zero in-repo callers (Q3).

**New test file `tests/unit/api-v1-user-roles.test.ts`** — mirrors the mocking shape already used by
`user-admin-self-guard.test.ts` (read it first; reuse its `vi.mock` of `$lib/server/db` and its
`CTX`). Cases:

- accepts `{ roles: ['HR_ADMIN','VERIFIER'] }` and **asserts the arguments `setUserRoles` was called
  with**, not merely that the handler resolved;
- rejects `{ roles: [] }` with 422 (schema) — asserts `setUserRoles` was **not** called;
- rejects `{ roles: ['NOT_A_ROLE'] }` with 422;
- 401 with no `locals.user`;
- 403 without `MANAGE_USER_ROLES` — asserts `setUserRoles` was **not** called.

**Satisfies:** AC-2, AC-4 (API half), AC-8 (API half), US-5, Q3.

**Proved by:** `pnpm test tests/unit/api-v1-user-roles.test.ts`; manual step M-3 (curl).

---

### Commit 4 — `feat(approvals): bar an actor from two stages of the same attempt (#283)`

The F1 guard **and F5** (payroll verify→approve), which falls out of the same parameter per
DECISION-3. **Files:** `src/lib/server/services/approvals.ts`,
`src/lib/server/services/timesheets.ts`, `src/routes/(app)/requests/timesheets/+page.server.ts`,
`src/routes/(app)/requests/approvals/+page.server.ts`, `tests/unit/approvals.test.ts`,
`tests/unit/approval-self-guard.test.ts`, `tests/unit/proposal-queue.test.ts`.

**Exact new signature and predicate:**

```ts
/** Actor ids that already recorded a decision on the given attempt. The auto-completed MAKE step
 *  (routing.ts buildApprovalChain, written already-decided in the filer's name when the filer holds
 *  MANAGE_HR) carries a decision AND an actorId, so it is included here with no special case — that
 *  is what makes the filer-is-maker path a decision by that actor. */
export function decidedActorIds(
	steps: { attempt: number; decision: ApprovalDecision | null; actorId: string | null }[],
	attempt: number
): string[] {
	return steps
		.filter((s) => s.attempt === attempt && s.decision != null && s.actorId != null)
		.map((s) => s.actorId as string)
}

export interface StageSoD {
	/** The deciding user's id (User.id, not employeeId). Null disables the same-actor bar. */
	actorId: string | null
	/** Output of decidedActorIds() for the LIVE attempt. */
	decidedActorIds: string[]
}

export function canActOnStage(
	stage: ApprovalStage,
	actorRoles: Role[],
	actorEmployeeId: string | null,
	ownerEmployeeId: string | null,
	sod: StageSoD,
	stageCapability: Record<ApprovalStage, keyof typeof CAPABILITIES> = STAGE_CAPABILITY
): boolean {
	if (actorEmployeeId != null && actorEmployeeId === ownerEmployeeId) return false
	// #283: one person may not decide two stages of the same LIVE attempt. Multi-role makes this
	// reachable — a [VERIFIER, APPROVER] user holds both stages' capabilities — and without it,
	// granting two hats silently collapses a two-person review into one.
	//
	// Attempt-scoped, not request-scoped (Q1): a RETURN begins a new attempt against a materially
	// changed document, and barring forever risks a small org exhausting its deciders and leaving
	// a request permanently un-decidable. That does not open an escape route: an actor barred from
	// a stage cannot RETURN the request either — the bar is on DECIDING that stage at all, in
	// either direction — so nobody can manufacture a fresh attempt to escape their own bar. The
	// worst case across attempts is that A verified a superseded version and approves a version
	// someone else verified: still two humans on the live attempt.
	if (sod.actorId != null && sod.decidedActorIds.includes(sod.actorId)) return false
	return canAny(actorRoles, stageCapability[stage])
}
```

`sod` sits at position **5, before the optional `stageCapability`**, so every existing call is a
compile error until it answers the question. That is deliberate (DECISION-4 reason 3).

**Call sites:**

| Site | `sod` value |
|---|---|
| `decide()` `approvals.ts:125` | `{ actorId: ctx.actorId, decidedActorIds: decidedActorIds(req.steps, attempt) }` — `attempt` is already computed at `:120` |
| `listPendingRequestsForApprover` `:222` | per row: `{ actorId: actorUserId, decidedActorIds: decidedActorIds(r.steps, attempt) }`; function gains a 4th param `actorUserId: string`. `steps` is included whole, so `actorId` is already selected. |
| `countActionableTimesheets` `:~330` | same shape; **add `actorId: true` to the `approvalSteps` select** (it is currently absent — this is the one place that silently returns an empty bar if forgotten); function gains `actorUserId` |
| `timesheets.ts:362` (`decide`-equivalent) | `{ actorId: ctx.actorId, decidedActorIds: decidedActorIds(ts.approvalSteps, live.attempt) }` — verify `approvalSteps` selects `actorId` at that query; add if absent |
| `routes/(app)/requests/timesheets/+page.server.ts:50` | same; needs `locals.user.id`; add `actorId` to its select |
| `canActOnPayrollStage` `:72` | **gains a 3rd param `sod: StageSoD` and forwards it** (F5, DECISION-3) — no sentinel |

`countPendingApprovals` `:246` passes `user.id` down to both counters. The approvals page
(`routes/(app)/requests/approvals/+page.server.ts:21`) passes `locals.user.id`.

**F5 — the payroll half of this commit (DECISION-3), exactly three edits:**

1. `canActOnPayrollStage(stage, actorRoles, sod)` forwards `sod` to `canActOnStage`.
2. `decidePayrollRun` (`:~437-446`): **move** the maker-vs-signer block **above** the
   `canActOnPayrollStage(...)` call so its specific message survives (the generic bar now subsumes
   it and would otherwise fire first and swallow it), then pass
   `{ actorId: ctx.actorId, decidedActorIds: decidedActorIds(run.approvalSteps, live.attempt) }`.
   No new query — `run.approvalSteps` already carries `attempt`, `stage`, `decision`, `actorId`.
   Add a comment recording that the block is now belt-and-braces kept **for its message**, per
   RC-10.
3. `countActionablePayrollRuns` (`:~305-320`): pass the same `sod` shape, and **delete the trailing
   `&& makeActorId !== userId`** — RC-10 proves it is subsumed. Its `select` already includes
   `attempt`, `decision` and `actorId`, so nothing else changes.

**Satisfies:** AC-9, AC-10, AC-11, AC-12, AC-15, AC-27, US-6, US-8.

---

### Commit 5 — `feat(requests): the verifier of a document may not decide that request (#283)`

The F3 guard, per D7 and DECISION-6. **Files:** `src/lib/server/services/approvals.ts`,
`tests/unit/approval-self-guard.test.ts`, `tests/unit/proposal-queue.test.ts`,
`tests/unit/approvals.test.ts` (fixture shape only — the new field is required).

**`documents.ts` is NOT edited.** The bar is on *deciding after having verified*, not on verifying.
`setRequestDocumentVerified` keeps its org-scoping-only contract and its `:149-150` comment stays
true.

**`StageSoD` gains a third field:**

```ts
export interface StageSoD {
	actorId: string | null
	/** Output of decidedActorIds() for the LIVE attempt. Empty for surfaces with no chain history. */
	decidedActorIds: string[]
	/** RequestDocument.verifiedById for every document on THIS request, any attempt.
	 *  Empty for timesheets and payroll runs — neither has RequestDocument rows, so the empty
	 *  array is an accurate answer, not a disabled guard. */
	verifiedDocActorIds: string[]
}
```

**The predicate, appended to `canActOnStage` after the F1 line:**

```ts
// #283/F3/D7: whoever signed off a supporting document may not also decide the request — they
// would be weighing their own evidence. A holder of ADMINISTER_SYSTEM (SUPER_ADMIN, CEO) is
// carved out by explicit decision: they are the escape hatch for a small org whose only
// available verifier is also its only available approver.
//
// This is a CAPABILITY, never a rank. #282 deleted ROLE_HIERARCHY and
// tests/unit/rbac-no-rank-helpers.test.ts is a static scan that keeps rank floors deleted. Do
// not reintroduce a level/seniority/hierarchy concept here in any form.
//
// Scoped per REQUEST, not per attempt — unlike the bar above. RequestDocument carries no attempt
// column, and a RETURN cannot change the signed artefact: deleteRequestDocument refuses with 409
// to remove a VERIFIED document, so on attempt 2 it is byte-for-byte the file this actor signed.
// Q1's "materially changed document" argument justifies attempt-scoping stage decisions; it does
// not transfer to a row a RETURN provably cannot touch.
//
// Covers EVERY stage, not just a nominated evidence-consuming one: no stage in the chain is
// designated as the document reader (the queue surfaces documents to all of them), so a
// stage-scoped bar would have to invent that designation.
if (
	sod.actorId != null &&
	sod.verifiedDocActorIds.includes(sod.actorId) &&
	!canAny(actorRoles, 'ADMINISTER_SYSTEM')
) {
	return false
}
```

**Audit marker for the carve-out (DECISION-6d / risk R-L) — exported alongside:**

```ts
/** True when the F3 bar WOULD have fired but D7's ADMINISTER_SYSTEM carve-out waived it. The
 *  waiver is a privileged path; it must not be silent. */
export function usedDocVerifierCarveOut(sod: StageSoD, actorRoles: Role[]): boolean {
	return (
		sod.actorId != null &&
		sod.verifiedDocActorIds.includes(sod.actorId) &&
		canAny(actorRoles, 'ADMINISTER_SYSTEM')
	)
}
```

**Call sites:**

| Site | `verifiedDocActorIds` value |
|---|---|
| `decide()` | add `documents: { select: { verifiedById: true } }` to the existing `findFirst` include (RC-7), then `req.documents.map((d) => d.verifiedById).filter((v): v is string => v != null)` |
| `listPendingRequestsForApprover` | the `documents` include already exists — add **only** `verifiedById: true` to its select (RC-7), same map per row |
| `countActionableTimesheets`, `timesheets.ts:362`, `requests/timesheets/+page.server.ts:50` | `[]` — timesheets have no `RequestDocument` rows |
| `canActOnPayrollStage` (both callers) | `[]` — same reason |

**Audit wiring in `decide()`** — the existing `writeAuditLog` for the `Request` UPDATE gains:

```ts
newValue: {
	attempt,
	stage: step.stage,
	decision,
	status: transition.status,
	...(usedDocVerifierCarveOut(sod, ctx.actorRoles) && { selfVerifiedEvidence: true })
}
```

**Satisfies:** AC-19, AC-20, AC-21, AC-22.

---

### Commit 6 — `feat(payroll): the proposer of a statutory rate change cannot confirm it (#283)`

**Files:** `src/lib/server/services/payroll/statutory-rates.ts`,
`tests/unit/payroll-statutory-proposal.test.ts`.

**Placement — service, inside `confirmProposal`, inside the transaction, immediately after the
claim.** Not in the route (`+page.server.ts:184,213,224`), per the repo's guard-placement rule and
#282's own record that a route-only guard *was* the bug. The claim is a status-guarded
`updateMany` that must happen first (it is the race guard); the `error()` throw after it rolls the
claim back to PENDING, which is exactly what AC-14 asserts.

```ts
const proposal = await tx.statutoryRateProposal.findUniqueOrThrow({ where: { id: proposalId } })

// GUARDRAIL (#283/F2): the proposer may not confirm their own proposal. The two gates are
// disjoint TODAY only by accident of single-role assignment (propose is HR-Admin-only, confirm is
// CEO/Super-Admin-only), so one [HR_ADMIN, CEO] user collapses #220's two-person rule entirely.
// Mirrors assertMayDecide in services/action-proposals.ts, which already implements exactly this
// check — the two propose→confirm implementations disagreed until now.
//
// CONFIRM only (Q2). Self-REJECT stays allowed and reads as withdrawing a mistake: it applies
// nothing, writes no rate config, and leaves the tax tables untouched.
if (proposal.proposedById === ctx.actorId) {
	error(403, 'You cannot confirm a rate change you proposed yourself.')
}
```

`rejectProposal` is **not** changed (Q2).

**Satisfies:** AC-13, AC-14, US-7.

---

### Commit 7 — `feat(recruitment): bind the department posting approver and bar the submitter (#283)`

The F4 guard. **Three separate changes in one commit — they are one function's coherence, but they
must be reviewed as three.** **Files:** `src/lib/server/services/recruitment.ts`,
`src/routes/(app)/dashboard/+page.server.ts`, new `tests/unit/recruitment-posting-sod.test.ts`.

**(a) The mapping binds — delete the dead line (D8).**

```ts
export function canApprovePosting(
	resolvedApproverEmployeeId: string | null,
	actorEmployeeId: string | null,
	actorRoles: Role[]
): boolean {
	if (resolvedApproverEmployeeId && actorEmployeeId === resolvedApproverEmployeeId) return true
	// #283/D8: HR is the FALLBACK, not an override. `return canAny(actorRoles, 'MANAGE_HR')` used
	// to sit below this line and answered the same question unconditionally, which made this branch
	// unreachable and the department mapping decorative. A mapped department is now decidable only
	// by its designated approver; only an UNMAPPED one falls back to HR — which is what this
	// function's comment and posting-approvers.ts:6-11 always claimed.
	return !resolvedApproverEmployeeId && canAny(actorRoles, 'MANAGE_HR')
}
```

(Written as the single surviving return rather than leaving `:121` as an `if` with nothing after
it. Same predicate, one statement.)

Update the doc comment above the function: *"the department's designated approver, or — only when
no approver is mapped — any HR admin."* The old "and an override for HR-mapped or unmapped
departments" is now false.

**Reachability is safe (RC-9):** the decide path is the dashboard card action `decidePosting`
(`dashboard/+page.server.ts:168-198`), which carries **no capability gate**, so a designated
approver holding only `EMPLOYEE` can already reach it today. Binding the mapping does not orphan
any department that has one.

**(b) The submitter may not decide (D9).** In `decideJobPosting`, immediately after the
`canApprovePosting` check at `:139-141`:

```ts
// #283/F4: submitJobPostingForApproval records submittedById (:81) and nothing has ever read it
// back at decision time. One person could submit and approve the same posting.
//
// D9: there is deliberately NO HR-steps-in fallback. If a department's designated approver
// submits a posting for their own department, that posting is undecidable until HR remaps or
// unmaps the department — so the message must NAME that route, or the user is stranded with a
// 403 and no next action.
if (jp.submittedById && jp.submittedById === ctx.actorId) {
	error(
		403,
		'You submitted this posting, so you cannot decide it. Ask HR to reassign this department’s posting approver in Settings → Posting approvers.'
	)
}
```

Service-level, per the repo's guard-placement rule — `decideJobPosting` is the only decision
authority and has one route caller today, but the rule does not bend for that.

**(c) Drop the compensating clause and add the submitter filter.** `listPostingsAwaitingApprover`
gains a 4th parameter `actorUserId: string` and its filter becomes:

```ts
	return pending
		.filter((p) => {
			const approver = approverByDept.get(p.departmentId) ?? null
			// The trailing `&& (approver != null || isHr)` that used to live here existed only
			// because canApprovePosting said yes to every HR admin. With the mapping bound (a) it
			// can never change the result — see plan DECISION-8 for the branch-by-branch proof.
			// The submitter filter mirrors the service guard so the card never offers a posting
			// the action would refuse (same discipline as AC-15 for requests).
			return canApprovePosting(approver, actorEmployeeId, actorRoles) && p.submittedById !== actorUserId
		})
```

`isHr` becomes unused — delete its declaration at `:194` (it is orphaned **by this change**, so
removing it is cleanup of our own mess, not unrelated tidying). `submittedById` is already present:
the `findMany` at `:182` has no `select`, so it returns the full row.

Dashboard call site passes `user.id`.

**Note on key types:** `submittedById`/`ctx.actorId` are **User** ids; `approverId`/`actorEmployeeId`
are **Employee** ids. They are never compared to each other — (b) and (c) compare user-to-user,
`canApprovePosting` compares employee-to-employee. Do not "unify" them.

**New test file `tests/unit/recruitment-posting-sod.test.ts`** — read
`tests/unit/approvals.test.ts` first for the `vi.mock('$lib/server/db')` shape. Cases per AC-23,
AC-24, AC-25, AC-26 in §8.

**Satisfies:** AC-23, AC-24, AC-25, AC-26.

---

### Commit 8 — `test(rbac): E2E for multi-role assignment and decision-time SoD (#283)`

**Files:** `tests/e2e/settings-roles.spec.ts` (new), `tests/e2e/multi-role-sod.spec.ts` (new),
`prisma/seed-core.ts` (one added account; plus the F4 department fixtures — see M-8).

Read `tests/e2e/helpers.ts` and `prisma/seed-e2e.ts` **first** and reuse their login helper and
account constants — do not invent a new harness.

**Seeded two-hat account — worth adding, yes.** One account, `verifier.approver@…` with
`roles: ['VERIFIER', 'APPROVER']`, added to `prisma/seed-core.ts` next to the existing verifier.
Justification: AC-17, AC-19 and the manual script all need a two-hat user, and creating one through the
UI as a test precondition makes the SoD spec depend on the assignment spec passing first. Every
other seed row stays single-role.

**`pnpm check` does not typecheck `prisma/**`** — so this seed edit must be proved by actually
running `pnpm db:seed` and reading the row back with SQL (manual step M-1). This is exactly the
assumption that shipped a broken site in #282.

`tests/e2e/settings-roles.spec.ts` — AC-3: log in as CEO, open Settings → Roles, assert both roles
of the two-hat user are `selected` in the editable control, and that a *different* row's read-only
span lists the same roles in the same comma-joined form.

`tests/e2e/multi-role-sod.spec.ts` — AC-17: the two-hat user verifies a request; the request row
then shows awaiting-approval and the page offers that user **no** approve control; the badge count
does not include it.

**Satisfies:** AC-3, AC-17, and the visible half of AC-15.

---

### Commit 9 — `docs(rbac): record the #283 scope boundary and live verification (#283)`

Small, final. Contents:

1. Update the `#283` pointer comments now made stale (`org.ts` write comment,
   `roles/+page.svelte:105-108`, `api/.../+server.ts` response comment,
   `route-guard-multirole.test.ts` header — **the header's claim that multi-role "is unreachable
   until multi-role assignment ships" is now false and must be corrected; the scan itself, its
   patterns and its assertions stay exactly as they are.** Per SPEC R3, whether the scan still earns
   its keep is a *question* for a later review, not a change here).
2. **No payroll issue is filed any more** — F5 is fixed in commit 4 (DECISION-3 rewritten). Instead,
   add the comment at `OVERRIDE_FINALIZED` scope in the PR body recording what remains open:
   SUPER_ADMIN run+approve+void, which is a capability-table question this PR does not touch.
   `rbac.ts:69-71` already says so; do not duplicate it in a second place.
3. Correct the F3/F4 pointer comments now made stale: `documents.ts:149-150`'s "Role gating is the
   caller's job" is still true and stays; `recruitment.ts:112-113`'s doc comment is updated in
   commit 7, not here.
4. Paste the §9 manual-verification results (M-1..M-9) into the PR body, including the R-J impact
   statement: which existing users lose posting-approval reach.

---

## 8a. New Acceptance Criteria (AC-19..AC-27) — defined here, to be copied into the SPEC

The SPEC carries AC-1..AC-18 and does not yet cover F3/F4/F5. These nine criteria are authored here
so the plan is self-contained; **§16 lists them as SPEC edits to apply.** Same format as the SPEC:
`proven by:` names the scenario, `strategy:` is one of Fully-Automated / Hybrid / Agent-Probe.

**AC-19 — The verifier of a supporting document cannot decide that request.**
Given a user holding `[VERIFIER, APPROVER]` who marked a document on request A as verified, when
they attempt any stage decision on request A, then it is refused and the request stays pending.
- proven by: `approval-self-guard.test.ts › canActOnStage › bars the verifier of a request document from deciding that request`
- strategy: Fully-Automated (unit)

**AC-20 — An `ADMINISTER_SYSTEM` holder is carved out (D7).**
Given a `SUPER_ADMIN` or `CEO` who verified a document on request A, when they decide request A,
then the decision succeeds. The waiver is keyed on the **capability**, never on a rank.
- proven by: `approval-self-guard.test.ts › canActOnStage › lets an ADMINISTER_SYSTEM holder decide a request whose document they verified`
- strategy: Fully-Automated (unit)

**AC-21 — Queues and badges mirror the F3 bar.**
Given a user barred from request A by AC-19, when their pending-work count and approvals queue are
computed, then request A appears in neither.
- proven by: `proposal-queue.test.ts › actionable counts › excludes a request whose document the viewer verified`
- strategy: Fully-Automated (unit)

**AC-22 — Using the carve-out is recorded in the audit trail.**
Given the AC-20 case, when the decision is written, then its `Request` UPDATE audit entry carries
`selfVerifiedEvidence: true`; an ordinary decision by someone who verified nothing does not.
- proven by: `approvals.test.ts › decide › records selfVerifiedEvidence when the carve-out is used`
- strategy: Fully-Automated (unit)

**AC-23 — A mapped department's postings are decidable only by its designated approver (D8).**
Given a department with a `PostingApprover` mapping, when an HR admin who is **not** that approver
tries to decide one of its postings, then it is refused.
- proven by: `recruitment-posting-sod.test.ts › canApprovePosting › a mapped department is decidable only by its designated approver`
- strategy: Fully-Automated (unit)

**AC-24 — An unmapped department still falls back to HR.**
Given a department with no mapping, when any `MANAGE_HR` holder decides one of its postings, then
the decision succeeds.
- proven by: `recruitment-posting-sod.test.ts › canApprovePosting › an unmapped department still falls back to any MANAGE_HR holder`
- strategy: Fully-Automated (unit)

**AC-25 — The submitter of a posting cannot decide it, and the refusal names the way out (D9).**
Given a user who submitted a posting for approval, when they try to approve or reject it, then it
is refused, nothing is written, and the message tells them to ask HR to reassign the department's
posting approver in Settings → Posting approvers.
- proven by: `recruitment-posting-sod.test.ts › decideJobPosting › refuses the submitter and names the remap route`
- strategy: Fully-Automated (unit)

**AC-26 — The dashboard card mirrors the F4 submitter bar.**
Given the AC-25 user, when their awaiting-approval card is built, then the posting they submitted
is not listed.
- proven by: `recruitment-posting-sod.test.ts › listPostingsAwaitingApprover › omits postings the viewer submitted`
- strategy: Fully-Automated (unit)

**AC-27 — The verifier of a payroll run cannot approve it (F5).**
Given a user holding `[VERIFIER, CEO]` who recorded the VERIFY decision on a payroll run attempt,
when they attempt the APPROVE decision on that same attempt, then it is refused, the run is not
marked APPROVED, and it is excluded from their actionable-runs count.
- proven by: `approvals.test.ts › decidePayrollRun › a VERIFIER+CEO cannot approve a run they verified` + `› countActionablePayrollRuns › excludes it`
- strategy: Fully-Automated (unit)

---

## 8b. Test Plan — per Acceptance Criteria

Tier legend: **FA** Fully-Automated · **H** Hybrid · **AP** Agent-Probe.

Every guard row carries a **mutation check**: the exact source edit that must turn the test red.
This repo has shipped tests that passed for the wrong reason — a 200-status assertion on a route
that always returns 200 proves only that nothing threw. **Assert the arguments, not the status.**

| AC | Test file › case | Tier | Commit | Mutation that must turn it red |
|---|---|---|---|---|
| AC-1 | `user-admin-self-guard.test.ts › setUserRoles › assigns a multi-role set and the union of capabilities holds` | FA | 1 | change the write to `data: { roles: [roles[0]] }` |
| AC-2 | `api-v1-user-roles.test.ts › accepts a role set and enforces the same guards` (assert the **args** passed to `setUserRoles`) | FA | 3 | change the handler to pass `[parsed.data.roles[0]]` |
| AC-3 | `e2e/settings-roles.spec.ts › prefills every held role in the picker` | FA (E2E) | 8 | change `selected={u.roles.includes(r)}` to `selected={u.roles[0] === r}` |
| AC-4a | `user-admin-self-guard.test.ts › setUserRoles › refuses an empty role set` (assert 400 **and** that `db.$transaction` was never called) | FA | 1 | delete the `roles.length === 0` guard |
| AC-4b | `api-v1-user-roles.test.ts › rejects an empty roles array` (assert `setUserRoles` **not called**) | FA | 3 | change `.nonempty()` to `.array()` |
| AC-5 | `user-admin-self-guard.test.ts › setUserRoles › refuses to drop the last CEO from a multi-role set` | FA | 1 | pass `existing.roles` instead of `roles` to `assertNotLastOfRole` |
| AC-6 | `user-admin-self-guard.test.ts › setUserRoles › reports every irreplaceable role lost` | FA | 1 | `break` after the first `lost` iteration in `assertNotLastOfRole` |
| AC-7 | `user-admin-self-guard.test.ts › setUserRoles › does not block re-saving an existing set` (supersedes `:233`) | FA | 1 | make `assertNotLastOfRole` key on `newRoles` membership instead of loss |
| AC-8 | existing self-change cases, extended to sets (form + API) | FA | 1,3 | delete the `userId === ctx.actorId` block |
| AC-9 | `approval-self-guard.test.ts › canActOnStage › bars an actor from a second stage of the same attempt` | FA | 4 | delete the `sod.decidedActorIds.includes` line |
| AC-10 | `approval-self-guard.test.ts › canActOnStage › does not leak the bar across requests` | FA | 4 | make `decidedActorIds` ignore its `attempt` argument **and** widen the caller to all requests |
| AC-11 | `approval-self-guard.test.ts › canActOnStage › covers MAKE+VERIFY, VERIFY+APPROVE, and all three` | FA | 4 | restrict the predicate to `stage === 'APPROVE'` |
| AC-12 | `approval-self-guard.test.ts › canActOnStage › treats the auto-completed MAKE as a decision` | FA | 4 | add `&& s.decidedAt != null && s.stage !== 'MAKE'` to `decidedActorIds` |
| AC-15 | `proposal-queue.test.ts › actionable counts › excludes items barred by the same-actor guard` | FA | 4 | pass `{ actorId: null, decidedActorIds: [] }` from `listPendingRequestsForApprover` |
| AC-13 | `payroll-statutory-proposal.test.ts › confirmProposal › refuses the proposer` | FA | 6 | delete the `proposedById === ctx.actorId` block |
| AC-14 | `payroll-statutory-proposal.test.ts › confirmProposal › rolls back cleanly when the proposer is refused` — assert `updateStatutoryRateConfig` was **not** called and no APPLIED audit entry was written | FA | 6 | move the guard *after* `updateStatutoryRateConfig` |
| — (Q2) | `payroll-statutory-proposal.test.ts › rejectProposal › allows the proposer to withdraw their own proposal` | FA | 6 | add the same bar to `rejectProposal` |
| AC-16 | `route-guard-multirole.test.ts` — existing scan, **assertions unchanged** | FA | 1,3 | (regression net; it must stay green throughout) |
| AC-17 | `e2e/multi-role-sod.spec.ts › two-hat user verifies then cannot approve` | FA (E2E) | 8 | any of the AC-9 mutations |
| AC-18 | existing CI populated-DB push gate (#236 / PR #284) + manual step M-1 | H | 8 | — |
| **AC-19** | `approval-self-guard.test.ts › canActOnStage › bars the verifier of a request document from deciding that request` | FA | 5 | delete the `verifiedDocActorIds.includes` line |
| **AC-20** | `approval-self-guard.test.ts › canActOnStage › lets an ADMINISTER_SYSTEM holder decide a request whose document they verified` | FA | 5 | delete `&& !canAny(actorRoles,'ADMINISTER_SYSTEM')` (bar becomes absolute — this case turns red) |
| **AC-21** | `proposal-queue.test.ts › actionable counts › excludes a request whose document the viewer verified` | FA | 5 | drop `verifiedById: true` from `listPendingRequestsForApprover`'s `documents` select (the silent-failure mode — the array goes empty and the bar quietly stops existing) |
| **AC-22** | `approvals.test.ts › decide › records selfVerifiedEvidence when the carve-out is used` — assert the **audit payload**, and assert it is **absent** on an ordinary decision | FA | 5 | make `usedDocVerifierCarveOut` return `false` unconditionally |
| **AC-23** | `recruitment-posting-sod.test.ts › canApprovePosting › a mapped department is decidable only by its designated approver` — asserts an `HR_ADMIN` who is not the approver is refused | FA | 7 | restore `return canAny(actorRoles,'MANAGE_HR')` |
| **AC-24** | `recruitment-posting-sod.test.ts › canApprovePosting › an unmapped department still falls back to any MANAGE_HR holder` | FA | 7 | change the surviving return to `false` |
| **AC-25** | `recruitment-posting-sod.test.ts › decideJobPosting › refuses the submitter and names the remap route` — asserts 403, asserts `db.jobPosting.update` was **not** called, and asserts the message contains `Settings → Posting approvers` | FA | 7 | delete the `submittedById === ctx.actorId` block |
| **AC-26** | `recruitment-posting-sod.test.ts › listPostingsAwaitingApprover › omits postings the viewer submitted` | FA | 7 | drop the `p.submittedById !== actorUserId` filter |
| **AC-27** | `approvals.test.ts › decidePayrollRun › a VERIFIER+CEO cannot approve a run they verified` + `› countActionablePayrollRuns › excludes it` — assert the refusal **and** that `payrollRun.update` was not called | FA | 4 | pass `{ actorId: null, decidedActorIds: [] }` from `canActOnPayrollStage` |
| — (F5 msg) | `approvals.test.ts › decidePayrollRun › the maker still gets the specific "you prepared" message` | FA | 4 | move the maker block back below the `canActOnPayrollStage` call (the generic message wins → red) |
| DEC-2 | `approvals.test.ts › countActionableTimesheets › excludes a timesheet the viewer already decided` | FA | 4 | drop `actorId: true` from the timesheet select (the silent-failure mode) |

**Regression suites that must stay green and are not allowed to be weakened:**
`route-guard-multirole.test.ts` (AC-16 / SPEC R3), `rbac-no-rank-helpers.test.ts`,
`rbac.test.ts`, `action-proposals.test.ts`, `approvals.test.ts`.

**Known gaps (residual, recorded not silently dropped):**

| Gap | Why | Resolution |
|---|---|---|
| Empty role set written outside the service (seed, script, manual SQL) — SPEC R1 | D4 rules out a DB check constraint | Accepted. Mitigation: every application path refuses it. Backlog stub: *"raw-SQL check constraint for non-empty `User.roles`"* — file at UPDATE-PROCESS. |
| ~~Payroll verify→approve collapse under multi-role~~ | **Closed** — F5 is now in scope (D10 / DECISION-3 rewritten) | Fixed in commit 4. AC-27. |
| SUPER_ADMIN run + approve + void the same payroll (`OVERRIDE_FINALIZED`) | Single-role reachable **and** a capability-table question; this PR does not touch the capability table (§11 item 6) | Accepted, out of scope. `rbac.ts:69-71` already records it. Recommend filing as its own issue at UPDATE-PROCESS. |
| An `ADMINISTER_SYSTEM` holder can still self-verify **and** self-decide | Deliberate — D7's carve-out | Accepted. Mitigated by AC-22's audit marker, not by a bar. |
| A posting can become undecidable when its designated approver submits it | Deliberate — D9, no HR fallback | Accepted. The 403 names the remap route (AC-25). Risk R-K. |
| Separation/offboarding: one actor can clear every clearance item **and** finalize the separation (`separation.ts:135` `clearedById`, `:247` `finalizedById`) | Found in the §8c sweep. Not a separation-of-duties hole: clearance is a **checklist**, not a two-person control — no second-person rule was ever declared for it, so there is nothing to collapse | Out of scope. Recommend filing as a design question ("should clearance sign-off be a second-person control?"), not as a bug. |
| Touch usability of `<select multiple>` | Native-platform choice, no picker library | Accepted, recorded in commit 2. |

---

---

## 8c. Completeness Sweep — every other multi-stage flow (NEW-4)

Scope now reads "close every same-actor separation-of-duties hole", so the seven flows named in the
brief were re-checked against `9a5df08`. **Nothing was silently added to the plan.** Findings:

| Flow | Finding | Verdict |
|---|---|---|
| **Leave approval** | Leave runs the ordinary `Request` maker-checker chain (`leave.ts` holds balance arithmetic only; its single `ctx.actorId` use at `:101` is a lookup, not a decision). | **Already covered** by F1 + F3 via `decide()`. No separate work. |
| **Timesheet review** | `timesheets.ts:362` runs the same `canActOnStage`. | **Already in the plan** (DECISION-2, commit 4). |
| **Document requests** | These *are* `Request` rows with `RequestDocument` attachments. | **This is F3.** In scope, commit 5. |
| **#224 action proposals** | `assertMayDecide` (`action-proposals.ts:60-87`) already bars (1) the initiator, (2) the employee the change is about, and (3) anyone without the shape-appropriate confirmer capability. Verified complete — it is the **stronger** of the two propose→confirm implementations and is what commit 6 makes `confirmProposal` match. | **Complete, no change.** |
| **Performance reviews** | `reviewerId` is assigned from `reportsToId` (`performance.ts:224`); `updateReview` refuses a non-reviewer (`:125`) and `acknowledgeReview` refuses anyone but the subject (`:157`). Reviewer and subject are different people **by construction**. | **No gap.** |
| **Offboarding / separation** | `separation.ts` — one actor can mark every `ClearanceItem` cleared (`:135` `clearedById`) and then finalize the separation (`:247` `finalizedById`). Same actor, two steps. | **Out of scope — recommend filing as a design question, not a bug.** Reason: clearance is a *checklist*, not a declared two-person control. There is no propose→confirm, no approval chain, and no second-person rule anywhere in the flow — so nothing collapses; the control simply never existed. Adding one is a product decision (who signs clearance?), not a hole this PR closes. |
| **Loans** | No loan service exists. `Loan` rows are written by payroll and settled by `separation.ts:254`; there is no multi-stage loan approval flow to have a same-actor gap in. | **Nothing to check.** |

**Recommended to file separately (two issues, neither added to this plan):**

1. *"Should clearance sign-off be a second-person control?"* — the separation finding above.
2. *"SUPER_ADMIN can run, approve and void the same payroll"* — the surviving `OVERRIDE_FINALIZED`
   item; a capability-table question, explicitly untouched here (§11 item 6).

---

## 9. Manual Verification Script (run BEFORE the final push)

The repo's rhythm is verify live, then commit. Run this after commit 6 and paste the output into
the PR body.

```bash
# M-0 — start the database and the app
./start.sh                      # Docker container veent-db-5434, host networking
pnpm db:push && pnpm db:seed    # proves the seed-core.ts edit actually runs (pnpm check does NOT
                                # typecheck prisma/** — #282 shipped a broken site on that assumption)
pnpm dev                        # http://localhost:5173 ; env comes from .env.dev — there is no .env
```

```bash
# M-1 — the seeded two-hat account really has two roles
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris -c \
  "select email, roles from \"User\" where array_length(roles,1) > 1 order by email;"
# expect exactly the one seeded VERIFIER+APPROVER account
```

**M-2 — the form (AC-1, AC-3, AC-4, AC-7, AC-8, US-2).** Log in as the CEO, open
`/settings/roles`.

1. The two-hat row shows **both** roles highlighted in the multi-select; another row's read-only
   span lists the same roles comma-joined.
2. Ctrl-click to add `HR_ADMIN` to a plain `EMPLOYEE`, Save → inline success, control reopens with
   both selected.
3. Ctrl-click everything off, Save → inline error *"A user must keep at least one role."*
4. Save the CEO row unchanged → succeeds, no 409.
5. Change the sole CEO's set to one without `CEO` → inline 409 naming CEO.
6. The CEO's own row shows no editable control.

```bash
# verify #2 and #3 landed / did not land
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris -c \
  "select email, roles from \"User\" where email = '<the edited user>';"
# verify the audit entry now carries a SET on both sides (Q4)
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris -c \
  "select \"createdAt\", \"oldValue\", \"newValue\" from \"AuditLog\"
   where \"entityType\" = 'User' order by \"createdAt\" desc limit 3;"
```

**M-3 — the v1 twin (AC-2, AC-4, US-5).** Use the `_dev/login-as` harness
(`src/routes/api/v1/_dev/login-as`) to obtain a CEO session cookie into a jar, then:

```bash
COOKIE=/tmp/veent.jar
curl -s -c $COOKIE -X POST localhost:5173/api/v1/_dev/login-as \
  -H 'content-type: application/json' -d '{"email":"<ceo email>"}'

# accepts a set (expect 200 and the full set echoed back)
curl -s -b $COOKIE -X PATCH localhost:5173/api/v1/settings/users/<id>/roles \
  -H 'content-type: application/json' -d '{"roles":["HR_ADMIN","VERIFIER"]}'

# refuses the empty set (expect 422, and NOTHING written)
curl -s -b $COOKIE -X PATCH localhost:5173/api/v1/settings/users/<id>/roles \
  -H 'content-type: application/json' -d '{"roles":[]}'

# the old path is gone (expect 404 — proves the rename, and that nothing silently still serves it)
curl -s -o /dev/null -w '%{http_code}\n' -b $COOKIE \
  -X PATCH localhost:5173/api/v1/settings/users/<id>/role \
  -H 'content-type: application/json' -d '{"role":"HR_ADMIN"}'
```

```bash
# prove the empty-set call wrote nothing
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris -c \
  "select email, roles from \"User\" where id = '<id>';"
```

**M-4 — F1 live (AC-9, AC-12, AC-15, US-6, US-8).** As the two-hat `[VERIFIER, APPROVER]` user:
verify a pending request, then reload `/requests/approvals`. The request must **not** appear in the
actionable list and must **not** be in the sidebar badge count. Then confirm another approver still
sees and can approve it. Separately, as an `HR_ADMIN` filer (filer-is-maker path), file a request
and confirm you cannot then verify it.

```bash
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris -c \
  "select r.id, r.status, r.\"currentStage\", s.attempt, s.\"stageIndex\", s.stage, s.decision, s.\"actorId\"
   from \"Request\" r join \"ApprovalStep\" s on s.\"requestId\" = r.id
   where r.id = '<request id>' order by s.attempt, s.\"stageIndex\";"
```

**M-5 — F2 live (AC-13, AC-14, Q2).** As a user holding `[HR_ADMIN, CEO]` (grant it via M-2),
propose a statutory-rate change at `/settings/statutory-rates`, then try to confirm it → refused.
Then reject it → allowed.

```bash
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris -c \
  "select id, status, \"proposedById\", \"decidedById\" from \"StatutoryRateProposal\"
   order by \"createdAt\" desc limit 3;"
# after the refused confirm: status must still be PENDING and decidedById NULL (the claim rolled back)
```

**M-7 — F3 live (AC-19, AC-20, AC-21, AC-22).** As the two-hat `[VERIFIER, APPROVER]` user, open a
pending request that has a supporting document, click **Verify** on the document, then reload
`/requests/approvals`.

1. The request must **not** be actionable for that user at **any** stage, and must not be in the
   sidebar badge count (AC-19, AC-21).
2. The document's owner must now get a 409 if they try to remove that file — this is the existing
   `documents.ts:192` behaviour and is the evidence for DECISION-6b (the artefact cannot change).
3. Log in as the **CEO** (holds `ADMINISTER_SYSTEM`), verify a document on a *different* pending
   request, then decide that request. It must **succeed** (AC-20).

```bash
# who verified what, and did the carve-out get recorded?
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris -c \
  "select d.id, d.\"requestId\", d.\"verifiedById\", d.\"verifiedAt\"
   from \"request_documents\" d where d.\"verifiedAt\" is not null order by d.\"verifiedAt\" desc limit 5;"

# AC-22: the CEO's decision must carry selfVerifiedEvidence; the ordinary one must NOT
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris -c \
  "select \"createdAt\", \"entityId\", \"newValue\" from \"AuditLog\"
   where \"entityType\" = 'Request' order by \"createdAt\" desc limit 5;"
```

**M-8 — F4 live (AC-23, AC-24, AC-25, AC-26).** This step needs **two departments: one WITH a mapped
approver and one WITHOUT.** Create them through the product, not by hand — the mapping table is
`PostingApprover` and the UI writes it:

1. As an `HR_ADMIN` or CEO, open **Settings → Posting approvers**. The page lists every department
   with its current approver (`listPostingApprovers`). Pick two departments; set an approver on the
   first (choose an employee who is **not** an HR admin), and leave the second's approver **unset**.
2. Confirm the fixture is what you think it is before testing anything:

```bash
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris -c \
  "select d.id, d.name, pa.\"approverId\"
   from \"departments\" d left join \"posting_approvers\" pa on pa.\"departmentId\" = d.id
   order by d.name;"
# expect exactly one row with a non-null approverId and at least one with null
```

*(If the table names differ, list them with `\dt` — the app's Prisma `@@map` names are snake_case.)*

3. **AC-23:** as an HR admin who is **not** the mapped approver, create + submit a posting in the
   **mapped** department, then open `/dashboard`. The posting must **not** appear on the
   awaiting-approval card, and forcing the action must 403.
4. **AC-24:** submit a posting in the **unmapped** department. Any HR admin must see it on the card
   and be able to approve it.
5. **AC-25 + D9:** log in as the **mapped approver**, create + submit a posting for their own
   department, then try to decide it. Refused, and **the message must name Settings → Posting
   approvers.** Then have HR unmap the department and confirm the posting becomes decidable — this
   is the escape hatch working end to end.
6. **AC-26:** the posting from step 5 must be absent from the submitter's own dashboard card.

```bash
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris -c \
  "select id, title, status, \"submittedById\", \"approvedById\", \"departmentId\"
   from \"job_postings\" order by \"updatedAt\" desc limit 5;"
# after the refused decide: status must still be PENDING_APPROVAL and approvedById NULL
```

**M-9 — F5 live (AC-27).** Grant one account `[VERIFIER, CEO]` via M-2. Compute a payroll run as
someone else (so the maker guard is not what fires), verify it as the two-hat user, then try to
approve it as the same user → refused, and the run must be absent from their payroll badge count.
Then approve it as a different `APPROVE_FINANCE` holder and confirm it goes through.

```bash
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris -c \
  "select r.id, r.status, s.attempt, s.\"stageIndex\", s.stage, s.decision, s.\"actorId\"
   from \"payroll_runs\" r join \"approval_steps\" s on s.\"payrollRunId\" = r.id
   where r.id = '<run id>' order by s.attempt, s.\"stageIndex\";"
# after the refused approve: run status must still be COMPUTED and approvedById NULL
```

**M-6 — gates, in CI order.**

```bash
pnpm format:check && pnpm lint && pnpm check && pnpm test && pnpm test:e2e
```

---

## 10. Risk Register + Rollback

| # | Risk | Likelihood | Mitigation | Rollback |
|---|---|---|---|---|
| **R-A** | `Object.fromEntries` collapses the multi-select and silently saves one role | High if forgotten — **it is invisible**, no error anywhere | `getAll` is mandated in commit 2; E2E AC-3 + manual M-2 step 2 both catch it | revert commit 2 |
| **R-B** | A call site passes the `sod` sentinel and the guard silently does nothing there | Medium | Required parameter at position 5 = compile error; plus the DEC-2 mutation-check row that specifically covers the `actorId: true` select omission | one-line fix |
| **R-C** | `countActionableTimesheets`' select lacks `actorId` → `decidedActorIds` always empty → badge lies | Medium (easy to miss; TypeScript will *not* catch it because the field is simply absent from the selected type — it becomes a compile error only if the helper's param type demands it) | Type `decidedActorIds`' parameter to require `actorId: string \| null`, which turns the omission into a compile error. Verify this holds during EXECUTE. | one-line select fix |
| **R-D** | Seed/script breakage invisible to `pnpm check` (SPEC R2, #282's exact failure) | Medium | No seed *needs* the new signature (none calls it); the one seed addition is proved by running `pnpm db:seed` + M-1 SQL | revert commit 6's seed hunk |
| **R-E** | Large diff across 14+14 guard tests is hard to review (SPEC R5) | High | Split across commits 1/4/5 so each is reviewable alone; all are fast unit tests | per-commit revert |
| **R-F** | Empty role set via raw SQL / future script → unrecoverable lockout (SPEC R1, D4) | Low | Accepted residual. Every application path refuses it. Backlog stub filed. **Recovery if it happens:** direct SQL `update "User" set roles = '{EMPLOYEE}' where id = …` — document this in the PR body. | n/a |
| **R-G** | The renamed v1 path breaks an unknown consumer | Very low | Verified: `/api/v1/*` authenticates by Lucia session cookie only, no API-key/bearer mechanism exists anywhere, zero in-repo callers | `git mv` back; the directory rename is the whole change |
| **R-H** | The F1 guard is too strict and deadlocks a small org's request | Low | Attempt-scoped per Q1: a RETURN clears the bar, so a request can always progress after a re-file | flip `sod.actorId` to `null` at `decide()` — one line, instantly disables |

| **R-J** | **Binding the posting mapping (D8) is a live behaviour change: people who can approve a posting today cannot tomorrow.** Concretely: every holder of `MANAGE_HR` — `MANAGER`, `HR_ADMIN`, `SUPER_ADMIN`, `CEO` (`rbac.ts:26`, RC-12) — loses the ability to decide postings in **any department that has a `PostingApprover` row**, unless they are that row's approver. Departments with no mapping are unaffected. | Certain, by design | Not mitigated — it is the point of D8. **Made visible instead:** M-8 step 2 prints the exact mapped-department list before testing, and commit 9 pastes that list into the PR body so reviewers see who is affected in the seeded/staging data. AC-24 pins that the unmapped fallback still works. | revert commit 7 — it is one function and one filter |
| **R-K** | **A posting can become undecidable (D9).** If a department's designated approver submits a posting for their own department, F4(b) refuses them and F4(a) refuses everyone else. | Low but certain when it happens | Accepted by D9 — no HR-steps-in fallback. **The 403 message names the escape hatch** (remap or unmap the department in Settings → Posting approvers), which AC-25 asserts on the message text, not just the status. M-8 step 5 walks the hatch end to end. | HR remaps the department; no code change needed |
| **R-L** | **The D7 carve-out is a privileged path that could be used silently.** An `ADMINISTER_SYSTEM` holder may verify the evidence and then decide the request, which is exactly the collapse F3 exists to prevent — permitted only because the user chose it as the escape hatch. | Certain by design | The waiver must not be invisible: `usedDocVerifierCarveOut` sets `selfVerifiedEvidence: true` on the decision's audit entry, and **only** when the waiver actually fired (AC-22 asserts both the presence and the absence). The audit trail is the control here, not a bar. | remove the carve-out — one `&&` clause — if the audit shows it being used routinely |
| **R-M** | **F3's `verifiedDocActorIds` silently empties if a `select` forgets `verifiedById`** — the same quiet-failure shape as R-C. TypeScript will not catch a *missing* field. | Medium | Type `StageSoD.verifiedDocActorIds` as required (not optional) so every construction site is a compile error, and give AC-21 the mutation check "drop `verifiedById` from the select" so a regression is caught by a test, not by review. | one-line select fix |

### R-I — Session freshness when a role set changes mid-session

**Answer: role changes take effect on the target's very next request. No re-login, no session
invalidation, and no cache to bust.**

Evidence: `src/lib/server/auth.ts:12` builds Lucia with `PrismaAdapter(db.session, db.user)`, and
`getUserAttributes` at `:14-22` maps `attributes.roles` straight through. Lucia v3's
`validateSession` reads the session **and its joined user row from the database on every call**;
`src/hooks.server.ts` calls it per request and assigns the result to `event.locals.user` at `:36-39`,
merging only the effective org id. Nothing in the chain memoises the role array, and the session
cookie carries only the session id. So a user granted `VERIFIER` mid-session sees verifier surfaces
on their next navigation, and a user whose set is narrowed loses access immediately.

Two consequences worth stating: (1) there is no window where a demoted user retains capabilities;
(2) the F1/F2 guards read `ctx.actorRoles`/`ctx.actorId` from that same per-request read, so they
cannot be evaded by holding an old session open.

### Rollback of the whole change

Every commit is independently revertable and there is **no schema migration and no data
backfill** (AC-18), so rollback is `git revert` of the PR merge commit with no database action. The
only forward-only artefact is the audit-entry shape (`newValue: { roles }`), which is additive —
historical singular entries are untouched and a revert simply resumes writing the singular key.

---

## 11. Explicit Non-Goals (EXECUTE must not drift into these)

Restating the scope boundary **as widened on 11-08-26**. Items 1–3 below previously excluded F3, F4
and the payroll gap; **all three of those exclusions are now void** — see D7/D8/D9/D10. What remains
out of scope:

1. ~~**F3**~~ — **now IN scope** (commit 5, D7, AC-19..AC-22).
2. ~~**F4**~~ — **now IN scope** (commit 7, D8/D9, AC-23..AC-26).
3. **SUPER_ADMIN run + approve + void payroll** via `OVERRIDE_FINALIZED`. Still out. It is
   single-role reachable **and** a capability-table question, and item 6 below forbids touching the
   capability table. `rbac.ts:69-71` already records it. (The payroll **verify→approve** gap that
   used to be filed alongside it is **now IN scope** as F5 — commit 4, AC-27.)
3b. **Clearance-then-finalize in `separation.ts`** (§8c sweep). Out: no second-person control was
   ever declared for clearance, so there is nothing to collapse. Recommended as its own design
   question.
4. **Custom / tenant-defined roles or an editable permission matrix.** Ruled out by the issue itself.
5. **Any change to the hire form or `HIRE_ROLES`** (D3). Still one role, still the reduced 3-role
   list. Do not touch `src/lib/rbac.ts:172`.
6. **Any change to the capability table** — which capability each role holds is unchanged.
7. **The `MANAGE_USER_ROLES` sole-holder problem** (D5). Acknowledged, not addressed.
8. **A database check constraint forbidding an empty role array** (D4). Application-layer only.
9. **Editing `src/lib/server/services/requests/documents.ts`.** F3's bar is on *deciding*, not on
   *verifying*; `setRequestDocumentVerified` keeps its org-scoping-only contract and the 409 at
   `:192` stays exactly as it is (DECISION-6b depends on it).
10. **Adding an `attempt` column to `RequestDocument`,** or any other schema change. AC-18 holds for
   the widened scope too — that is why F3 is per-request (DECISION-6b).
11. **Any rank, level, seniority or hierarchy concept** anywhere in the F3 carve-out. D7 is
   `canAny(actorRoles, 'ADMINISTER_SYSTEM')` and nothing else. `rbac-no-rank-helpers.test.ts` must
   stay green.
12. **An HR-steps-in fallback for an undecidable posting** (D9). The remap route is the answer.
13. **Deleting, weakening, or loosening `route-guard-multirole.test.ts`** (SPEC R3). Its fixture
   strings are refreshed to keep mirroring the tree and its stale header claim is corrected; its
   patterns and assertions are untouched. If widening the picker trips the scan, that is a signal to
   inspect the flagged line, **not** to loosen the regex.
14. **Removing `User.roles` in favour of a scalar** (D6). Dead branch.
15. **A picker component or library** for the multi-select. Native `<select multiple>` only.

---

## Verification Evidence (12)

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `pnpm format:check` (FIRST — CI skips everything after it on failure) | Fully-Automated | precondition for all |
| `pnpm lint` | Fully-Automated | precondition for all |
| `pnpm check` (note: excludes `prisma/**`, `scripts/**`) | Fully-Automated | Public-contract signature changes compile at every call site |
| `pnpm test tests/unit/user-admin-self-guard.test.ts` | Fully-Automated | AC-1, AC-4a, AC-5, AC-6, AC-7, AC-8 |
| `pnpm test tests/unit/api-v1-user-roles.test.ts` (new) | Fully-Automated | AC-2, AC-4b |
| `pnpm test tests/unit/approval-self-guard.test.ts` | Fully-Automated | AC-9, AC-10, AC-11, AC-12, AC-19, AC-20 |
| `pnpm test tests/unit/approvals.test.ts` | Fully-Automated | DECISION-2 timesheet mirror; F1 signature regression; AC-22, AC-27 |
| `pnpm test tests/unit/rbac-no-rank-helpers.test.ts` | Fully-Automated | D7 introduced no rank concept |
| `pnpm test tests/unit/proposal-queue.test.ts` | Fully-Automated | AC-15, AC-21 |
| `pnpm test tests/unit/recruitment-posting-sod.test.ts` (new) | Fully-Automated | AC-23, AC-24, AC-25, AC-26 |
| `pnpm test tests/unit/payroll-statutory-proposal.test.ts` | Fully-Automated | AC-13, AC-14, Q2 |
| `pnpm test tests/unit/route-guard-multirole.test.ts` | Fully-Automated | AC-16 |
| `pnpm test:e2e tests/e2e/settings-roles.spec.ts` (new) | Fully-Automated | AC-3 |
| `pnpm test:e2e tests/e2e/multi-role-sod.spec.ts` (new) | Fully-Automated | AC-17 |
| Manual M-1 — `pnpm db:seed` + psql read of multi-role rows | Hybrid (running DB required) | AC-18, SPEC R2 (seed not typechecked) |
| Manual M-2 / M-3 — form + curl with psql read-back | Hybrid | AC-1..AC-4, AC-7, AC-8, US-2, US-5 |
| Manual M-4 / M-5 — live SoD with psql step read-back | Hybrid | AC-9, AC-12, AC-13, AC-14, AC-15, US-6, US-7, US-8 |
| Manual M-7 — F3 live, incl. the CEO carve-out and the audit read-back | Hybrid | AC-19, AC-20, AC-21, AC-22 |
| Manual M-8 — F4 live with a mapped **and** an unmapped department, incl. walking the D9 hatch | Hybrid | AC-23, AC-24, AC-25, AC-26, R-J, R-K |
| Manual M-9 — F5 live payroll verify→approve with psql step read-back | Hybrid | AC-27 |
| CI populated-DB push gate (#236 / PR #284) | Hybrid | AC-18 |
| Mutation checks in §8 (one per guard) | Agent-Probe (EXECUTE performs each mutation, confirms red, reverts) | that every guard test fails for the right reason |

---

## Test Infra Improvement Notes (13)

- No test file existed for the v1 API twin before this change — `tests/unit/api-v1-user-roles.test.ts`
  is the first. Consider whether other `/api/v1/*` handlers deserve the same (out of scope here).
- `tests/e2e` has no roles/settings spec today; `settings-visibility.spec.ts` and `admin.spec.ts`
  should be read during commit 6 to avoid duplicating an existing fixture.
- `tests/unit/proposal-queue.test.ts:257` is the **only** multi-role fixture in the whole tree
  before this change. After this PR there will be many; a shared multi-role fixture helper may be
  worth extracting at UPDATE-PROCESS (not now — single-use).
- SPEC R3's open question — does `route-guard-multirole.test.ts` still earn its keep once
  behavioural multi-role tests exist? — should be revisited at UPDATE-PROCESS, not decided here.
- **No test file covers `recruitment.ts` at all** before this change; `recruitment-posting-sod.test.ts`
  is the first. The rest of that service (offers, interviews, applicant conversion) stays untested —
  worth a backlog note at UPDATE-PROCESS, out of scope here.
- **No E2E covers job postings or posting approvers.** F4 is proved by unit tests + manual M-8. If
  the D8 behaviour change causes friction in staging, an E2E for the mapped/unmapped split is the
  first thing to add.
- After this PR, `StageSoD` has three fields constructed at **eight** call sites. If a ninth appears,
  extract a `sodFor(request, ctx)` builder rather than hand-constructing again — not now
  (single-shape, and the compile error is the point).

---

## Resume and Execution Handoff (14)

1. **Selected plan file:** `process/general-plans/active/multi-role-activation-283_11-08-26/multi-role-activation-283_PLAN_11-08-26.md` (this file)
2. **Last completed phase/step:** PLAN complete. No branch cut, no code written.
3. **Validate-contract status:** pending — §15 is a placeholder for vc-validate-agent.
4. **Supporting context loaded:** `process/general-plans/active/multi-role-activation-283_11-08-26/multi-role-activation-283_SPEC_11-08-26.md`
   (the contract), `CLAUDE.md`, and direct reads of `org.ts`, `approvals.ts`, `statutory-rates.ts`,
   `action-proposals.ts`, `routing.ts`, `auth.ts`, `hooks.server.ts`, the roles route + component,
   the v1 twin, and `route-guard-multirole.test.ts`. `process/context/` is deliberately empty in
   this repo — do not run vc-setup and do not block on the bootstrap guard.
5. **Next step for a fresh agent:** VALIDATE this plan. **Before validating, apply the §16 SPEC
   edits** — the SPEC currently contradicts the plan on scope (it lists F3/F4/payroll as out of
   scope) and carries only AC-1..AC-18. After VALIDATE, EXECUTE starts by cutting
   `feat/multi-role-activation-283` off updated local `staging` (`git switch -c`, never
   `checkout -b origin/staging`) and begins at commit 1 (§7). Re-read every file:line in §2 before
   editing — the line numbers are accurate as of `9a5df08` but the SPEC's own experience is that
   line numbers drift. One issue, one PR, **nine** commits; do not fragment across PRs. Never add a
   `Co-Authored-By` trailer.
6. **Scope-widening note:** this plan was extended on 11-08-26 to absorb F3, F4 and F5. Everything
   from the original F1/F2 plan is preserved unchanged except **DECISION-3, which is rewritten**
   (payroll moved from out-of-scope to in-scope) and **§11 items 1–3**, whose exclusions are void.

---

## 15. Phase Completion Rules

This is a single-phase plan (one PR), so "phase" = commit. A commit is **CODE DONE** when its files
are written and `pnpm format:check && pnpm lint && pnpm check && pnpm test` are green at that
commit. A commit is **VERIFIED** only when its rows in §12 Verification Evidence have been executed
and recorded — including the §8 mutation check for every guard it introduces. Commit 8 additionally
requires the §9 manual script (M-1..M-9) to have been run live. The PR is **DONE** only when all
**nine** commits are VERIFIED and **all 27** acceptance criteria (the SPEC's AC-1..AC-18 plus
§8a's AC-19..AC-27) each have a green proving gate.
Code-only completion is CODE DONE, never VERIFIED.

## 16. SPEC Edits Required (list only — the SPEC file is NOT edited by this plan)

The SPEC at `process/general-plans/active/multi-role-activation-283_11-08-26/multi-role-activation-283_SPEC_11-08-26.md` predates the scope
widening and now **contradicts** this plan in five places. Apply these before VALIDATE.

**Contradictions that must be fixed (the SPEC is currently wrong):**

| # | SPEC location | Says now | Must say |
|---|---|---|---|
| S-1 | §Out Of Scope item 1 (line ~327) | "F3 — verifying a request document then deciding that request … filed separately" | **Delete the item.** F3 is in scope (D7). |
| S-2 | §Out Of Scope item 2 (line ~329) | "F4 — approving a job posting you submitted … not fixed here" | **Delete the item.** F4 is in scope (D8/D9). |
| S-3 | §Out Of Scope item 3 (line ~331) | "The SUPER_ADMIN run + approve + void payroll case" | **Narrow it:** keep only the `OVERRIDE_FINALIZED` run+approve+void case; state explicitly that the payroll **verify→approve** collapse is now IN scope as F5. |
| S-4 | §Constraints D2 (line ~353) | "the separation-of-duties work is **F1 and F2 only** … F3, F4 and the SUPER_ADMIN payroll case are pre-existing single-role debt and are filed separately" | **Rewrite:** the work is F1, F2, F3, F4 and F5. **Add D7, D8, D9, D10 verbatim from §1 of the plan.** The "reachable today with a single role" test no longer excludes anything. |
| S-5 | §Background last bullet (line ~487) | "Scope decision F3/F4/SUPER_ADMIN-payroll: all three are reachable today with a single role, which is the test that puts them outside this issue" | **Rewrite:** that test is retired. Single-role reachability is no longer an exclusion; the issue's scope is now "every same-actor separation-of-duties hole", and only the `OVERRIDE_FINALIZED` capability-table case remains out. |

**Additions:**

| # | SPEC location | Add |
|---|---|---|
| S-6 | §Summary (after line ~22) | Two sentences: whoever signs off a supporting document may not decide that request (except a system administrator, who may — and is audited for it); and whoever submits a job posting may not approve it, with departmental approver mappings now binding. |
| S-7 | §What The User Wants → "Separation of duties at decision time" (after line ~112) | Four bullets: (a) whoever marked a supporting document verified cannot decide that request, at any stage, on any attempt; (b) a system administrator is the deliberate exception and the audit trail records when that exception was used; (c) whoever submitted a job posting cannot decide it, and a department with a designated approver is decidable only by that approver; (d) whoever verified a payroll run cannot approve it. |
| S-8 | §Acceptance Criteria (after AC-18) | **AC-19..AC-27 verbatim from §8a of this plan.** |
| S-9 | §Flow / State Diagram | A fourth block **D. Job posting approval**, showing submit → (mapped department? designated approver only : any HR admin) → refuse-if-submitter → OPEN / back-to-DRAFT, and naming the undecidable state plus the remap escape hatch. |
| S-10 | §Non-Functional / Risk | **R6** — binding the posting mapping removes approval reach from `MANAGE_HR` holders in mapped departments (plan R-J). **R7** — the F3 carve-out is a privileged path controlled by audit, not by a bar (plan R-L). |

**Pre-existing SPEC inaccuracies worth fixing in the same pass (not caused by this widening):**

| # | SPEC location | Issue |
|---|---|---|
| S-11 | AC-2, AC-4 (lines ~214, ~229) | Name the new test file `tests/unit/api-v1-user-role.test.ts` (singular). The plan creates **`api-v1-user-roles.test.ts`** (plural), matching the renamed endpoint. Align the SPEC to the plural. |
| S-12 | AC-1, AC-4..AC-8 scenario names | All read `user-admin-self-guard.test.ts › setUserRole › …`. Commit 1 renames the describe block to **`setUserRoles`**. Align the SPEC's scenario names. |

---

## Validate Contract

(placeholder — vc-validate-agent writes this section before EXECUTE)
