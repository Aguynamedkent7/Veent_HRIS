---
name: plan:payroll-void-audit-298
description: "#298 payroll side only — a dedicated PAYROLL_VOID audit action, a same-actor marker, lockedById/releasedById on PayrollPeriod, and approvedById disambiguated"
date: 17-08-26
feature: general-plans
---

# #298 — Payroll void made visible, lock/release actors recorded

**TL;DR.** Four changes, in one strict order. (1) Add three schema things: a new
`PAYROLL_VOID` audit action, and two nullable columns `lockedById` / `releasedById` on
`PayrollPeriod`. (2) Write those two columns from `lock()` and `release()`. (3) Stop `lock()`
writing `PayrollRun.approvedById` — that field now means the approver and nothing else.
(4) Add the same-actor void marker, extracted once, conditional-spread so it is absent on
ordinary voids. Nothing is blocked. No new 403 anywhere. No backfill.

**Date**: 17-08-26
**Status**: PLANNED — not validated, not executed, nothing committed
**Complexity**: SIMPLE (one session, 13 numbered steps, one plan file)

Risk class: money-adjacent + schema change, so the test bar is high even though the code is small.

## Overview

Issue #298 asks for the payroll half of the separation-of-duties work: make a payroll void
unmistakable in the history, and start recording who locked and who released a payroll period.
Nothing is blocked and nobody is newly refused — the control is **detection**, because the Super
Admin account is deliberately break-glass. The work is four small code changes plus a three-part
schema addition, all inside `payroll/periods.ts`, `payroll/runs.ts`, the audit-log page, and
`prisma/schema.prisma`.

Upstream SPEC: `process/general-plans/active/separation-of-duties-298-297_SPEC_17-08-26.md`
(LOCKED 17-08-26). This plan carries **only** the payroll half — SPEC decisions D1 and D2,
acceptance criteria AC-1.1 … AC-1.5 and AC-2.1 … AC-2.5.

> **Hard boundary.** #297 / `separation.ts` / the offboarding half (AC-3.x, AC-4.x, AC-5.1) is
> owned by a parallel agent. This plan must not read, edit, or test `separation.ts`.

---

## Goals

| # | Goal | SPEC criterion |
|---|---|---|
| G1 | Every payroll void carries a distinct, filterable audit action naming the actor | AC-1.1 |
| G2 | The same-actor marker is present only on real same-actor voids, never present-and-false | AC-1.2, AC-1.3 |
| G3 | Nobody is newly blocked from voiding, locking or releasing | AC-1.4, AC-2.4 |
| G4 | No external alert fires on void | AC-1.5 |
| G5 | Who locked and who released a period is a readable fact | AC-2.1, AC-2.2 |
| G6 | `PayrollRun.approvedById` means the approver and only the approver | AC-2.3 |
| G7 | Four actors (approver / locker / releaser / voider) readable as four separate names | AC-2.5 |

---

## Owner decisions carried in (locked — do not re-open)

1. **Detect, don't block.** Super Admin stays break-glass. No new guard, no new 403.
2. **Mark voids BOTH ways.** (a) a new always-on dedicated `AuditAction` value so every void is
   findable from the audit-log dropdown; (b) an *additional* same-actor key on `newValue` when the
   voider also approved or locked it.
3. **Record who locked and who released** a payroll period.
4. **Disambiguate `PayrollRun.approvedById`. No backfill of historical rows.**

### Why the enum value is the load-bearing half

`src/routes/(app)/reports/audit-log/+page.server.ts` returns `oldValue: null, newValue: null` for
**every** caller (the #242 mask, lines ~66–83). A marker inside `newValue` is therefore **invisible
on the audit screen**, and `reveal` is one row at a time, Super-Admin-only — i.e. in the worst case
revealed only by the same person who did the void.

So: the **new `AuditAction` value is the control**. The `newValue` key is supplementary metadata
for a DB-level or post-incident read. Do not invert this priority during EXECUTE.

---

## Verified facts EXECUTE may rely on (already confirmed by reading the code)

| Fact | Location |
|---|---|
| `AuditAction` = CREATE, UPDATE, DELETE, VIEW, LOGIN, LOGIN_FAILED, PAYROLL_OVERRIDE, LEAVE_OVERRIDE | `prisma/schema.prisma:194-203` |
| `PAYROLL_OVERRIDE` / `LEAVE_OVERRIDE` are the in-repo precedent for a dedicated action value | same |
| `AuditLog` model has **no `@@index` at all** | `prisma/schema.prisma:1382-1403` |
| `PayrollPeriod` has `lockedAt` / `releasedAt` but **no actor field** | `prisma/schema.prisma:1614-1615` |
| `PayrollRun.approvedById` / `approvedAt` | `prisma/schema.prisma:1091-1092` |
| `lock()` — status precondition, flagged-entry note, `$transaction` | `periods.ts:138` |
| `lockedAt` is set inside the atomic `updateMany` claim | `periods.ts:169-172` |
| `lock()` writes `approvedById: ctx.actorId` with a comment saying it deliberately leaves run status COMPUTED | `periods.ts:248-258` |
| `release()` | `periods.ts:268` |
| `voidPeriod()` — guard at :307, refuses an already-VOIDED period, reverses amortization | `periods.ts:304` |
| `voidRun()` — guard at :93, **no status precondition**, does **not** reverse amortization, does not touch the period | `runs.ts:91` |
| Hardcoded `entityTypes` array — **no `PayrollPeriod`** | `+page.server.ts:93-102` |
| Hardcoded `ACTIONS` array in the page | `+page.svelte:21-30` |
| `writeAuditLog(ctx, payload, client?)` — accepts a tx client | `src/lib/server/audit.ts:22-25` |
| Conditional-spread precedent (`selfVerifiedEvidence`) | `src/lib/server/services/approvals.ts:297-312` |
| Predicate-extraction precedent (`usedDocVerifierCarveOut`) | `src/lib/server/services/approvals.ts:157-163` |

---

## Every reader of `approvedById` / `approvedAt` (grep result, complete)

Required by the owner before step 8 removes the `lock()` write.

**Writers (3, not 2):**

| # | Site | Meaning today | After this plan |
|---|---|---|---|
| W1 | `src/lib/server/services/approvals.ts:673` | the real finance approver (`decidePayrollRun`, final APPROVE) | unchanged — this becomes the *only* payroll-run meaning |
| W2 | `src/lib/server/services/payroll/periods.ts:252-253` | whoever **locked** the period | **REMOVED** in step 8 |
| W3 | `src/lib/server/services/payroll/index.ts:508` | `approvePayroll()` — a separate approve path also writing `status: 'APPROVED'` | unchanged, out of scope, but **note it in the schema comment** |

> W3 was not named in the brief. It is a third writer, it writes the approver meaning (consistent
> with W1), and it is **out of scope** — do not touch it. It matters only because the schema comment
> must be honest about there being two approver writers, not one.

`recruitment.ts:174` also writes `approvedById`, but on **`JobPosting`** (`schema.prisma:1147`), a
different model. Irrelevant. Do not touch it.

**Readers (4 source sites, all payslip rendering):**

| # | Site | Uses |
|---|---|---|
| R1 | `payslip-document.ts:88, 282` | `payDate: run.approvedAt ? shortDate(run.approvedAt) : shortDate(run.periodEnd)` |
| R2 | `payslip-fetch.ts:91, 194` | selects `approvedAt`, passes it to R1 as `run.approvedAt` |
| R3 | `src/routes/(app)/payslips/[id]/+page.server.ts:29` | selects `approvedAt` for the payslip page |
| R4 | `src/routes/api/v1/payroll/payslips/[id]/+server.ts:36` | same, for the v1 API |

**No Svelte component renders `approvedAt` directly.** The only rendering path is the payslip
PDF: `payslip-pdf.ts:156` prints `labelValue(doc, 'PAYDATE:', d.period.payDate, …)`.

**Test readers:** `tests/unit/payslip-document.test.ts:40`, `payslip-draft-visibility.test.ts:83`,
`approval-self-guard.test.ts:557` (payroll, W1 path), `recruitment-posting-sod.test.ts:129/150/210`
(JobPosting, unrelated).

### The second-order effect — name it, do not hide it

**What renders it: the payslip PDF `PAYDATE:` field, via `payslip-document.ts:282`.**

Today a period that is **locked but never approved through the #134 chain** has `approvedAt` set by
the lock, so the payslip prints the **lock date** as PAYDATE. After step 8, `approvedAt` stays
`null` for that run and the payslip falls back to `shortDate(run.periodEnd)` — it prints the
**period end date** instead.

This is **more correct** (a run nobody approved should not claim an approval date) but it is a
**visible change to a printed document**. It is accepted, not a bug. It must be:

- called out in the EXECUTE commit message,
- shown in the live check (step L5 below), which prints the same payslip before and after,
- flagged to the owner in the handoff, because Finance may recognise the PAYDATE value changing.

There is no separate "approval date" column anywhere in the payroll UI, so nothing else moves.

---

## Touchpoints

| File | Change |
|---|---|
| `prisma/schema.prisma` | `+ PAYROLL_VOID` in `AuditAction`; `+ lockedById String?` / `+ releasedById String?` on `PayrollPeriod`; landmine comment on `PayrollRun.approvedById` |
| `src/lib/server/services/payroll/audit-markers.ts` | **NEW** — the extracted same-actor predicate |
| `src/lib/server/services/payroll/periods.ts` | `lock()` writes `lockedById`; `release()` writes `releasedById`; `lock()` stops writing `approvedById`/`approvedAt`; `voidPeriod()` uses the new action + marker |
| `src/lib/server/services/payroll/runs.ts` | `voidRun()` uses the new action + marker |
| `src/routes/(app)/reports/audit-log/+page.server.ts` | add `PayrollPeriod` to `entityTypes` |
| `src/routes/(app)/reports/audit-log/+page.svelte` | add `PAYROLL_VOID` to `ACTIONS` |
| `scripts/count-ambiguous-approvedby.ts` | **NEW**, read-only count script |
| `tests/unit/payroll-void-audit.test.ts` | **NEW** |
| `tests/unit/payroll-period-actors.test.ts` | **NEW** |

Read-only (do not edit): `approvals.ts`, `payroll/index.ts`, `payslip-document.ts`,
`payslip-fetch.ts`, `audit.ts`, `separation.ts`.

## Public Contracts

- **`AuditAction` enum gains `PAYROLL_VOID`.** Additive. Any exhaustive `switch` over `AuditAction`
  would break — grep confirms there is none; the audit page uses a hardcoded string array, which
  step 10 updates.
- **`PayrollPeriod` gains two nullable string columns.** No relation is added (see Design Note 2),
  so no `User` back-relation and no cascade behaviour changes.
- **`PayrollRun.approvedById` narrows in meaning** from "approver *or* locker, last write wins" to
  "approver". The column type and nullability are unchanged. Historical rows are untouched and
  therefore remain ambiguous — that is the documented, accepted state.
- **Audit `newValue` gains an optional `sameActorAsApprover` key** on void entries only.
- No route signature, no form action name, and no capability check changes.

## Blast Radius

- **9 files** (4 edited source, 2 new source, 1 schema, 2 new tests) + 2 UI array edits.
- **Risk class: schema/data migration + money-adjacent + audit/trust-boundary.** No auth change.
- **Auth surface: untouched.** The two mechanisms #282 left (`requireAnyCapability` in the service,
  capability table in `rbac.ts`) are not modified, extended, or bypassed. **No new auth mechanism.**
- Rollback: revert the commits; the two new columns can be left in place (nullable, unread by the
  reverted code) — no data is destroyed at any point.

---

## Design Notes (decided — EXECUTE does not re-derive these)

**1. Enum value addition under `db push`.** Adding a value to a Postgres enum is
`ALTER TYPE … ADD VALUE` — **additive and non-destructive**, unlike the *rename* trap documented in
`all-database.md` rule 2 and `scripts/migrate-employment-type-regular.ts`. **No `scripts/migrate-*.ts`
is needed.** Do not write one. Postgres 18 permits `ADD VALUE` outside a transaction block, which is
how `db push` issues it.

**2. Nullable columns, not relations.** `lockedById` / `releasedById` are bare `String?`, **not**
`@relation` to `User`. Reasons: a nullable add is metadata-only under `db push` (no table rewrite,
survives the populated-DB CI job); adding a relation would add an FK constraint that must validate
every existing row and would force a back-relation on `User`. `AuditLog.actorId` is the precedent
for actor-by-id, and the audit row is the authoritative record anyway. `NULL` honestly means
"this period predates the column" — it never means "nobody locked it".

**3. `lockedById` goes inside the atomic claim.** It is set in the same
`tx.payrollPeriod.updateMany({ where: { id, status: 'GENERATED' }, … })` as `lockedAt`
(`periods.ts:169-172`), so who-and-when are written by the single caller that wins the concurrency
race. Writing it in a second statement would let the loser of the race stamp its name.

**4. No rename, no backfill, no discriminator column** for `approvedById`. Historical ambiguity is
documented in a schema comment (house style — see the existing landmine comments at
`schema.prisma:1386-1388` and `periods.ts:248-252`) and counted by a read-only script.

**5. Marker shape.** Conditional spread — `...(pred && { sameActorAsApprover: true })`. The key is
**absent** on an ordinary void, never `false`. Precedent: `approvals.ts:310-311`. This is the SPEC's
explicit AC-1.2 requirement.

---

## Implementation Checklist

Order is load-bearing. Step 8 is only safe after step 6 has given the lock actor a new home; the
step 11 marker is only meaningful after step 8 has made `approvedById` mean one thing.

### Phase A — schema (steps 1–3)

**1. Add the audit action.** `prisma/schema.prisma`, inside `enum AuditAction` (line 194-203),
after `LEAVE_OVERRIDE`:

```
  PAYROLL_VOID
```

Add a one-line comment above it in house style, naming #298 and saying it exists so a void is
findable from the audit-log action filter without revealing any payload.

**2. Add the two period actor columns.** `prisma/schema.prisma`, `model PayrollPeriod`, immediately
after `releasedAt` (line 1615):

```
  lockedById     String?
  releasedById   String?
```

Above them, a comment stating: nullable because it records only what happened after #298 —
`NULL` means the period predates the column, never "nobody"; bare id, not a relation, so the
column add stays metadata-only on a populated database.

**3. Document the `approvedById` ambiguity.** `prisma/schema.prisma`, above
`approvedById` (line 1091), a landmine comment saying: before #298 this field was written by
**three** call sites — the finance approver (`services/approvals.ts` `decidePayrollRun`),
`approvePayroll` in `services/payroll/index.ts`, and *also* by whoever locked the period
(`services/payroll/periods.ts` `lock`). Rows written before #298 therefore mean "approver **or**
locker, whichever wrote last" and were deliberately **not** backfilled. From #298 the lock no
longer writes it; the lock actor lives on `PayrollPeriod.lockedById`.

**4. Regenerate and push.**

```bash
pnpm prisma generate
pnpm db:push
```

Do **not** believe a red `pnpm check` until `prisma generate` has run (this repo has
misdiagnosed that three times).

### Phase B — record the lock/release actors (steps 5–7)

**5. Write `lockedById` inside the atomic claim.** `periods.ts:169-172` — add to the `data` of the
existing `updateMany`, next to `lockedAt`:

```
data: { status: 'LOCKED', lockedAt: new Date(), lockedById: ctx.actorId }
```

Do not add a second statement. Do not move `lockedAt`.

**6. Write `releasedById`.** `periods.ts:272-275` — add to the existing `db.payrollPeriod.update`
data, next to `releasedAt`: `releasedById: ctx.actorId`.

**7. Surface both in the audit `newValue`.** In `lock()`'s `writeAuditLog` (`periods.ts:260-265`)
add `lockedById: ctx.actorId`; in `release()`'s (`periods.ts:276-281`) add
`releasedById: ctx.actorId`. This is the fact a reveal can read back even if a row is later edited
by hand. It is a plain fact key, **not** a marker — it is always present on those two entries, and
that is correct because these entries are not "overrides".

### Phase C — disambiguate `approvedById` (step 8)

**8. Remove the lock's approver write.** `periods.ts:248-258`. Delete `approvedById: ctx.actorId`
and `approvedAt: new Date()` from the `tx.payrollRun.update` data.

The `overrideNote` branch **stays**: the statement becomes

```ts
if (overrideNote) {
  await tx.payrollRun.update({
    where: { id: run.id },
    data: { hasOverride: true, overrideNote }
  })
}
```

i.e. the whole update is now conditional, because with the approver fields gone there is nothing to
write when there is no override note. Rewrite the block comment above it: it currently says "Record
who/when locked + any override, but DO NOT flip run.status to APPROVED". It must now say the lock
records **no** approver — who locked lives on `PayrollPeriod.lockedById` (#298) — and keep the
existing, still-true explanation of why run status stays `COMPUTED`.

**Do not** touch `approvals.ts:673` or `payroll/index.ts:508`. Both write the approver meaning and
are correct.

### Phase D — the void marker (steps 9–11)

**9. Extract the predicate once.** New file
`src/lib/server/services/payroll/audit-markers.ts`:

- export `voidedOwnApproval(actorId: string, run: { approvedById: string | null } | null | undefined, period?: { lockedById: string | null } | null): boolean`
- returns `true` when `actorId` is non-empty **and** equals `run?.approvedById` **or**
  `period?.lockedById`; `false` otherwise (including when both are `null` — a null-vs-null match
  must never count as same-actor).
- doc comment in the shape of `usedDocVerifierCarveOut` (`approvals.ts:155-163`): says this is the
  #298 detect-don't-block marker, that it is stamped onto the void's audit entry, and that the
  caller must conditional-spread it so a search for it returns only real same-actor voids.

Both `runs.ts` and `periods.ts` import it. **Do not duplicate the condition in two files.**

**10. `voidRun`.** `runs.ts:91-111`. The existing `db.payrollRun.findFirst` already returns the
whole row, so `run.approvedById` is available with no extra query. Change the `writeAuditLog` call:

```ts
await writeAuditLog(ctx, {
  action: 'PAYROLL_VOID',
  entityType: 'PayrollRun',
  entityId: id,
  oldValue: { status: run.status },
  newValue: {
    status: 'VOIDED',
    ...(voidedOwnApproval(ctx.actorId, run) && { sameActorAsApprover: true })
  }
})
```

The `requireAnyCapability(ctx.actorRoles, 'OVERRIDE_FINALIZED')` guard at :93 is **unchanged**.

**11. `voidPeriod`.** `periods.ts:304+`. `requirePeriod` returns the period with `runs` included;
the period now carries `lockedById` and `run` carries `approvedById`. Change its `writeAuditLog`
call the same way — `action: 'PAYROLL_VOID'`, `entityType: 'PayrollPeriod'`, and
`...(voidedOwnApproval(ctx.actorId, run, period) && { sameActorAsApprover: true })`. The guard at
:307 and the already-VOIDED refusal are **unchanged**.

If `voidPeriod`'s audit write happens after the amortization-reversal `$transaction`, leave it
there — do not move it into the transaction (that is a behaviour change).

### Phase E — make it filterable (step 12)

**12a.** `src/routes/(app)/reports/audit-log/+page.server.ts:93-102` — add `'PayrollPeriod'` to the
returned `entityTypes` array, after `'PayrollRun'`. Without this a period void cannot be filtered
for at all.

**12b.** `src/routes/(app)/reports/audit-log/+page.svelte:21-30` — add `'PAYROLL_VOID'` to the
`ACTIONS` array, after `'LEAVE_OVERRIDE'`.

Add a short comment in **both** places: this array is hand-maintained and must be extended whenever
`AuditAction` or an audited `entityType` gains a value, or the new value is unfilterable.

### Phase F — the read-only count (step 13)

**13.** New `scripts/count-ambiguous-approvedby.ts`, modelled on the existing `scripts/migrate-*.ts`
shape but **read-only — it must contain no `update`, `updateMany`, `$executeRaw` or `create`**.
It prints, per organization:

- total `payroll_runs` with `approvedById NOT NULL`
- of those, how many have `status <> 'APPROVED'` — the strong signal of a lock-written row, since
  the lock deliberately leaves the run `COMPUTED`
- how many have `approvedAt` within one second of their period's `lockedAt` — the corroborating
  signal

Run it with `pnpm exec tsx scripts/count-ambiguous-approvedby.ts`, print the numbers into the
EXECUTE report, and change nothing. Note in its header comment that `pnpm check` does **not**
typecheck `scripts/**`, so the file must be run once to prove it compiles.

---

## Explicitly OUT OF SCOPE

| Item | One-line reason |
|---|---|
| Adding a status precondition to `voidRun` | It is a real divergence from `voidPeriod`, but changing it is an undecided behaviour change and the SPEC says nobody is newly blocked. |
| Unifying `voidRun` / `voidPeriod` behaviour | Same reason — `voidPeriod` reverses amortization and `voidRun` does not; reconciling them is a money-moving decision the owner has not made. |
| `separation.ts` and everything in #297 | Owned by a parallel agent this session. |
| Backfilling historical `approvedById` rows | Owner decision 4: no backfill. |
| Renaming `approvedById` or adding a discriminator column | Owner decision: no rename, no new column. |
| External alerting on void | SPEC D1b: rejected. AC-1.5 requires the opposite. |
| Any new guard, refusal, or capability | SPEC D1/D2: detect, don't block. |
| `payroll/index.ts:508` `approvePayroll` | Writes the approver meaning; already correct. |

### Known limitation, stated on the record

`PAYROLL_VOID` will fire **identically** for `voidRun` and `voidPeriod`, which have **different
consequences** — `voidPeriod` reverses loan and cash-advance amortization, `voidRun` does not touch
balances or the period at all. The `entityType` column (`PayrollRun` vs `PayrollPeriod`) is the only
thing that distinguishes them on the audit screen. A reviewer must read `entityType`, not just the
action, to know whether money moved back. This is accepted for now; unifying the two is out of scope
above.

### FLAG — DO NOT BUILD (follow-up)

An index `@@index([organizationId, action, createdAt])` on `AuditLog` would help, because **this
change is what makes people actually use the action filter**, and `AuditLog` has **no indexes today**
(`schema.prisma:1382-1403`). Per #200 and `all-database.md` rule 6, an index on a large populated
table is its own pre-push work item and must be created in a pre-push step, never during the push.
**Do not add it in this plan.** Record it as a follow-up for the owner. Do not file a GitHub issue.

---

## CI — what `schema-upgrade` exercises here

`.github/workflows/ci.yml` job 3 runs `prisma db push` against a **populated** database. For this
change it specifically proves:

- **`ALTER TYPE "AuditAction" ADD VALUE 'PAYROLL_VOID'` succeeds on a type that is already in use**
  by existing `audit_logs` rows — i.e. that this is genuinely additive and does not drop/recreate the
  enum the way a *rename* would.
- **Adding `lockedById` / `releasedById` to a populated `payroll_periods`** is metadata-only: both
  are nullable with no default and no FK, so Postgres does not rewrite the table, does not need to
  validate existing rows, and no `NOT NULL` violation is possible.
- It does **not** exercise the index question — because no index is being added (see the FLAG).
- It does **not** typecheck `scripts/**`, so it will not catch a broken
  `count-ambiguous-approvedby.ts`. That is why step 13 requires running the script once by hand.

The `quality` job (`format:check` → `lint` → `check` → `test`) runs `prisma generate` first, so the
two new columns and the new enum value will be in the generated client for the typecheck.

---

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `void-override-marked` — `voidRun` writes `action: 'PAYROLL_VOID'` with the actor's id on the row | Hybrid (unit + L2 live) | AC-1.1 |
| `void-period-override-marked` — `voidPeriod` writes `action: 'PAYROLL_VOID'`, `entityType: 'PayrollPeriod'` | Hybrid (unit + L2 live) | AC-1.1 |
| `override-marker-absent-on-ordinary` — a void by a *different* actor has **no** `sameActorAsApprover` key at all (`expect(newValue).not.toHaveProperty(...)`, not `toBe(false)`) | Fully-Automated | AC-1.2 |
| `override-search-returns-only-real` — lock + release + generate write actions other than `PAYROLL_VOID`, so filtering by `PAYROLL_VOID` returns only voids | Fully-Automated | AC-1.2 |
| `void-same-actor-visible` — when the voider equals `run.approvedById`, `sameActorAsApprover: true` is present; and when the voider equals `period.lockedById` | Hybrid (unit + L3 live) | AC-1.3 |
| `void-capability-unchanged` — `tests/unit/override-finalized-guard.test.ts` stays green unmodified | Fully-Automated | AC-1.4 |
| `void-no-external-alert` — `notifyMany` is mocked and asserted `not.toHaveBeenCalled()` across both void paths | Fully-Automated | AC-1.5 |
| `period-locker-recorded` — `lock()`'s `updateMany` data contains `lockedById: ctx.actorId` **in the same call** as `lockedAt` | Hybrid (unit + L4 live psql) | AC-2.1 |
| `period-releaser-recorded` — `release()` sets `releasedById`, distinct from `lockedById` | Hybrid (unit + L4 live psql) | AC-2.2 |
| `approver-record-unambiguous` — user A approves, user **B** locks; the run's `approvedById` is still A and the lock's `payrollRun.update` is either absent or carries no approver key | Fully-Automated | AC-2.3 |
| `lock-release-capability-unchanged` — existing payroll permission suites stay green unmodified | Fully-Automated | AC-2.4 |
| `payroll-four-actors-readable` — approver / locker / releaser / voider read back as four different ids | Hybrid (unit + L5 live) | AC-2.5 |
| `guard-mutation-check` — the mutation table below, **run and its result recorded** | Fully-Automated | AC-5.3 |
| Live L1–L6 (below) | Agent-Probe | AC-1.1, AC-1.3, AC-2.1, AC-2.2, AC-2.5 |

### Test files

- `tests/unit/payroll-void-audit.test.ts` — the void half (AC-1.x). Mock `$lib/server/db`,
  `$lib/server/audit` (`writeAuditLog` as a spy), and the notifier. Assert on the **argument object
  passed to `writeAuditLog`**, not on a return value.
- `tests/unit/payroll-period-actors.test.ts` — lock/release/approver half (AC-2.x). Mock the
  `$transaction` so the `tx` client's `payrollPeriod.updateMany` and `payrollRun.update` calls are
  capturable.

Do **not** modify `tests/unit/override-finalized-guard.test.ts`. Its value is that it stays green
untouched (AC-1.4).

### What `override-finalized-guard.test.ts` does and does not prove

**Does prove** (24 `it()` blocks, ~28 cases): that `voidRun`, `voidPeriod` and `unlockRange` each
name `OVERRIDE_FINALIZED` — not `ADMINISTER_SYSTEM` — so the CEO cannot void payroll they approved;
that the whole role set is judged (#256), so a multi-role actor whose authority comes from a
secondary role is admitted; that an **empty** role set refuses (closed, never open); and that the
write actually happened, so a silently no-opping guard cannot pass. `voidRun` runs **real**
throughout; `voidPeriod` and `unlockRange` are mocked at the route level and pulled in real
separately.

**Does not prove** anything about **this** plan: it never inspects the audit entry, never touches
`newValue`, and knows nothing about `PAYROLL_VOID` or `sameActorAsApprover`. It also mocks the DB,
so it cannot prove a query-level or tenant-scoping hole. **Do not duplicate its WHO-may-void cases.**
Its only role here is the AC-1.4 negative control: it must stay green with zero edits.

---

## Mutation checks (AC-5.3 — must be RUN, not just intended)

Each row: break it on purpose, run `pnpm test`, confirm the named test goes **red**, then revert.
A change whose removal leaves the suite green is not proven. Record the actual result of each row in
the EXECUTE report — an unrun mutation table is a hypothesis, not evidence.

| # | Break this | Must go red |
|---|---|---|
| M1 | Change `action: 'PAYROLL_VOID'` back to `'UPDATE'` in `voidRun` | `void-override-marked` |
| M2 | Same in `voidPeriod` | `void-period-override-marked` |
| M3 | In `voidedOwnApproval`, replace the conditional spread with `sameActorAsApprover: pred` (present-and-false) | `override-marker-absent-on-ordinary` |
| M4 | In `voidedOwnApproval`, drop the `actorId != null` / non-empty check so `null === null` matches | `override-marker-absent-on-ordinary` (a void with a never-approved run must not be marked) |
| M5 | Drop the `\|\| period?.lockedById` arm | the locker-arm case of `void-same-actor-visible` |
| M6 | Remove `lockedById` from the `updateMany` data | `period-locker-recorded` |
| M7 | Move `lockedById` out of the `updateMany` into a separate `tx.payrollPeriod.update` after it | `period-locker-recorded` (the test asserts it is in the **same** call as `lockedAt` — this is the atomicity assertion, and it is the one a naive test misses) |
| M8 | Remove `releasedById` from `release()` | `period-releaser-recorded` |
| M9 | Put `approvedById: ctx.actorId` back into `lock()` | `approver-record-unambiguous` |
| M10 | Remove `'PAYROLL_VOID'` from the `ACTIONS` array in `+page.svelte` | **Nothing goes red — by design.** This is the gap the unit suite cannot close; it is why L6 exists. Record "no test caught it" as the recorded result. |
| M11 | Remove `'PayrollPeriod'` from `entityTypes` | **Nothing goes red — by design.** Same; covered by L6. |

M10 and M11 are the honest finding this repo's history demands: two of the twelve changes are
**not unit-provable at all**. That is the whole reason the live pass below is mandatory, not optional.

---

## Live verification (mandatory — not optional)

No unit test in this repo can prove three things, because the suite mocks the database and never
renders a page: **(a)** that the two hardcoded dropdown arrays were actually updated, **(b)** that the
new action survives the #242 mask and is genuinely filterable at `/reports/audit-log`, and **(c)**
that `lockedById` really reached Postgres from inside a `$transaction` + `updateMany`.

**Harness.** The **user starts the dev server themselves — the agent never starts it.** Then:

```bash
# log in as a chosen user (keep the cookie jar)
curl -s -c /tmp/j.txt -X POST http://localhost:5173/api/v1/_dev/login-as \
  -H 'content-type: application/json' -d '{"email":"EMAIL_HERE"}'

# assert against the database row, never against a value you injected
docker exec veent-db-5434 psql -U veent -d veent_hris -p 5434 -tAc "SQL_HERE"
```

Table names are snake_case plural: `payroll_periods`, `payroll_runs`, `audit_logs`, `users`.
**Plant a marker** — name the test period something unmistakable, e.g. `ZZ-298-PROBE`, and find every
row by that name. Run the whole script **before** the change and **again after**, keeping the negative
controls on both sides.

| # | Step | Assert |
|---|---|---|
| **L1** | Create period `ZZ-298-PROBE`, import attendance, generate | `select status from payroll_periods where name='ZZ-298-PROBE'` → `GENERATED` |
| **L2** | Approve the run as user **A** (finance approver), then **lock** as a *different* user **B** | `select "approvedById", "approvedAt", status from payroll_runs where "periodId"=…` → **`approvedById` = A's id, NOT B's**; `status` = `COMPUTED`. **Negative control, both sides:** before the change this query returns **B**; after, it returns **A**. |
| **L3** | Same lock, period side | `select "lockedById","lockedAt","releasedById" from payroll_periods where name='ZZ-298-PROBE'` → `lockedById` = **B**, `lockedAt` non-null, `releasedById` **NULL**. This is the (c) proof — it came out of the `$transaction`+`updateMany`. |
| **L4** | Release as user **C** | `releasedById` = **C**, and **≠ `lockedById`**. Assert both ids positively; "not null" alone proves nothing. |
| **L5** | Void the period as user **B** (who locked it) | `select action, "entityType", "newValue"->>'sameActorAsApprover' from audit_logs where "entityId"=… order by "createdAt" desc limit 1` → `PAYROLL_VOID`, `PayrollPeriod`, `true`. Then repeat the whole cycle voiding as a **fourth** user D and assert the JSON key is **absent**: `select ("newValue" ? 'sameActorAsApprover') from audit_logs …` → `f`. That `?` operator distinguishes absent from false — `->>` cannot. |
| **L6** | Open `/reports/audit-log` in a real browser as Super Admin | The **Action** dropdown contains a `PAYROLL_VOID` option and the **Entity** dropdown contains `PayrollPeriod`. Select `PAYROLL_VOID`, submit, and confirm the result list contains the probe rows and **nothing else**. Name the controls exactly (`select#action`, `select#entity`) and assert something **positive** — a missing option and a wrong selector look identical. **Take a screenshot**; assertions do not see layout. |
| **L7** | Payslip PAYDATE second-order effect | Open the payslip PDF for an entry in a **locked-but-never-approved** run before and after the change. Before: PAYDATE = the lock date. After: PAYDATE = the period end date. Record both values. This is expected, not a regression — but it must be seen, not assumed. |

**Negative controls that must appear on BOTH sides of the change:** L2's `approvedById` query
(returns B before, A after) and L5's absent-key query (must be `f` for a different-actor void both
before *and* after — before the change there is simply no key at all, which is also `f`).

**Cleanup:** delete the `ZZ-298-PROBE` period and its rows after the run, or note explicitly in the
report that it was left behind and why.

---

## Test Infra Improvement Notes

- The two hardcoded arrays (`entityTypes` in `+page.server.ts`, `ACTIONS` in `+page.svelte`) are
  **structurally untestable by the unit suite** and will silently drift from the `AuditAction` enum
  again. A cheap fix exists — a unit test that imports `AuditAction` from `@prisma/client` and
  asserts the page's `ACTIONS` array equals `Object.values(AuditAction)`. **Not built in this plan**
  (it needs the array exported from the Svelte module, a small refactor outside this blast radius).
  Recorded here so it is not lost.
- `pnpm check` does not typecheck `scripts/**`, so `count-ambiguous-approvedby.ts` has no gate. Run
  it once by hand (step 13). A repo-wide fix is out of scope.
- There is no existing unit test file covering the `periods.ts` lock/release **service** at all —
  `tests/unit/pay-periods.test.ts` covers the unrelated `src/lib/utils/pay-periods.ts` date helpers.
  This plan creates the first one.

---

## Commands (exact)

```bash
pnpm prisma generate            # ALWAYS before believing a red check
pnpm db:push                    # prisma db push — no migration files in this repo
pnpm exec tsx scripts/count-ambiguous-approvedby.ts

pnpm format:check
pnpm lint
pnpm check
pnpm test                       # vitest run — there is no test:unit script
pnpm test -- payroll-void-audit payroll-period-actors override-finalized-guard
```

`pnpm test:e2e` is **not** a gate for this change — it is flaky (#287) and no e2e spec covers the
audit log. Do not chase a red e2e run here.

---

## Risks

| Risk | Mitigation |
|---|---|
| A future `switch` over `AuditAction` breaks on the new value | Grep confirms none exists today; the two hardcoded arrays are updated in step 12 |
| The payslip PAYDATE change surprises Finance | Named explicitly above, proven in L7, called out in the commit message and the handoff |
| A `null === null` false match marks an ordinary void as same-actor | Mutation check M4 exists precisely for this |
| `lockedById` written outside the atomic claim by a later refactor | Mutation check M7 asserts it is in the **same** call as `lockedAt` |
| Vacuous mock green (this repo's #1 historical false-green) | The mutation table is mandatory and its **results** must be recorded; M10/M11 are pre-declared as uncatchable and covered by L6 |
| Historical rows keep the old ambiguity | Accepted by owner decision 4; documented in the schema comment; quantified by the step-13 script |

---

## Acceptance Criteria (done means)

1. All 13 steps applied, in order.
2. `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm test` all green.
3. `tests/unit/override-finalized-guard.test.ts` green **with zero edits**.
4. Every row of the mutation table **run**, with its actual result recorded (including M10/M11's
   "nothing went red — by design").
5. L1–L7 run live, before and after, with the negative controls on both sides and a screenshot from
   L6.
6. The step-13 count printed into the report.
7. No new 403, no new guard, no capability change anywhere in the diff.
8. `separation.ts` untouched — confirm with `git diff --name-only`.
9. Nothing committed by this plan's author without explicit owner approval; **no `Co-Authored-By`
   trailer**; merges go to `staging`, so `Closes #298` never fires — the issue is closed by hand.
   **Do not file any GitHub issue.**

---

## Phase Completion Rules

This plan is a single phase. It is `CODE DONE` when steps 1–13 are applied and the four automated
gates are green. It is only `VERIFIED` when, in addition:

- every mutation-check row M1–M11 has been **run** and its actual result recorded (an unrun
  mutation table is a hypothesis, not evidence — see `process/context/tests/all-tests.md`), and
- L1–L7 have been run live before **and** after the change, with the negative controls on both
  sides and the L6 screenshot attached.

Code-only completion is `CODE DONE`, never `VERIFIED`. A green unit suite alone does not promote
this plan, because M10 and M11 are pre-declared as uncatchable by the unit suite.

## Resume and Execution Handoff

1. **Selected plan file:** `process/general-plans/active/payroll-void-audit-298_PLAN_17-08-26.md`
2. **Last completed step:** PLAN written. No code written. Nothing committed. Working tree clean on
   `feat/timesheet-capture-162-177-200`.
3. **Validate-contract status:** pending — VALIDATE has not run.
4. **Context loaded:** `process/context/all-context.md`, `auth/all-auth.md` (routing only),
   `database/all-database.md`, `cicd/all-cicd.md`, `tests/all-tests.md`, and the locked SPEC
   `separation-of-duties-298-297_SPEC_17-08-26.md`.
5. **Next step for a fresh agent:** run VALIDATE against this file. Then EXECUTE **step 1**
   (`prisma/schema.prisma` enum value). Do not start at step 8 — the order in Phase A → F is
   load-bearing. Before touching anything, re-run
   `grep -rn "approvedById\|approvedAt" src prisma tests scripts` and confirm the reader list above
   still matches; the parallel #297 agent must not have changed it.

## Validate Contract

(placeholder — vc-validate-agent writes this section before EXECUTE)
