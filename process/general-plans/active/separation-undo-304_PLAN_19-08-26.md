---
name: plan:separation-undo-304
description: "PLAN for #304 — undo a finalized separation. Payroll-void shape applied to separations, plus a pre-finalize state snapshot so future undos are honest. Carries one owner-confirmation gate (§0)."
date: 19-08-26
issue: 304
branch: spec/separation-undo-304
spec: process/general-plans/active/separation-undo-304_SPEC_19-08-26.md
complexity: COMPLEX
status: PLANNED — not validated, not built
---

# PLAN — #304 Undo a finalized separation

**Date**: 19-08-26
**Status**: PLANNED — awaiting owner confirmation (first section) and VALIDATE. Nothing built.
**Complexity**: COMPLEX
**Issue**: #304 · **SPEC:** `process/general-plans/active/separation-undo-304_SPEC_19-08-26.md`
**Context loaded**: `process/context/all-context.md` routing table plus the SPEC's cited source files; testing context per `process/context/tests/all-tests.md` (its recorded vacuous-mock failure mode drives every projection assertion below). Post-phase testing runs the four gates in the DONE definition.


**TL;DR.** Six commits. Finalize starts writing a `preFinalizeState` JSON snapshot (one new
nullable column, additive, `db push`-safe); undo reads it back inside one transaction with a
compare-and-set claim, service-level `OVERRIDE_FINALIZED`, and an audit entry carrying `oldValue`
written inside the tx. Records finalized before the snapshot existed restore status/offboard/login
and show a "partially restored" banner with the aggregate write-off. **One decision needs owner
sign-off before EXECUTE — see the Owner Confirmation section below.**

---

## OWNER CONFIRMATION REQUIRED BEFORE EXECUTE (SPEC §6.2)

### The call: reject the payment-ledger option; snapshot per-row state on `SeparationRecord`.

SPEC §6.2 named the payment ledger "the strongest candidate" because reusing `LoanPayment` /
`CashAdvancePayment` "would let `reverseAmortization` be reused nearly as-is."

**That premise is false, and I verified it.** `reverseAmortization`
(`src/lib/server/services/payroll/amortization.ts:22-94`) takes `(tx, runId)` and drives its whole
loop from `tx.payrollEntry.findMany({ where: { payrollRunId: runId } })` then
`entry.deductions` (`:27-31`). It finds payment rows by `{ loanId: d.refId, payrollEntryId: entry.id }`
(`:43-46`). A separation write-off has **no payroll run, no payroll entry and no deduction line**,
so there is nothing for that loop to iterate. Reuse would mean rewriting the function's entire
driver — that is a new function wearing an old name, not reuse. **This is a SPEC mismatch and I am
reporting it rather than adapting silently.**

Two further findings against the ledger, both verified:

| Finding | Evidence |
|---|---|
| The unique key is **not** the blocker the SPEC feared | `payrollEntryId String?` is nullable and the schema comment says so outright: *"NULL payrollEntryId stays distinct in Postgres, so manual off-payroll payments are unaffected"* (`prisma/schema.prisma:1863-1875`, `:1900-1912`). A null-keyed write-off row inserts fine. |
| But then we cannot tell our rows apart | With `payrollEntryId: null` and no other tag, a separation write-off row is indistinguishable from a genuine manual off-payroll payment. Undo's `deleteMany` would delete real payments. Fixing that needs a **new `separationId` column on both ledger tables** — so the ledger option costs *more* schema than the alternative, not less. |
| A write-off is not a payment | `loan_payments` is the record of money that actually moved (`amortization.ts:38-42` exists precisely to stop the code trusting anything else). Writing ₱10,000 of forgiven debt into it as a "payment" corrupts a ledger the payroll void path trusts. `scripts/prod-delete.ts:225` already counts these rows in its summary. |

**Decided instead:** one new nullable column, `SeparationRecord.preFinalizeState Json?`, written
inside finalize's existing transaction, holding every row finalize is about to overwrite.

| | Ledger option (a) | Snapshot option — CHOSEN |
|---|---|---|
| Schema change | 2 new columns + 2 indexes on payroll tables | 1 nullable column on `SeparationRecord` |
| Reuses `reverseAmortization` | **No** (driver is run/entry-keyed) | No — and does not claim to |
| Blast radius | payroll ledger semantics, `prod-delete.ts`, payroll void tests | separations only |
| Pre-fix record detector (D-4) | needs a separate query | falls out free: `preFinalizeState === null` |
| Captures employee status + `endDate` + `User.isActive` | **No** — ledger holds money only | Yes, all of it |

That last row is decisive on its own. Finalize also destroys `employee.employmentStatus` (it may
have been `ACTIVE` **or** `ON_LEAVE`), `employee.endDate`, and `user.isActive`
(`separation.ts:348-355`). The ledger cannot hold any of it, so option (a) would have needed the
snapshot **as well**.

**What we lose by not writing ledger rows:** a written-off loan still shows `balance: 0, status:
PAID` with no payment history row explaining it. That is a pre-existing reporting hole, it is
**out of scope** here (NON-GOALS, NG-6), and it is worth a separate issue.

**Owner: confirm the snapshot over the ledger before EXECUTE starts.** If you prefer the ledger
anyway, C1 and C2 below are rewritten and the estimate roughly doubles.

---

## Overview

A separation undo shaped exactly like payroll void (`payroll/runs.ts:95-152`):
service-level capability, precondition refusal, one `$transaction` opening with a compare-and-set
claim, the reversal, the audit entry inside. Plus the capture step that makes the money half honest.

Locked decisions carried in unchanged: D-1 (undo → `CLEARED`), D-2 (`OVERRIDE_FINALIZED` in the
service), D-3 (self-undo allowed, marked), D-4 (pre-fix records partially restored), D-5
(`clearedById` kept on re-opened items).

### Answers to the remaining SPEC §6 calls

| SPEC §6 | Call | Answer |
|---|---|---|
| 6.3 | Does `SeparationStatus` gain a value? | **No.** Undo returns the record to `CLEARED`. Verified nothing else keys on a fourth value: the enum has three members (`schema.prisma:954-958`) and the only status reads are `=== 'FINALIZED'` / `{ not: 'FINALIZED' }` (`separation.ts:298`, `:326`, `:174`, `:41`; `[id]/+page.server.ts:21,28`). Adding a value would also be a Prisma enum change — additive is safe, but unnecessary is cheaper. |
| 6.4 | Does `AuditAction` gain a value? | **Yes — `SEPARATION_UNDO`.** Same argument #298 made for `PAYROLL_VOID` (`schema.prisma:200-206`): a generic `UPDATE` is unfindable in the audit action filter. **Adding** an enum value is safe under `db push` — only a *rename* forces a drop/recreate. No `scripts/migrate-*.ts` is needed. Stated explicitly per the repo rule. |
| 6.5 | `docs/payroll-void-semantics.md` "No un-void" | Gets a two-line companion note (C6) saying separations DO have an undo and why the two stories differ: a payroll void is terminal because a fresh run can be re-created; a separation finalize has no re-do path because it offboards a person. |
| 6.6 | Finalize E2E gap | `tests/e2e/separations.spec.ts` has only list access (`:16`) and an employee refusal (`:25`). C6 adds the first finalize→undo E2E to that same file, as its own header comment instructs ("future separation e2e work belongs in this file rather than a second spec"). |

---

## Touchpoints

| File | Change |
|---|---|
| `prisma/schema.prisma` | `SeparationRecord.preFinalizeState Json?`; `AuditAction.SEPARATION_UNDO` |
| `src/lib/server/services/separation.ts` | snapshot capture in finalize; audit moves inside tx + gains `oldValue`; `clearedAnyItem` widened + comment rewritten; new `undoSeparation`; new `PreFinalizeState` type |
| `src/lib/server/services/separation-undo-markers.ts` **(new)** | `undidOwnFinalize` — mirrors `payroll/audit-markers.ts:10-17` |
| `src/routes/(app)/separations/[id]/+page.server.ts` | new `undo` action; strip `preFinalizeState` from the load payload |
| `src/routes/(app)/separations/[id]/+page.svelte` | undo control + re-open-clearance checkbox + "partially restored" banner |
| `tests/unit/separation-finalize-sod.test.ts` | re-pin the re-opened-item case under the widened helper |
| `tests/unit/separation-finalize-effects.test.ts` | snapshot capture + in-tx audit assertions |
| `tests/unit/separation-undo.test.ts` **(new)** | the undo suite |
| `tests/e2e/separations.spec.ts` | first finalize→undo E2E |
| `docs/payroll-void-semantics.md` | companion note |

**Read but not changed:** `payroll/runs.ts`, `payroll/amortization.ts`, `payroll/audit-markers.ts`,
`src/lib/server/audit.ts`, `src/lib/rbac.ts`, `scripts/prod-delete.ts`.

---

## Public Contracts

| Contract | Before | After |
|---|---|---|
| `clearedAnyItem(items, actorId)` (exported, `separation.ts:128`) | bars on `status==='CLEARED' && clearedById===actorId` | bars on `clearedById===actorId` **regardless of status** (D-5) |
| `finalizeSeparation` | audit outside tx, `newValue` only | audit inside tx, with `oldValue`; writes `preFinalizeState` |
| `undoSeparation(id, organizationId, reopenClearance, ctx)` | — | new export; throws 404 / 403 / 400 / 409 |
| Form action `?/undo` on `/separations/[id]` | — | new. **The only door** — there is no `/api/v1/separations` endpoint (verified: `find src/routes/api/v1 -path '*separation*'` returns nothing), so no twin to build. |
| `AuditAction` enum | 10 values | 11 (`SEPARATION_UNDO`) — additive |
| Page `data.separation` | includes all scalars | `preFinalizeState` stripped server-side |

**Not changed:** `computeFinalPay` output, `FinalPayResult`, the employees v1 API refusal
(`api/v1/employees/[id]/+server.ts:138-143`), `setClearanceItem`'s null-on-unclear behaviour.

---

## Blast Radius

10 files (7 changed, 3 new), one package (the app). Risk class: **auth/permission** (a new
SUPER_ADMIN break-glass door), **schema migration** (additive), **destructive-write reversal**
(money and login state). High-risk on three counts — every guard below carries a hybrid or E2E gate,
never a unit test alone.

---

## Implementation Checklist (commit-by-commit)

Each commit is green on all four gates on its own.

### C1 — schema: the snapshot column and the audit action

**Files:** `prisma/schema.prisma`

- On `SeparationRecord`, after `finalizedById`, add `preFinalizeState Json?` with a comment: *"Everything finalize is about to overwrite, captured inside finalize's transaction so #304's undo can put it back. NULL = finalized before #304 shipped ⇒ the money cannot be restored (D-4, 'partially restored')."*
- Add `SEPARATION_UNDO` to `AuditAction` (`schema.prisma:194-207`) with the #304 rationale comment.

**Why:** both are additive. Adding an enum value is safe under `prisma db push`; only a **rename**
drops and recreates the type. No `scripts/migrate-*.ts` is required — stated here explicitly because
the repo rule demands the distinction be named.

**Apply:** `pnpm db:push` (which is `dotenv -e .env.dev -- prisma db push`), then restart the dev
server — this repo requires a restart after a push.

**Tests:** none of its own. Gate is `pnpm check` compiling against the regenerated client.

---

### C2 — finalize captures state, and its audit moves inside the transaction

**Files:** `src/lib/server/services/separation.ts`

1. Export the snapshot type:
   `export interface PreFinalizeState { loans: {id,balance,status}[]; cashAdvances: {id,balance,status}[]; employee: {employmentStatus,endDate}; userIds: string[]; userWasActive: boolean }`
   Balances stored as **strings** (`Decimal.toString()`), not `Number` — JSON has no decimal type
   and the repo's money rule forbids a `Number` round-trip on balances (`amortization.ts:33-35`).
2. Inside the existing `$transaction`, **before** the two blanket `updateMany`s
   (`separation.ts:339-346`), read the rows first:
   `tx.loan.findMany({ where: { employeeId, status: 'ACTIVE' }, select: { id, balance, status } })`
   and the `cashAdvance` mirror; plus the employee's current `employmentStatus`/`endDate` and
   `tx.user.findMany({ where: { employee: { id } }, select: { id, isActive } })`.
3. Add `preFinalizeState` to the compare-and-set `updateMany` at `:325-335`.
4. Move the `writeAuditLog` call (`:358-363`) **inside** the transaction, pass `tx` as the third
   argument (`audit.ts:22-26` already accepts it), and add
   `oldValue: { status: record.status, employmentStatus, endDate, activeLoanCount, activeAdvanceCount }`.

**Why:** SPEC §3c — the state finalize destroys must be recoverable from the trail too, and the
trail must commit or roll back with the money. `writeAuditLog` has always taken both; finalize
simply never passed them.

**Order note:** the reads must sit **after** the compare-and-set status claim at `:335`, so a losing
concurrent finalize never snapshots.

**Tests** (`tests/unit/separation-finalize-effects.test.ts`, extend):
- `finalize snapshots every ACTIVE loan and advance before zeroing them` — assert the
  `separationRecord.updateMany` data contains `preFinalizeState` with both loan ids and their
  **pre-zero** balances.
- `finalize writes its audit inside the transaction, with oldValue` — assert `writeAuditLog` was
  called with the tx client as the 3rd arg and an `oldValue` naming the prior `employmentStatus`.

**Projection safety:** the loan/advance mocks must use a `project()`-style helper that honours the
`select` clause and returns **only** the selected keys. A flat `mockResolvedValue(wholeRow)` would
let a snapshot that captured the wrong fields still pass — this repo's #1 recorded test failure.

**Mutations that prove these bite:**
- M2.1 — move the snapshot reads *below* the `loan.updateMany`. The test must fail with balances of
  `0`. (This is the mistake anyone would actually make: reads read naturally at the top of the
  money block.)
- M2.2 — drop the third `tx` argument from `writeAuditLog`. The in-tx assertion must fail.

---

### C3 — `clearedAnyItem` widens; the false comment dies; #297 is re-pinned

**Files:** `src/lib/server/services/separation.ts`, `tests/unit/separation-finalize-sod.test.ts`

- `clearedAnyItem` (`:128-130`) becomes `items.some((i) => i.clearedById === actorId)`. Keep it a
  pure function with zero db mocks — that is why #297 wrote it that way.
- **Rewrite the comment at `separation.ts:127`.** It currently reads *"Un-cleared items carry a null
  clearedById, so a re-opened item stops barring its clearer."* Under D-5 that is false. Replace
  with: *"#304/D-5: the bar keys on `clearedById` ALONE, not on status. The ordinary un-clear path
  (`setClearanceItem`, :199-201) still NULLs `clearedById`, so it still un-bars — that is
  deliberate and unchanged. The undo's re-open branch KEEPS `clearedById` and only flips `status`,
  so a bulk re-open cannot launder every #297 bar on the case in one privileged call."*
- In `setClearanceItem` (`:199-201`), add one comment marking the divergence explicitly so the two
  paths never look like an accident: *"NULLs clearedById on purpose — the opposite of the undo's
  re-open branch. See clearedAnyItem."* No behaviour change here.

**Why:** SPEC §3b/D-5. This is the laundering guard, and it is the reason the widening is not
optional.

**Tests** (`separation-finalize-sod.test.ts`, re-pin — do **not** delete the existing case):
- `a re-opened item still bars its original clearer` — item `{ status: 'PENDING', clearedById: 'A' }`
  ⇒ `clearedAnyItem(items,'A') === true`. This is the case whose expectation **inverts**; keep the
  old assertion in the file as a commented one-line note saying #304 flipped it and why.
- `an ordinarily un-cleared item (clearedById null) still does NOT bar` ⇒ `false`. This is the
  negative control that stops the widening becoming "everyone is barred forever".
- Existing D3/D4 cases must stay green untouched.

**Mutations that prove these bite:**
- M3.1 — restore the `status === 'CLEARED' &&` clause. The re-opened-item test must fail. (The
  realistic mistake: a future reader "fixes" the helper back to matching its old comment.)
- M3.2 — make `setClearanceItem` keep `clearedById` on un-clear. The negative-control test must
  fail, proving the ordinary path really is still un-barring.

---

### C4 — `undoSeparation`

**Files:** `src/lib/server/services/separation.ts`, `src/lib/server/services/separation-undo-markers.ts` (new)

Signature: `undoSeparation(id: string, organizationId: string, reopenClearance: boolean, ctx: AuditContext)`.

Shape, step for step, mirroring `voidRun` (`runs.ts:95-152`):

1. `requireAnyCapability(ctx.actorRoles, 'OVERRIDE_FINALIZED')` — **first line, in the service**
   (D-2; matches `runs.ts:97`). This becomes the capability's 11th call site and its first outside
   payroll/attendance.
2. Load the record scoped by `organizationId`; **404** if absent.
3. **Precondition refusal: `if (record.status !== 'FINALIZED') error(400, 'Separation is not finalized')`.**
   (`voidRun:105` is the mirror.)
4. `const partial = record.preFinalizeState === null` — the D-4 detector.
5. One `db.$transaction(async (tx) => {…})` containing, in order:
   - **compare-and-set claim:**
     `tx.separationRecord.updateMany({ where: { id, status: 'FINALIZED' }, data: { status: 'CLEARED', finalPayAmount: null, finalizedAt: null, finalizedById: null, preFinalizeState: Prisma.DbNull } })`
     → `if (claimed.count === 0) error(400, 'Separation is not finalized')`.
     **`finalPayBreakdown` is deliberately KEPT** — on a pre-fix record it is the only surviving
     evidence of the aggregate write-off, which D-4 requires the UI to surface.
   - **money, only when `!partial`:** for each snapshot loan, the conditional restore idiom from
     `amortization.ts:52-62` —
     `tx.loan.updateMany({ where: { id, balance: 0, status: 'PAID' }, data: { balance: <snapshot>, status: <snapshot status> } })`, and
     `if (res.count === 0) error(409, 'A loan balance changed since finalizing — nothing was reversed, retry')`.
     Same for advances. Use `D()` from `./payroll/money` to parse the stored strings; never `Number`.
   - **employee:** restore `employmentStatus` and `endDate` from the snapshot when `!partial`; when
     `partial`, restore `employmentStatus: 'ACTIVE'` and `endDate: null` and say so in the audit
     entry (`restoredStatusAssumed: true`). `ACTIVE` is the honest default: `ON_LEAVE` is
     recoverable by a human, an `OFFBOARDED` ghost is not.
   - **login:** `tx.user.updateMany({ where: { employee: { id } }, data: { isActive: true } })` —
     when `!partial`, only if `userWasActive`. **This is the first and only `isActive: true` writer
     in `src/lib/server`** (SPEC §2 verified none exists).
   - **clearance, when `reopenClearance`:**
     `tx.clearanceItem.updateMany({ where: { separationId: id }, data: { status: 'PENDING' } })` —
     **`clearedById` is NOT in the `data` object.** That omission is D-5. Add a comment saying the
     omission is the guard, not an oversight, or the next reader will "complete" the object.
   - **audit last, inside the tx:** `writeAuditLog(ctx, { action: 'SEPARATION_UNDO', entityType: 'SeparationRecord', entityId: id, oldValue: {…}, newValue: {…} }, tx)`.
     `oldValue` carries the full SPEC §3c-2 payload: clearer set, loan/advance balances+statuses
     being restored, `finalizedById`/`finalizedAt`, employee `employmentStatus`, `User.isActive`.
     `newValue` carries `{ status: 'CLEARED', reopenedClearance: reopenClearance, partiallyRestored: partial, ...(undidOwnFinalize(ctx.actorId, record) && { sameActorAsFinalizer: true }) }`.
6. Return `{ partial, writeOff: partial ? <aggregate from finalPayBreakdown> : null }`.

**`separation-undo-markers.ts`** — one exported function, a near-copy of
`payroll/audit-markers.ts:10-17`:
`undidOwnFinalize(actorId, record: { finalizedById: string | null })` returns
`!!actorId && actorId === record.finalizedById`. Carry the null-vs-null warning verbatim: a record
with a null `finalizedById` must never match. **Conditional-spread at the call site** so the key is
absent on an ordinary undo, never present-and-false (D-3).

**Tests** (`tests/unit/separation-undo.test.ts`, new):

| # | Test | Asserts |
|---|---|---|
| U1 | non-SUPER_ADMIN is refused | throws before any db call — assert `db.separationRecord.findFirst` was **never** called |
| U2 | unknown id → 404 | |
| U3 | a `CLEARED` record → 400 | precondition refusal |
| U4 | concurrent undo → 400 | `updateMany` returns `{count:0}` ⇒ throws, and **no** loan write follows |
| U5 | snapshot restore | loan `{id:'l1'}` back to `3000`/`ACTIVE`, `{id:'l2'}` to `7000`/`ACTIVE` — the SPEC §1 two-loan case |
| U6 | a balance moved since finalize → 409 | conditional `updateMany` returns `{count:0}` |
| U7 | login re-enabled | `user.updateMany` called with `isActive: true` |
| U8 | `reopenClearance: true` keeps the clearer | assert the `clearanceItem.updateMany` `data` object has **no** `clearedById` key (`expect('clearedById' in data).toBe(false)`) — not merely that it is not null |
| U9 | `reopenClearance: false` leaves items alone | `clearanceItem.updateMany` never called |
| U10 | self-undo stamps the marker | `newValue.sameActorAsFinalizer === true` |
| U11 | ordinary undo omits the marker | `expect('sameActorAsFinalizer' in newValue).toBe(false)` |
| U12 | pre-fix record (`preFinalizeState: null`) | **no** loan/advance write at all; employee restored to `ACTIVE`; returns `partial: true` with the aggregate |
| U13 | audit is inside the tx | `writeAuditLog` 3rd arg is the tx client |

**Mutations that prove these bite:**
- M4.1 — move `requireAnyCapability` from the service into the route only. U1 must fail. (The exact
  historical mistake this repo names: guards drifting to the route.)
- M4.2 — add `clearedById: null` to the re-open `data`. U8 must fail. (The realistic mistake: a
  reader mirrors `setClearanceItem`, whose un-clear path does exactly that.)
- M4.3 — change the loan restore `where` from `{ id, balance: 0, status: 'PAID' }` to `{ id }`. U6
  must fail. (The realistic mistake: "the conditional where is redundant, we're in a transaction.")
- M4.4 — drop the `partial` branch and let a pre-fix record restore from `null`. U12 must fail.
- M4.5 — change the conditional spread to `sameActorAsFinalizer: undidOwnFinalize(...)`. U11 must
  fail on the present-and-false key.

**Projection safety:** U5/U12 mock `loan.findMany` through a `project()` helper honouring `select`.
U8/U11 assert on **key presence**, never on value — a flat mock cannot fake key absence.

---

### C5 — route action and UI

**Files:** `src/routes/(app)/separations/[id]/+page.server.ts`, `+page.svelte`

- New `undo` action, copying the existing `finalize` action's exact `try`/`isHttpError`/`fail`
  shape (`+page.server.ts:58-77`). Route-level `requireAnyCapability(user.roles, 'MANAGE_HR')` stays
  as the coarse page gate; **`OVERRIDE_FINALIZED` is enforced in the service** — the route does not
  duplicate it. Read `reopenClearance` from the form data as `data.get('reopenClearance') === 'true'`.
  Return `{ undone: true, partial, writeOff }`.
- In `load`, strip the new column before returning:
  `const { preFinalizeState: _drop, ...separation } = await getSeparation(...)`. `getSeparation`
  uses `include`, so every scalar ships to the client otherwise, and this one holds loan ids and
  balances. Two prior leaks (#111, #290) came from exactly this.
- Add `canUndo` to the returned data: `separation.status === 'FINALIZED' && user.roles.includes('SUPER_ADMIN')`
  — cosmetic affordance only, with the house-rule comment naming the service as the enforcement,
  matching the existing `finalizeBar` comment at `:24-25`.
- `+page.svelte`: in the finalized branch (`:196-200`), add an "Undo finalization" button behind
  `canUndo`, a labelled checkbox "Re-open clearance items" (default **off** — SPEC §3b says the
  common case is "the clearance was correct"), and a `confirm`-style second click, since this
  re-enables a login. Accessibility: the checkbox needs a real `<label for>`, and the button an
  `aria-describedby` pointing at the warning text, matching `:188-193`.
- **Partially-restored banner (D-4, first-class):** when `partial`, render a persistent amber panel
  on the record after undo: *"Partially restored. Loan and cash-advance balances totalling ₱X were
  written off when this was finalized and could not be restored automatically — re-enter them
  manually."* X comes from the surviving `finalPayBreakdown` lines (`Outstanding loan balances` +
  `Outstanding cash advances`, both negative — display the absolute sum). Money renders through the
  existing `peso()` helper.
  **Persistence note:** the banner must survive a page reload, so it cannot live only in the action
  return. Derive it in `load`: `finalPayBreakdown !== null && status === 'CLEARED'` — that
  combination only occurs after an undo. Say so in a comment.
- `{@const}` rule: any const inside the banner must be an immediate child of the `{#if}`, never
  inside a `<div>`.

**Tests** (`tests/unit/separation-routes.test.ts`, extend, following its existing pattern):
- `the undo action maps a service 403 to fail(403)`.
- `the undo action forwards reopenClearance=true`.
- `load strips preFinalizeState` — `expect('preFinalizeState' in result.separation).toBe(false)`,
  with `getSeparation` mocked to return a row that **has** the key.

**Mutations:**
- M5.1 — delete the destructuring strip in `load`. The strip test must fail.
- M5.2 — hardcode `reopenClearance: false` in the action. The forwarding test must fail.

---

### C6 — E2E and the docs companion

**Files:** `tests/e2e/separations.spec.ts`, `docs/payroll-void-semantics.md`

- **E2E (new, in the existing spec file per its own header instruction at `:9-11`):** a full
  finalize → undo cycle against the real DB, following the setup/teardown pattern of
  `tests/e2e/payroll-void-run-amortization.spec.ts` (tagged fixtures, `db.*.deleteMany` teardown by
  tag). Steps: seed an employee with two ACTIVE loans (₱3,000 / ₱7,000) + a CLEARED separation →
  log in as SUPER_ADMIN → finalize → assert in DB that both loans are `0`/`PAID`, the employee is
  `OFFBOARDED` and `user.isActive === false` → click Undo → assert **positively** that the loans
  are back at exactly `3000` and `7000` with `status ACTIVE`, the employee is `ACTIVE`,
  `user.isActive === true`, the record is `CLEARED`, and an `AuditLog` row with
  `action: 'SEPARATION_UNDO'` exists carrying a non-null `oldValue`.
- **E2E negative control, same file:** log in as `hr@veent.ph` (HR_ADMIN — `MANAGE_HR` without
  `OVERRIDE_FINALIZED`), POST the undo action directly, assert the record is **still** `FINALIZED`.
  Asserting only "the button is not visible" proves nothing — this repo has that recorded.
- **Docs:** two lines under the "No un-void" statement in `docs/payroll-void-semantics.md` pointing
  at `undoSeparation` and stating the asymmetry, so the two undo stories do not read as
  contradictory (SPEC §6.5).

**Mutation:** M6.1 — delete the `requireAnyCapability` line in `undoSeparation`. The HR_ADMIN
negative-control E2E must fail. This is the one mutation that proves the guard works **in the
deployed app**, not just in a mock — and it is the only proof that matters for a break-glass door.

---

## Acceptance Criteria

| # | Criterion | Proven by |
|---|---|---|
| AC-1 | A SUPER_ADMIN can undo a finalized separation; the record returns to `CLEARED` (D-1). | U3/U4 + E2E round trip |
| AC-2 | An actor without `OVERRIDE_FINALIZED` is refused **by the service**, not only the route (D-2). | U1 + M4.1 + the HR_ADMIN E2E negative control + M6.1 |
| AC-3 | The finalizer may undo their own finalize, and the audit entry carries a `sameActorAsFinalizer` marker that is ABSENT on ordinary undos (D-3). | U10, U11, M4.5 |
| AC-4 | A record finalized before the snapshot existed restores status/offboard/login, writes no loan rows, and shows a "partially restored" panel naming the aggregate write-off (D-4). | U12 + M4.4 + manual step 8 |
| AC-5 | The undo's re-open branch flips `status` to `PENDING` and KEEPS `clearedById`; `clearedAnyItem` bars on `clearedById` regardless of status (D-5). | U8 (key absence) + M4.2 + C3 suite + M3.1 + manual steps 6–7 |
| AC-6 | The ordinary un-clear path still NULLs `clearedById` and still un-bars. | C3 negative control + M3.2 |
| AC-7 | The undo's audit entry is written INSIDE the transaction and carries a populated `oldValue` (SPEC §3c). | U13 + E2E audit-row assertion |
| AC-8 | Finalize captures every row it is about to overwrite, before overwriting it. | C2 tests + M2.1 |
| AC-9 | Restoring a balance that moved since finalize refuses with a 409 rather than overwriting. | U6 + M4.3 |
| AC-10 | `preFinalizeState` never reaches the client. | C5 strip test + M5.1 |

## Phase Completion Rules

This plan is SIMPLE-shaped in delivery (one session, six commits) but COMPLEX in risk class, so the
per-commit bar is stricter than usual:

1. A commit is **CODE DONE** when its own tests pass and all four gates are green.
2. A commit is **VERIFIED** only when every mutation named in that commit's "Mutations that prove
   these bite" list has been applied, observed to fail the named test, and reverted (by `cp` from
   the scratchpad — never `git checkout <file>`).
3. C4 and C6 cannot reach VERIFIED without the hybrid E2E gate actually run against a live
   `veent-db-5434`. A green unit suite is not evidence a guard works.
4. The whole plan cannot reach VERIFIED without the Manual / Live Verification Script completed with
   every positive assertion observed.
5. Honest status only: code written with the E2E unrun is `CODE DONE`, never `VERIFIED`.


## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `pnpm format:check` | Fully-Automated | repo gate; CI runs it first, and it is separate from lint. `process/` is `.prettierignore`d so this plan file is exempt |
| `pnpm lint` | Fully-Automated | the only gate catching an orphaned import; the only gate covering `scripts/**` and `prisma/**` |
| `pnpm check` | Fully-Automated | types across `src/**` + `tests/**` only — see What This Plan CANNOT Prove Locally |
| `pnpm test` (U1–U13, C2, C3, C5 suites) | Fully-Automated | D-1, D-2, D-3, D-4, D-5, §3c-1/2/3/4 |
| U8 key-absence assertion + M4.2 | Fully-Automated | §3b — the re-open branch does not launder the #297 bar |
| C3 negative control + M3.2 | Fully-Automated | D-5 consequence 3 — the ordinary un-clear path still un-bars |
| E2E finalize→undo round trip | Hybrid (needs `veent-db-5434` + `pnpm db:seed:e2e`) | D-1 and D-4 end-to-end; the only proof the money really returns |
| E2E HR_ADMIN refusal + M6.1 | Hybrid (same precondition) | D-2 — the capability is enforced in the deployed app |
| Manual script (below) | Agent-Probe | D-4's "partially restored" UI state, which no assertion can judge for legibility |
| `pnpm db:push` applies cleanly on a populated DB | Hybrid | C1 — additive column and enum value need no migration script |

**Failing stubs** (destined for the validate-contract, not for disk at PLAN time):

```
test("should keep clearedById on a re-opened item during undo", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: reopenClearance:true keeps the clearer")
})
test("should refuse undo for an actor without OVERRIDE_FINALIZED", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: non-SUPER_ADMIN is refused in the service")
})
test("should restore both loan balances from the pre-finalize snapshot", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: snapshot restore of 3000/7000")
})
test("should mark a pre-fix record partially restored and write no loan rows", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: preFinalizeState null ⇒ partial")
})
test("should write the undo audit entry inside the transaction with oldValue", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: in-tx audit with oldValue")
})
```

### DONE definition

All four gates green, in this order:

```bash
pnpm format:check   # CI runs this first
pnpm lint
pnpm check
pnpm test
pnpm test:e2e tests/e2e/separations.spec.ts   # requires ./start.sh + pnpm db:seed:e2e
```

Plus: the §7 manual script completed with every positive assertion observed, and the Owner Confirmation section confirmed by
the owner. No commit is DONE on unit tests alone — every guard in C3, C4 and C5 has a named
mutation above, and the mutation must have been observed to fail before the commit is called done.

---

## Manual / Live Verification Script

Preconditions: `./start.sh` running; `pnpm dev`; logged into the **Veent** tenant. psql is
`docker exec veent-db-5434 psql -U veent -d veent_hris -p 5434 -tAc "<sql>"`.
Dev login: `curl -c /tmp/c.txt -X POST localhost:5173/api/v1/_dev/login-as -H 'content-type: application/json' -d '{"email":"…"}'`
(dev-guarded, returns 404 in a built bundle — `_dev/login-as/+server.ts:14`).

**Plant the marker first.** Pick a live employee and tag their separation so it is findable:

```sql
-- find the target and record the ids
SELECT e.id, e."employmentStatus", u.id, u."isActive"
  FROM employees e JOIN users u ON u."employeeId" = e.id
 WHERE u.email = '<target>@veent.ph';
-- plant two findable loans
INSERT INTO loans (id,"employeeId",amount,balance,installment,status,"startDate","createdAt","updatedAt")
VALUES ('undo304a','<empId>',3000,3000,500,'ACTIVE',now(),now(),now()),
       ('undo304b','<empId>',7000,7000,500,'ACTIVE',now(),now(),now());
```

| # | Step | Control named | Assert POSITIVELY |
|---|---|---|---|
| 1 | Log in as `superadmin@veent.ph`. Create + fully clear a separation for the target. | — | record row `status = 'CLEARED'` in psql |
| 2 | Click **Finalize & offboard** (the red button, `+page.svelte:191-197`) | that button | `SELECT balance,status FROM loans WHERE id IN ('undo304a','undo304b')` returns exactly `0\|PAID` twice; employee `OFFBOARDED`; `users.isActive = false`; `preFinalizeState` is **non-null** and contains both loan ids |
| 3 | Reload the page | — | the finalized panel shows the settled figure; **no Undo button when logged in as `hr@veent.ph`** — then, still as HR, `curl` the undo action directly and confirm the record is **still FINALIZED** (absence of a button proves nothing) |
| 4 | Back as SUPER_ADMIN, click **Undo finalization** with "Re-open clearance items" **unchecked** | that button + that checkbox | loans read exactly `3000\|ACTIVE` and `7000\|ACTIVE`; employee `ACTIVE`; `users.isActive = true`; record `CLEARED`; `SELECT "oldValue" FROM audit_logs WHERE action='SEPARATION_UNDO' ORDER BY "createdAt" DESC LIMIT 1` returns a **non-null** JSON naming both loan ids; clearance items all still `CLEARED` with their original `clearedById` |
| 5 | Log in as the restored employee | the login form | the dashboard loads — the login really was re-enabled |
| 6 | Re-finalize as the **same** SUPER_ADMIN, then undo again with **"Re-open clearance items" checked** | that checkbox | every clearance item is `PENDING` **and** `clearedById` is still the original id (`SELECT status,"clearedById" FROM clearance_items WHERE "separationId"='<id>'`); the newest audit row's `newValue` contains `"sameActorAsFinalizer": true` and `"reopenedClearance": true` |
| 7 | As the original clearer, try to finalize | the Finalize button | the button is **disabled** and the amber `#finalize-bar` text names the clearer bar — the #297 bar survived the re-open (this is the whole of §3b) |
| 8 | **Pre-fix record:** `UPDATE separation_records SET "preFinalizeState" = NULL WHERE id='<id>';` then re-finalize… no — instead finalize, then NULL the column, then undo | the Undo button | the amber **"Partially restored"** panel is visible and names a peso figure equal to the aggregate write-off; loans stay `0\|PAID`; employee is `ACTIVE`; `users.isActive = true` |
| 9 | Cleanup | — | `DELETE FROM loans WHERE id LIKE 'undo304%';` and remove the test separation |

Never `git checkout <file>` to revert any temporary edit made during this script — `cp` to the
scratchpad first.

---

## What This Plan CANNOT Prove Locally

1. **Postgres transaction isolation under real concurrency.** U4 and U6 prove the compare-and-set
   and conditional-restore *code paths* with mocked counts. Two genuinely simultaneous undos are not
   reproducible in vitest, and the E2E is serial. Same residual the payroll void carries; accepted.
2. **`pnpm check` does not cover `prisma/**` or `scripts/**`.** C1 edits `prisma/schema.prisma`;
   only `pnpm lint` and an actual `pnpm db:push` will catch a mistake there. #282 shipped a broken
   site on exactly this assumption.
3. **`pnpm db:push` against a large populated production DB.** Local is a seeded dev DB. Adding a
   nullable column and an enum value is safe in principle; the production timing is unproven.
4. **Whether every pre-#304 finalized record's `finalPayBreakdown` is well-formed.** D-4's banner
   reads it. Old rows are trusted, not verified. Mitigation: the banner must tolerate a missing or
   malformed breakdown by showing "amount unknown" rather than throwing — required, not optional.
5. **That `ACTIVE` is the right restore for a pre-fix record whose employee was `ON_LEAVE`.** It is
   an assumption, recorded in the audit as `restoredStatusAssumed: true` so a human can find it.
6. **Multi-tenant behaviour beyond the Veent tenant.** All manual steps are Veent-scoped.

---

## NON-GOALS

Re-read this list if scope moves. A plan in this repo once shipped with non-goals that forbade its
own security fix.

- **NG-1** A general rehire / reactivate feature. `undoSeparation` is the only `isActive: true`
  writer and it is reachable **only** through undoing a finalize.
- **NG-2** Editing `employmentStatus` through the v1 employees API. `+server.ts:138-143` stays a 400.
- **NG-3** Changing what `computeFinalPay` computes, or the `FinalPayResult` shape.
- **NG-4** Weakening any #297 separation-of-duties bar. **C3 widens `clearedAnyItem`, which
  STRENGTHENS it — that is in scope and is the point.** Nothing here may make an actor able to
  finalize who could not before.
- **NG-5** A clearance history table (the owner declined it at #297/D8).
- **NG-6** Backfilling payment-ledger rows for historical write-offs, or fixing the pre-existing
  hole that a written-off loan has no payment history row. Worth its own issue.
- **NG-7** A `VOIDED` value on `SeparationStatus` (Overview, SPEC 6.3).
- **NG-8** Undoing a separation that was never finalized, or a second undo of the same finalize.
  Both are 400s by design.
- **NG-9** Any change to `reverseAmortization` or the payroll void path. Read-only reference.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `clearedAnyItem` widening bars someone who could finalize before | High | C3's negative control + M3.2; the ordinary un-clear path is untouched and explicitly commented |
| A bulk re-open launders the #297 bars (SPEC §3b) | High | D-5: `clearedById` never in the re-open `data`; U8 asserts key **absence**; manual step 7 proves it live |
| `preFinalizeState` leaks loan ids to the page | Medium | stripped in `load` (C5); asserted by a test with a mock that **has** the key |
| Restoring a balance that moved since finalize | Medium | conditional `updateMany` + 409, copied from `amortization.ts:56-62`; U6 |
| A snapshot read placed after the zeroing writes | Medium | M2.1 is exactly this mutation |
| Break-glass door with no second person (D-3) | Medium | accepted by D-3; detect-don't-block marker + `SEPARATION_UNDO` action makes every use findable in the audit filter |
| Enum change mishandled | Low | **adding** a value is `db push`-safe; only renames need `scripts/migrate-*.ts`. Stated in C1 |

---

## Test Infra Improvement Notes

- `tests/unit/separation-*.test.ts` builds its db mock by hand in each file (nine copies of the same
  `vi.hoisted` block). A shared `project()`-honouring mock factory would remove the vacuous-mock
  risk repo-wide. Out of scope here; noted.
- `tests/e2e/separations.spec.ts` had no DB-fixture teardown pattern before this plan; C6 imports
  the tagged-fixture pattern from `payroll-void-run-amortization.spec.ts`. If that pattern is used a
  third time it should be extracted into `tests/e2e/helpers`.

---

## Resume and Execution Handoff

1. **Selected plan file:** `process/general-plans/active/separation-undo-304_PLAN_19-08-26.md`
2. **Last completed step:** PLAN written. Nothing built. Branch `spec/separation-undo-304` @
   `c6834d8`, two commits, unpushed. `src/` untouched.
3. **Validate-contract status:** pending — VALIDATE has not run.
4. **Context loaded:** the SPEC (in full); `separation.ts` (110-200, 255-370); `payroll/runs.ts`
   (90-152); `payroll/amortization.ts` (1-94); `payroll/audit-markers.ts`; `src/lib/server/audit.ts`;
   `prisma/schema.prisma` (194-207, 954-1000, 1850-1915); `rbac.ts:73`;
   `(app)/separations/[id]/+page.server.ts` and `+page.svelte:175-215`; `tests/e2e/separations.spec.ts`;
   `tests/unit/separation-finalize-sod.test.ts`; `package.json` scripts.
5. **Next step for a fresh agent:** get the owner confirmation from the first section, then run VALIDATE. Do **not**
   start C1 before that confirmation is answered — a ledger answer rewrites C1 and C2.

**Blocked on:** owner confirmation of the snapshot-over-ledger call (first section).

---

## Validate Contract

(placeholder — vc-validate-agent writes this section before EXECUTE)
