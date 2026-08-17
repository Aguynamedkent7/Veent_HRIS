---
name: plan:clearance-signoff-297
description: "#297 only — whoever cleared a clearance item may not finalize that separation; nobody finalizes their own; an already-cleared item may not be touched by a second person"
date: 17-08-26
feature: general-plans
complexity: SIMPLE
spec: process/general-plans/active/separation-of-duties-298-297_SPEC_17-08-26.md
---

# #297 — Clearance sign-off separation of duties

Date: 17-08-26
Status: DRAFT — awaiting VALIDATE
Complexity: SIMPLE

## Overview

**TL;DR** — Add three refusals to the separation service: (D4) you cannot finalize your own
separation, (D3) you cannot finalize a separation whose clearance items you cleared, and (D8) you
cannot touch a clearance item that a different person already cleared. All three live in
`src/lib/server/services/separation.ts`. One shared exported helper produces the refusal message so
the server guard and the greyed-out Finalize button can never disagree. Tests come first: the area
has **zero** tests today, so a characterization baseline is written and proven green before any
guard lands.

**Scope fence.** This plan touches ONLY:

- `src/lib/server/services/separation.ts`
- `src/routes/(app)/separations/[id]/+page.server.ts`
- `src/routes/(app)/separations/[id]/+page.svelte`
- `tests/unit/separation-*.test.ts` (3 new files)

Payroll, `prisma/schema.prisma`, and the audit-log pages are owned by the parallel #298 agent. This
plan adds **no schema change at all** — every column it reads (`ClearanceItem.status`,
`ClearanceItem.clearedById`, `Employee.userId`) already exists.

---

## Acceptance Criteria (Goals)

| # | Goal | SPEC criterion |
|---|---|---|
| G1 | A person who cleared ≥1 item on a case is refused at finalize, with a reason | AC-3.1 |
| G2 | A person who cleared nothing finalizes normally, and the finalize still does all its work | AC-3.2 |
| G3 | The screen warns before the first tick that clearing will bar finalizing | AC-3.3 |
| G4 | Single-HR tenants are not stranded — the CEO is the named escape route, in the message | AC-3.4 |
| G5 | Cases already open still complete | AC-3.5 |
| G6 | Who may tick an item is otherwise unchanged | AC-3.6 |
| G7 | Nobody finalizes their own separation; another admin can | AC-4.1, AC-4.2 |
| G8 | The self refusal reads like the existing offboard refusal | AC-4.3 |
| G9 | The self bar and the clearer bar are independent and ordered | AC-4.4 |
| G10 | An already-cleared item cannot be re-cleared or un-cleared by a second person | D8 (owner-added; no SPEC AC — see §Risks) |
| G11 | Every guard is mutation-checked and proven live, refusal AND success | AC-5.1, AC-5.3 |
| G12 | A characterization baseline pins current behaviour before the change | AC-5.2 |

## Non-goals (out of scope, one line each)

| Item | Why not here |
|---|---|
| Per-department clearance (#297 Option 3) | Rejected by D3 — the department data does not exist (free text matching no real department; "Immediate Supervisor" is a relationship). |
| A clearance history table | Offered and declined by the owner as too big for now; D8 is the cheaper defence of the same hole. |
| No-undo-after-finalize | SPEC NOT-deciding item 1 — finalize stays permanent; this plan adds no new path to it. |
| Final-pay understatement | SPEC out-of-scope 9 — an arithmetic correctness problem, not a "who may press the button" problem. |
| Nothing stops the SUBJECT clearing their own items | `setClearanceItem` has no self-check. Related to D8 but a **distinct** hole and not in the locked decisions. Record it, do not fix it here. |
| Anything payroll (#298) | Owned by a parallel agent; do not touch `prisma/schema.prisma`, payroll services, or the audit-log pages. |
| Filing any GitHub issue | Outward-facing; needs explicit owner approval (D6 PROPOSED). |

## Touchpoints

| File | Change |
|---|---|
| `src/lib/server/services/separation.ts` | READ+WRITE — new pure predicate `clearedAnyItem`, new async helper `finalizeBarFor`, D8 precondition in `setClearanceItem`, two new guards in `finalizeSeparation` |
| `src/routes/(app)/separations/[id]/+page.server.ts` | WRITE — `load` returns `finalizeBar: string \| null` |
| `src/routes/(app)/separations/[id]/+page.svelte` | WRITE — disable Finalize + show the reason; add the up-front clearing warning |
| `tests/unit/separation-characterization.test.ts` | NEW (step 1, before any guard) |
| `tests/unit/separation-finalize-sod.test.ts` | NEW |
| `tests/unit/separation-clearance-reclear.test.ts` | NEW |
| `src/lib/server/services/employees.ts` | READ ONLY — `offboardEmployee` at :1206-1218 is the wording/placement precedent |
| `src/lib/server/services/approvals.ts` | READ ONLY — `:119` pure-predicate shape, `:636-639` explicit-message-above-generic shape |

## Public Contracts

**New exports from `src/lib/server/services/separation.ts`:**

```
export interface ClearanceActorRef { status: string; clearedById: string | null }
export function clearedAnyItem(items: ClearanceActorRef[], actorId: string): boolean
export async function finalizeBarFor(
  record: { employee: { id: string }; clearanceItems: ClearanceActorRef[] },
  actorId: string
): Promise<string | null>
```

`finalizeBarFor` returns the refusal **message** or `null`. It is the ONE source of truth for both
the server 403 and the cosmetic UI flag — this is why the button and the guard cannot drift apart.

**New behaviour (refusals only, no signature changes):**

| Function | New outcome |
|---|---|
| `finalizeSeparation` | 403 when the actor is the separated employee's user |
| `finalizeSeparation` | 403 when the actor cleared ≥1 item on that case |
| `setClearanceItem` | 403 when the item is already `CLEARED` by a different person |

**New page-data field:** `data.finalizeBar: string | null` on `/separations/[id]`. It is a
sentence already safe to render (no user id, no employee id, no name — see §6.3).

Nothing is removed. No capability, no role, no schema column, no route changes.

## Blast Radius

| Dimension | Value |
|---|---|
| Files changed | 3 source + 3 new test files |
| Packages | 1 (single SvelteKit app) |
| Schema | **none** |
| New auth mechanism | **none** — #282 left exactly two, and this adds no third: `requireAnyCapability` still does the capability work; the new bars are object-level actor comparisons, which is established shape 1 (same-actor comparison, #283) |
| Risk class | permission / trust-boundary logic, plus an irreversible money-adjacent write downstream of it |
| Callers affected | ONE: `src/routes/(app)/separations/[id]/+page.server.ts:57`. No v1 API twin exists today. |
| Data at risk | none written by this change; the risk is a WRONGLY-BLOCKED finalize, not a wrongly-allowed one |

**Why service, not route.** The usual argument ("covers the form action and the API twin") is
genuinely **weaker here — there is no twin yet**. Say so honestly. Service still wins on two
grounds: it is the house convention (`offboardEmployee`, `voidRun`, and the #224 epic all put the
guard in the service), and a twin under `src/routes/api/v1/` is the kind of thing that gets added
later by somebody who will not re-read this plan.

## Implementation

### 6.1 `separation.ts` — the pure predicate (insert after `getSeparation`, before `setClearanceItem`, ~line 117)

```
export interface ClearanceActorRef { status: string; clearedById: string | null }

// #297/D3: whoever ticked any box on this case may not close it out. A PURE function on purpose —
// approvals.ts:119 (decidedActorIds) is the same shape, and it makes the rule testable with zero
// DB mocks. This repo's documented failure mode is exactly the vacuous mock (all-tests.md, five
// recorded cases), so the ~10 extra lines buy a test that cannot lie.
// Un-cleared items carry a null clearedById, so a re-opened item stops barring its clearer.
export function clearedAnyItem(items: ClearanceActorRef[], actorId: string): boolean {
	return items.some((i) => i.status === 'CLEARED' && i.clearedById === actorId)
}
```

### 6.2 `separation.ts` — the shared bar helper (insert immediately after `clearedAnyItem`)

```
export async function finalizeBarFor(
	record: { employee: { id: string }; clearanceItems: ClearanceActorRef[] },
	actorId: string
): Promise<string | null> {
	// SCOPED query, not a widened getSeparation select: userId is an identity column and
	// getSeparation's result goes straight to the client. This repo has shipped a select that
	// leaked a field it did not need twice (#111, #290). One extra indexed lookup is the cheaper bug.
	const employee = await db.employee.findUnique({
		where: { id: record.employee.id },
		select: { userId: true }
	})
	// #297/D4: mirrors offboardEmployee (employees.ts:1216) — finalize does the same destructive
	// thing (OFFBOARDED + isActive=false) plus writes off the actor's own loans.
	if (employee?.userId === actorId) {
		return 'You cannot finalize your own separation — ask another admin to do it.'
	}
	// #297/D3.
	if (clearedAnyItem(record.clearanceItems, actorId)) {
		return 'You cannot finalize a separation whose clearance items you cleared — ask another HR administrator, or your CEO, to finalize it.'
	}
	return null
}
```

**Message rules, both load-bearing:**

- **No name is resolved.** `ClearanceItem.clearedById` and `SeparationRecord.finalizedById` are
  bare `String?` columns with **no FK to `User`**, so a name needs a second lookup. It is not worth
  it: the barred actor **IS** the clearer, so a self-referential message is fully actionable and
  leaks nothing.
- **The CEO is named explicitly.** JoJo Potato and Sweetleaf each have exactly one active
  `MANAGE_HR` holder and ship with **no carve-out and no exemption**. The CEO is cross-org and
  reaches `/separations` in both (verified live). Naming them in the message is the entire
  small-tenant mitigation — do not soften it to "another administrator".

### 6.3 `separation.ts` — `setClearanceItem` D8 precondition (insert after the FINALIZED check, currently `:129`)

```
	// #297/D8: an item already cleared by somebody else is theirs. Without this the D3 bar is
	// trivially defeatable — B un-ticks A's item (which NULLs clearedById), re-ticks it, becomes
	// the clearer, and can wipe their own bar the same way. Chosen over a full clearance history
	// table, which the owner declined as too big for now.
	//
	// Deliberately covers BOTH directions (re-clear AND un-clear), because the UI's only path to
	// re-clearing is un-clear-then-clear: barring only the re-clear would leave the defeat intact.
	if (item.status === 'CLEARED' && item.clearedById && item.clearedById !== ctx.actorId) {
		error(403, 'This clearance item was already cleared by someone else. Only they can change it.')
	}
```

Note this is a NULL-safe check: a legacy `CLEARED` row with a null `clearedById` (none exist today,
but nothing enforces it) stays editable rather than becoming permanently frozen. That is the safe
failure direction.

### 6.4 `separation.ts` — `finalizeSeparation` guard order (currently `:228-234`)

Final order, and **the order is load-bearing** — a test pins it:

| # | Guard | Status | Why here |
|---|---|---|---|
| 1 | already finalized → 409 | unchanged (`:230`) | a **state** fact about the record, not about the actor; must stay first or a barred actor is told the wrong thing about a case that is already closed |
| 2 | self-finalize → 403 | **NEW** | the more fundamental refusal, and it mirrors `offboardEmployee`, which places its self-guard FIRST right after the fetch |
| 3 | cleared-an-item → 403 | **NEW** | |
| 4 | pending items → 409 | unchanged (was `:232`) | |
| 5 | compute + transaction re-check | unchanged (`:235-271`) | |

**Why BOTH new bars sit ABOVE pending-items.** Pending-items is a *fixable* refusal — its implicit
instruction is "go clear the rest". The SoD bars are **not fixable by this actor at all**. Worse,
under D3 every item they clear **deepens their own bar**. Telling a barred actor to go clear more
items is not merely unhelpful, it is actively wrong advice that walks them further into the wall.
This is the same reasoning as `approvals.ts:636-639`, where the specific message is kept above the
generic check precisely so the generic one cannot swallow it.

Edit at `:229-233`:

```
	const record = await getSeparation(id, organizationId)
	if (record.status === 'FINALIZED') error(409, 'Separation is already finalized')

	const bar = await finalizeBarFor(record, ctx.actorId)
	if (bar) error(403, bar)

	const pending = record.clearanceItems.filter((i) => i.status !== 'CLEARED').length
	if (pending > 0) error(409, `Cannot finalize — ${pending} clearance item(s) still pending`)
```

`finalizeSeparation` needs **no extra clearance query** — `getSeparation` at `:229` already loads
every clearance item.

### 6.5 `+page.server.ts` — surface the bar (cosmetic)

In `load`, after the `finalPay` computation:

```
	// Cosmetic affordance only — finalizeSeparation is the enforcement (house rule: a UI check is
	// never enforcement, auth/all-auth.md). Same helper, so the button and the guard cannot drift.
	const finalizeBar =
		separation.status === 'FINALIZED'
			? null
			: await finalizeBarFor(separation, user.id)

	return { separation, finalPay, finalizeBar }
```

Add `finalizeBarFor` to the existing import from `$lib/server/services/separation`. No change to
either action — the `isHttpError` branch already turns the 403 into `form.error`, which the page
already renders at `:48-54`.

### 6.6 `+page.svelte` — disable + warn

1. After `const pendingCount = ...` (`:12`):
   ```
   const finalizeBar = $derived(data.finalizeBar)
   ```
2. In the clearance-checklist header block (inside the `border-b` div, after the `h2` at `:85`),
   add the up-front warning (AC-3.3), shown only while the case is open:
   ```
   {#if !isFinalized}
     <p class="mt-1 text-xs text-amber-600">
       Marking any item cleared here means you will not be able to finalize this case.
       Another HR administrator, or your CEO, will have to finalize it.
     </p>
   {/if}
   ```
   Place it as its own block below the header row, not inside the flex row, so it does not fight
   the `justify-between` counter.
3. In the Finalize card, after the `pendingCount` warning (`:163-168`):
   ```
   {#if finalizeBar}
     <p class="mt-2 text-sm text-amber-600">{finalizeBar}</p>
   {/if}
   ```
4. Change the button `disabled` at `:172` to:
   ```
   disabled={pendingCount > 0 || !!finalizeBar || finalize.busy}
   ```

This mirrors the existing `canVoid` / `canUnlock` / `canReveal` convention: the flag hides the
affordance, the service refuses the request.

## Existing open cases (AC-3.5) — explicit answer

Checklists are frozen once a case opens, and items may already be `CLEARED` with a `clearedById`
recorded by the current schema. Three consequences, all benign:

1. **No migration, no backfill.** Every column the guards read already exists and is already
   populated by today's `setClearanceItem`.
2. **An in-flight case whose items were all cleared by admin A becomes finalizable only by someone
   other than A.** That is the intended new rule applying retroactively, and it is *completable* —
   any other `MANAGE_HR` holder, or the CEO, closes it. Nothing is bricked.
3. **A legacy `CLEARED` row with a null `clearedById` bars nobody and freezes nobody** (§6.3). Safe
   direction on both guards.

Live check `L5` (§Live verification) proves this against a case created before the guard ships.

## Verification Evidence

Runner: **vitest** — `pnpm test`. There is no `test:unit` script.

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `separation-characterization` — finalize happy path writes finalPayAmount + OFFBOARDED + isActive=false; pending → 409; already-finalized → 409 | Fully-Automated | AC-5.2 |
| `clearedAnyItem` predicate: actor cleared → barred | Fully-Automated | AC-3.1 |
| `clearedAnyItem` predicate: only others cleared → allowed | Fully-Automated | AC-3.2 |
| `clearedAnyItem` predicate: nobody cleared → allowed | Fully-Automated | AC-3.2 |
| `clearedAnyItem` predicate: item un-cleared (status PENDING / `clearedById` null) → allowed | Fully-Automated | AC-3.2 |
| `finalize-refuses-clearer` — service 403 + nothing mutated | Hybrid (unit + L2) | AC-3.1 |
| `finalize-allows-clean-actor` — **negative control**: resolves AND `finalPayAmount`, `OFFBOARDED`, `isActive:false` writes asserted | Hybrid (unit + L3) | AC-3.2 |
| `finalize-refuses-self` — actor is the separated employee's user → 403 | Hybrid (unit + L4) | AC-4.1 |
| `finalize-allows-other-for-self-case` | Hybrid (unit + L4) | AC-4.2 |
| `finalize-guards-independent` — actor is BOTH subject and clearer → message is the SELF one, not the clearance one (pins order) | Fully-Automated | AC-4.4 |
| `finalize-bar-above-pending` — barred actor on a case with pending items gets the 403 bar, not the pending 409 (pins order) | Fully-Automated | AC-4.4 |
| `self-guard-consistent-with-offboard` — the self message matches `offboardEmployee`'s wording style ("ask another admin to do it") | Fully-Automated | AC-4.3 |
| `reclear-refused-for-other-actor` — already-CLEARED item, different actor, `cleared=true` → 403, no update | Fully-Automated | D8 |
| `unclear-refused-for-other-actor` — same item, `cleared=false` → 403, no update | Fully-Automated | D8 |
| `reclear-allowed-for-original-clearer` — same actor un-ticks their own item → succeeds | Fully-Automated | AC-3.6 |
| `clear-pending-item-unchanged` — a PENDING item is still clearable by anyone with MANAGE_HR | Fully-Automated | AC-3.6 |
| `existing-cases-unaffected` — a pre-existing case with a null `clearedById` on a CLEARED item stays editable and finalizable | Hybrid (unit + L5) | AC-3.5 |
| L1–L6 live browser walkthrough (§Live verification) | Agent-Probe | AC-3.4, AC-5.1 |
| Mutation checks M1–M4 (§Mutation checks), results recorded | Fully-Automated | AC-5.3 |

### TDD stubs (red-first, for the fully-automated rows)

```
test("clearedAnyItem: actor cleared an item -> barred", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: actor cleared -> barred")
})
test("finalize-refuses-self", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: actor is the separated employee -> 403")
})
test("finalize-guards-independent", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: subject AND clearer -> SELF message")
})
test("reclear-refused-for-other-actor", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: already-cleared item, different actor -> 403")
})
```

### Test file layout and mock shape

Copy the mock harness from `tests/unit/offboard-self-guard.test.ts` — same `vi.hoisted` +
`vi.mock('$lib/server/db')` + `vi.mock('$lib/server/audit')` shape.

`separation.ts` also imports `./offboarding`, `./payroll/compensation` and
`$lib/server/notifications`. For the finalize tests, mock `$lib/server/notifications` (unused on this
path but imported at module load) and let `currentCompensation` run for real; `computeFinalPay`
needs `db.employee.findUniqueOrThrow`, `db.employeeCompensation.findMany`, `db.leaveBalance.findMany`,
`db.loan.findMany`, `db.cashAdvance.findMany` mocked. Keep the fixtures minimal — the arithmetic is
NOT under test here (out of scope 9), only that the writes happen.

`db` methods to stub: `separationRecord.findFirst` (via `getSeparation`), `separationRecord.updateMany`,
`employee.findUnique`, `employee.findUniqueOrThrow`, `employee.update`, `clearanceItem.findFirst`,
`clearanceItem.update`, `clearanceItem.count`, `loan.updateMany`, `cashAdvance.updateMany`,
`user.updateMany`, `$transaction` (implement as `async (fn) => fn(dbMock)`).

## Live verification (Agent-Probe)

**Preconditions.** The **user** starts the dev server — never the agent. `separation_records` is
**EMPTY in dev**, so a case must be opened by hand first.

Discover the actors:

```
docker exec veent-db-5434 psql -U veent -d veent_hris -p 5434 -tAc \
  "select email, \"organizationId\", roles, \"isActive\" from users where roles && ARRAY['HR_ADMIN','SUPER_ADMIN','CEO','MANAGER']::\"Role\"[] order by \"organizationId\";"
```

Login harness (dev only):

```
curl -s -c /tmp/cj.txt -X POST http://localhost:5173/api/v1/_dev/login-as \
  -H 'content-type: application/json' -d '{"email":"<EMAIL>"}'
```

| # | Step | Expected |
|---|---|---|
| L0 | As admin **A** (Veent, MANAGE_HR): `/separations` → create a case for an employee who is NOT A. Plant a marker in the `reason` field, e.g. `SOD297-CASE-1`. | Case opens; clearance items seeded from the template |
| L0b | `select id,status from separation_records where reason='SOD297-CASE-1';` | one OPEN row — this is the id used below |
| L1 | Open `/separations/<id>` as A **before** ticking anything | The amber warning "Marking any item cleared here means you will not be able to finalize this case" is visible. **Screenshot it.** Assertions do not see layout. |
| L2 | As A, tick **every** item, then press Finalize | Button is disabled and the clearer message is shown. Force the POST with curl to prove the SERVER refuses too → 403 with the clearance message. `select status,\"finalizedById\" from separation_records where id='<id>';` → still not FINALIZED |
| L2b | As admin **B**, try to un-tick one of A's items | 403 "already cleared by someone else"; `select \"clearedById\" from clearance_items where id='<item>';` → unchanged (D8) |
| L3 | As admin **B** (uninvolved, MANAGE_HR), press Finalize | Succeeds. `select status,\"finalPayAmount\",\"finalizedById\" from separation_records where id='<id>';` → FINALIZED, amount non-null, finalizedById = B. `select \"employmentStatus\" from employees where id='<emp>';` → OFFBOARDED. `select \"isActive\" from users where id=...;` → false. **Assert the DB row, not the screen.** |
| L4 | Open a case for admin **A's own** employee record (marker `SOD297-SELF`), have **B** tick all items, then A presses Finalize | 403 with the self message. Then B finalizes → succeeds |
| L5 | **Existing-case control.** Before applying the guards, open case `SOD297-LEGACY` and tick items as A. Apply the guards, restart, reload the page | Page still loads, checklist intact, B can still finalize. Nothing about the frozen checklist broke |
| L6 | **CEO escape route.** Login as the CEO, `POST /api/v1/session/switch-org` into `org_jojo`, then `org_sweetleaf`. Open a case in each, tick as the single local HR holder, finalize as the CEO | The CEO reaches `/separations`, sees the create affordance, and finalizes. This is the whole small-tenant mitigation — if it fails, STOP and report; the no-carve-out decision rests on it |

Run L1–L4 **before AND after** the change, with the same script, keeping the negative controls on
both sides (`verify-live-before-and-after.md`). Before the change, L2 and L4 must SUCCEED — that is
what proves the harness can actually observe the difference.

## Mutation checks (AC-5.3 — run them, record the results)

| # | Break this on purpose | This test MUST go red |
|---|---|---|
| M1 | In `clearedAnyItem`, drop the `i.clearedById === actorId` comparison (return `items.some(i => i.status === 'CLEARED')`) | `finalize-allows-clean-actor` (a clean actor is now wrongly barred) |
| M2 | In `clearedAnyItem`, invert to `!==` | `finalize-refuses-clearer` |
| M3 | In `finalizeBarFor`, move the self check BELOW the clearer check | `finalize-guards-independent` (message becomes the clearance one) |
| M4 | In `finalizeSeparation`, move the `bar` block BELOW the pending-items check | `finalize-bar-above-pending` |
| M5 | In `setClearanceItem`, drop the `item.clearedById !== ctx.actorId` clause | `reclear-allowed-for-original-clearer` |
| M6 | In `setClearanceItem`, gate the D8 check on `cleared === true` only | `unclear-refused-for-other-actor` |

A mutation check written in a plan is a hypothesis. Only running it makes it evidence — paste the
red output into the execution report.

## Risks

| Risk | Mitigation |
|---|---|
| D8 has no SPEC acceptance criterion (owner-added after SPEC lock) | Recorded here as G10 with its own gates. VALIDATE should confirm the owner is content for D8 to ship without a SPEC amendment. |
| D8's both-directions reading (bar un-clear too, not just re-clear) is an interpretation | Justified in §6.3: the UI's only re-clear path is un-clear-then-clear, so a re-clear-only bar leaves the defeat fully intact. Flagged, not silently assumed. |
| Wrongly-blocked finalize at a small tenant | The CEO route is named in the message AND proven by L6. No carve-out ships. |
| Unit tests mock the DB and cannot prove a permission hole | Every guard has a live gate (L2, L2b, L3, L4) with a psql assertion, plus a before-and-after run. |
| The e2e suite is flaky (#287) | Do not add a Playwright spec. Use the ad-hoc driven-browser + `_dev/login-as` harness, which is this repo's strongest verification artifact. |
| Stale generated Prisma client causing phantom `pnpm check` errors | Run `pnpm prisma generate` before believing a red `pnpm check`. |

## Implementation Checklist

1. `pnpm prisma generate` — clear any stale client before touching anything.
2. Write `tests/unit/separation-characterization.test.ts` pinning CURRENT behaviour: finalize happy path (asserting `separationRecord.updateMany` got `finalPayAmount`/`status: 'FINALIZED'`, `employee.update` got `OFFBOARDED`, `user.updateMany` got `isActive: false`, `loan.updateMany` and `cashAdvance.updateMany` got `status: 'PAID'`), pending-items → 409, already-finalized → 409, `setClearanceItem` clears a PENDING item.
3. Run `pnpm test tests/unit/separation-characterization.test.ts` → must be **GREEN against unmodified code**. This is the proof the harness is not vacuous. Do not proceed until it is.
4. Add `ClearanceActorRef` + `clearedAnyItem` to `src/lib/server/services/separation.ts` after `getSeparation` (~line 117), per §6.1.
5. Add `finalizeBarFor` immediately after it, per §6.2.
6. Insert the D8 precondition in `setClearanceItem` after the FINALIZED check at `:129`, per §6.3.
7. Replace `finalizeSeparation`'s `:229-233` with the ordered guard block in §6.4.
8. Write `tests/unit/separation-finalize-sod.test.ts`: the four `clearedAnyItem` predicate cases (zero mocks), `finalize-refuses-clearer`, `finalize-allows-clean-actor` (negative control — assert the writes), `finalize-refuses-self`, `finalize-allows-other-for-self-case`, `finalize-guards-independent`, `finalize-bar-above-pending`, `self-guard-consistent-with-offboard`, `existing-cases-unaffected`.
9. Write `tests/unit/separation-clearance-reclear.test.ts`: `reclear-refused-for-other-actor`, `unclear-refused-for-other-actor`, `reclear-allowed-for-original-clearer`, `clear-pending-item-unchanged`.
10. `pnpm test` → full suite green (~1446 tests, ~15s). The characterization file from step 2 must STILL be green — it uses an uninvolved actor.
11. Add `finalizeBarFor` to the import and return `finalizeBar` from `load` in `src/routes/(app)/separations/[id]/+page.server.ts`, per §6.5.
12. Edit `src/routes/(app)/separations/[id]/+page.svelte` per §6.6 (four edits: `$derived`, checklist warning, bar message, `disabled`).
13. `pnpm check` && `pnpm lint` && `pnpm format:check`.
14. Run mutation checks M1–M6 (§Mutation checks) one at a time, recording each red result, then revert each.
15. Ask the user to start the dev server. Run live steps L0–L6 (§Live verification), before-and-after, capturing screenshots for L1 and psql output for L2, L2b, L3, L4.
16. Record results in the execution report. **Commit nothing** — this plan ends at PLAN; committing is a separate, separately-authorised step.

## Test Infra Improvement Notes

- The separation area has **zero** tests today (SPEC NOT-deciding item 4). This plan adds three
  files covering the two SoD guards and a thin characterization baseline; `computeFinalPay`
  arithmetic, `createSeparation`, `listSeparations`, `generateSeparationReport` and all three
  routes remain uncovered. Worth a standalone coverage task.
- No shared separation test fixture exists. Each of the three new files builds its own `db` mock.
  If a fourth separation test file appears, extract a `tests/fixtures/separation.ts` builder first.
- `finalizeSeparation`'s `$transaction` takes a callback, so the mock must be
  `async (fn) => fn(dbMock)`, unlike `offboardEmployee`'s array form. Record this in the fixture if
  one is extracted.

## Resume and Execution Handoff

1. **Selected plan file:** `process/general-plans/active/clearance-signoff-297_PLAN_17-08-26.md`
2. **Last completed step:** PLAN written. No code touched, nothing committed.
3. **Validate-contract status:** pending — VALIDATE has not run.
4. **Context loaded:** `process/context/all-context.md`, `process/context/auth/all-auth.md`,
   `process/context/tests/all-tests.md`,
   `process/general-plans/active/separation-of-duties-298-297_SPEC_17-08-26.md`,
   `src/lib/server/services/separation.ts`, both `/separations/[id]` route files,
   `src/lib/server/services/employees.ts:1206-1240`, `src/lib/server/services/approvals.ts:105-135,600-660`,
   `tests/unit/offboard-self-guard.test.ts`, `prisma/schema.prisma:380-420,959-997`.
5. **Next step for a fresh agent:** run VALIDATE against this plan, then EXECUTE from §Implementation Checklist step 1.
   Branch is `feat/separation-of-duties-298-297`. A parallel agent owns #298 — do NOT touch
   `prisma/schema.prisma`, payroll services, or the audit-log pages.

## Phase Completion Rules

This is a SIMPLE single-phase plan, so the phase is the whole plan.

- `CODE DONE` = checklist steps 1-13 complete and `pnpm test`, `pnpm check`, `pnpm lint` green.
- `TESTED` = mutation checks M1-M6 (§Mutation checks) all recorded RED-on-break, reverted.
- `✅ VERIFIED` = live steps L0-L6 run before AND after, screenshots and psql output captured,
  AND the user has confirmed working — user-confirmed, not agent-asserted. Never mark VERIFIED on a green unit suite
  alone — the unit suite mocks the DB and cannot prove a permission hole.
- Nothing is committed in this session. Committing is a separately-authorised step.

**Next step:** say `ENTER VALIDATE MODE` to validate this plan. EXECUTE is next session.

## Validate Contract

(placeholder — vc-validate-agent writes this section before EXECUTE)
