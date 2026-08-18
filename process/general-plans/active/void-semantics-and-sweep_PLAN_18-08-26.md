---
name: plan:void-semantics-and-sweep
description: "#298 follow-ons D10/D11/D12 — a live probe gating the void-run/void-period divergence fix, the clean 'who approved' sweep recorded as a permanent enumeration, and the payslip PAYDATE before/after sample"
date: 18-08-26
feature: general-plans
---

# D10 / D11 / D12 — void semantics, the approver sweep, and the payslip PAYDATE record

**TL;DR.** Three separate jobs, one plan, one strict order. **(1)** Run a live probe first
(step 1) that proves — or disproves — that voiding a payroll *run* leaves loan and
cash-advance balances reduced. Nothing in D10 may be built until that probe has a recorded
result. **(2)** If it reproduces, give `voidRun` the missing status precondition and the
missing amortization reversal, both reusing `voidPeriod`'s existing code. **(3)** D11 is
already done as research: the sweep came back **clean**, so the only deliverable is the
written enumeration below — no code. **(4)** D12 is a recorded before/after sample of a
real payslip PDF plus a hand-off note to Finance. No new refusal is added on any path a
user can reach today except the already-voided run, which was never meaningful to void.

**Date**: 18-08-26
**Status**: PLANNED — not validated, not executed, nothing committed
**Complexity**: SIMPLE (one session, 12 numbered steps, one plan file)

Risk class: **money-moving** (step 6 credits balances back) + audit/trust-boundary. The code
is small; the test bar is the highest in this SPEC because a wrong reversal moves real money.

## Overview

Upstream SPEC: `process/general-plans/active/separation-of-duties-298-297_SPEC_17-08-26.md`
(LOCKED 17-08-26, AMENDED 18-08-26). This plan carries **only** SPEC decisions **D10, D11 and
D12** — acceptance criteria **AC-7.1 … AC-7.5**, **AC-8.1 … AC-8.3**, **AC-10.1 … AC-10.3**.

> **Hard boundary — three parallel owners.**
> - `payroll-void-audit-298_PLAN_17-08-26.md` owns D1/D2 — the `PAYROLL_VOID` audit action,
>   `lockedById`/`releasedById`, and removing the `lock()` write of `approvedById`. **This plan
>   must not make those edits.** It depends on them (see Dependencies) and tests around them.
> - `clearance-signoff-297_PLAN_17-08-26.md` owns #297 / `separation.ts`. **Do not read, edit
>   or test `separation.ts` from this plan.**
> - This plan owns `runs.ts`, the `voidPeriod` cash-advance branch of `periods.ts`, one new
>   doc file, and its own tests.

### D9 — deliberately not planned here (placeholder)

**D9 (final pay understated, AC-6.1 – AC-6.5) is excluded from this plan and from this
session.** Its premise — that final pay is understated by a large factor — was **disproved**
during research; the finding it rested on did not survive a direct read. Because D9 was folded
into the SPEC on the strength of that premise, its fate is a decision for the owner, not for a
plan agent: it may be dropped from the SPEC, re-scoped to whatever the corrected reading shows,
or kept as a characterization-only exercise under D5. Nothing in this plan touches final-pay
arithmetic, `separation.ts`, or AC-6.x, and no step here assumes D9 will or will not happen.
Do not plan, build, or test D9 from this file.

---

## Goals

| # | Goal | SPEC criterion |
|---|---|---|
| G1 | The void-run divergence is **proven or disproven live** before any fix exists | AC-7.1 |
| G2 | Voiding a run no longer leaves loan/cash-advance repayments applied to a dead payroll | AC-7.2 |
| G3 | Voiding an already-voided run is refused, with the reason stated | AC-7.3 |
| G4 | Nobody who can void a run in a real state is newly blocked | AC-7.4 |
| G5 | Run void vs period void is described in exactly one place a reader can find | AC-7.5 |
| G6 | Every "approved by" style writer is enumerated with a verdict, on the record | AC-8.1, AC-8.3 |
| G7 | Any genuinely ambiguous record is fixed the way D2 fixes the payroll period | AC-8.2 |
| G8 | The payslip PAYDATE move is captured as a real rendered sample and told to Finance | AC-10.1, AC-10.2, AC-10.3 |

---

## Dependencies (ordering against the two sibling plans)

| Dependency | Why | What happens if ignored |
|---|---|---|
| **D2 step 8** (`payroll-void-audit-298`) removes `approvedById: ctx.actorId` from `lock()` | AC-10.1's "after" sample only exists once that write is gone | The PAYDATE before/after sample would show no difference and prove nothing |
| **D1 step 9–11** adds `voidedOwnApproval` + `action: 'PAYROLL_VOID'` to `voidRun` | This plan edits the **same function body** in `runs.ts` | Two agents editing `voidRun` concurrently will conflict |
| **D11's verdict** (below) is what D2 step 8 implements | The sweep found exactly one ambiguous field and D2 already fixes it | Somebody "fixes" `JobPosting.approvedById`, which is a different model and correct |

**Sequencing rule:** run **step 1 (the live probe) first and independently — it needs no sibling
plan and blocks the rest of D10.** Steps 4–9 (`runs.ts` edits) must land **after**
`payroll-void-audit-298` steps 9–11, or in the same worktree, never in parallel. Steps 10–11
(the D11 enumeration) and step 12 (the D12 note) have no ordering constraint at all and may be
done at any point.

---

## Verified facts EXECUTE may rely on (each read from the code 18-08-26)

| Fact | Location |
|---|---|
| `voidRun` writes exactly **one** column — `payroll_runs.status` — plus one audit row. No `$transaction`. No period write, no loan write, no cash-advance write, no `LoanPayment` write. | `src/lib/server/services/payroll/runs.ts:92-112` |
| `voidRun` has **no status precondition**. Only a 404 if the run is missing. DRAFT, COMPUTED, APPROVED and already-VOIDED all void alike, writing `VOIDED` again plus a fresh audit row. | `runs.ts:95-101` |
| `voidPeriod` reverses balances, gated on `wasLocked` | `periods.ts:304-374`, gate at `:312` (`LOCKED` or `RELEASED` only) |
| `voidPeriod` refuses an already-voided period | `periods.ts:310` |
| Amortization is applied at **LOCK only** | `periods.ts:138-266` — loans `:214-217`, cash advances `:232-235`, `LoanPayment` rows `:201-203` |
| Both voids require `OVERRIDE_FINALIZED` | `runs.ts:93`, `periods.ts:307` |
| `OVERRIDE_FINALIZED` is held by `SUPER_ADMIN` only | `src/lib/rbac.ts:73` |
| **A run void has NO UI button.** Its only caller is the v1 API. | `src/routes/api/v1/payroll/[id]/+server.ts:66-79` — `POST /api/v1/payroll/[id]?action=void`. `grep -rn voidRun src/` returns the service, that route, and one comment. Nothing else. |
| The run detail page exports only `override`, `compute`, `decide` — no `void` action | `src/routes/(app)/payroll/[id]/+page.server.ts` |
| `PayrollPeriod` has `lockedAt` / `releasedAt` and **no actor column at all** | `prisma/schema.prisma:1613-1614` |
| Every `@map` in the schema is table-level `@@map`; there are **zero** field-level `@map`s | `prisma/schema.prisma` — so table names are snake_case, column names are camelCase and must be double-quoted in psql |
| `tests/e2e/payroll-lock-idempotency.spec.ts` seeds a **live** loan against a real period with a real `PrismaClient` and drives the real lock route | that file, `seed()` at the top, `TAG = 'e2e-lock-102'` |
| `tests/unit/override-finalized-guard.test.ts` runs `voidRun` **real** against a mocked db | that file, `:65` imports the real module; `:131-153` call it |

### The consequence the SPEC does not carry: a run void is API-only

AC-7.1 says "void a run on a locked period". There is **no button for that anywhere in the
product.** The live reproduction is a `curl` call with a session cookie, not a click. The
manual-test script in step 1 is written that way. This also bounds the blast radius of AC-7.3:
adding a status precondition to `voidRun` can break no UI, because no UI reaches it.

### The bug inside the fix site — `voidPeriod` is not a true inverse for cash advances

Read `periods.ts:229` against `periods.ts:352-360`:

- **Lock** applies `min(d.amount, liveBalance)` and records nothing about what it applied
  (cash advances have no payment ledger — the code says so at `:224-226`).
- **Void** credits back the raw frozen `d.amount` (`:356`), because there is no ledger to
  consult, and forces `status: 'ACTIVE'` **unconditionally**.
- The **loan** branch is a true inverse: it reads the actual `loan_payments` rows (`:333-337`),
  reverses exactly that sum, sets `ACTIVE` only when the restored balance is `> 0` (`:345`),
  then deletes the payment rows (`:348-350`).

So when lock capped a cash-advance payment — the borrower had less outstanding than the
installment — **void over-credits the difference**, and it can resurrect a `PAID` advance that
some other payment settled.

**Decision for this plan: fence it off, do not fix it.** Reasons, on the record:

1. It is **not D10**. D10 is "a run void and a period void do different things". This is "the
   period void's cash-advance arm is wrong", which is true today with or without D10.
2. Fixing it needs a **new payment ledger for cash advances** (the loan branch only works
   because `LoanPayment` exists). That is a schema addition with a backfill question, which is
   a decision the owner has not been asked.
3. Step 6 of this plan **calls the existing reversal, it does not rewrite it** — so this plan
   neither introduces the over-credit nor widens it. It does propagate it from one void path to
   two, which is why it is named here rather than left silent.

**Recorded as a follow-up for the owner, not built, and no GitHub issue filed** (SPEC constraint
11 — the 18-08-26 approval covered #304–#308 only and does not carry). Step 6's doc comment must
name it so the next reader of that code finds it.

---

## Touchpoints

| File | Change |
|---|---|
| `src/lib/server/services/payroll/runs.ts` | `voidRun` gains a status precondition and calls the extracted reversal |
| `src/lib/server/services/payroll/periods.ts` | **extract only** — the amortization-reversal block (`:313-370`) moves to a shared function; behaviour unchanged, cash-advance bug preserved verbatim and commented |
| `src/lib/server/services/payroll/amortization.ts` | **NEW** — `reverseAmortization(tx, runId)`, the block lifted out of `voidPeriod` |
| `docs/payroll-void-semantics.md` | **NEW** — AC-7.5, the one place both voids are described |
| `tests/unit/void-run-semantics.test.ts` | **NEW** — AC-7.3, AC-7.4, and the "reversal WAS called" assertion |
| `tests/e2e/payroll-void-run-amortization.spec.ts` | **NEW** — AC-7.2, cloned from `payroll-lock-idempotency.spec.ts` |
| `process/general-plans/active/void-semantics-and-sweep_PLAN_18-08-26.md` | this file — the D11 enumeration below **is** the AC-8.1/AC-8.3 deliverable |

Read-only (do not edit): `separation.ts`, `approvals.ts`, `payroll/index.ts`,
`recruitment.ts`, `payslip-document.ts`, `payslip-pdf.ts`, `prisma/schema.prisma`,
`tests/unit/override-finalized-guard.test.ts`, `tests/e2e/payroll-lock-idempotency.spec.ts`.

## Public Contracts

- **`voidRun` gains one refusal**: `error(400, …)` when the run is already `VOIDED`. Its only
  caller is `POST /api/v1/payroll/[id]?action=void`, whose catch block already maps `400` to
  `apiError` (`+server.ts:59-61` does exactly this for the approve branch — **confirm the void
  branch does too before step 5; today it has no try/catch at all**, so an un-caught `error(400)`
  would surface as a raw SvelteKit error). Step 5 covers this.
- **`voidRun` becomes money-moving.** Callers that previously assumed a status-only flip now
  cause loan and cash-advance balances to change. The only caller is the API route.
- **`voidRun`'s return value is unchanged** — the updated run.
- **No capability check changes.** `OVERRIDE_FINALIZED` at `runs.ts:93` and `periods.ts:307`
  are untouched. No new mechanism.
- **`voidPeriod`'s observable behaviour is unchanged** — step 3 is a pure extraction.
- **No schema change.** Nothing in this plan touches `prisma/schema.prisma`.

## Blast Radius

- **6 files**: 2 edited source, 2 new source/doc, 2 new tests. Plus this plan file.
- **Risk class: money-moving + audit/trust-boundary.** No schema, no auth, no migration.
- **Auth surface: untouched.** The two mechanisms #282 left standing are not modified,
  extended or bypassed.
- Rollback: revert the commits. No data is destroyed at any point, but note that **any run
  voided between deploy and revert will have had its balances credited back** — that is the
  intended effect and is not undone by a code revert. Say so in the commit message.

---

## Design Notes (decided — EXECUTE does not re-derive these)

**1. Extract, do not re-implement.** The reversal in `voidPeriod` is subtle (it reverses what
was *actually applied* via `loan_payments`, not the frozen deduction line — see the comment at
`periods.ts:328-331`). Writing a second copy for `voidRun` would drift. Step 3 lifts it into
`amortization.ts` and both call it. Behaviour must be byte-identical after the extraction; the
existing e2e lock-idempotency spec is the proof (step 3's gate).

**2. `reverseAmortization` takes the transaction client.** Signature:
`reverseAmortization(tx: Prisma.TransactionClient, runId: string): Promise<void>`. It must not
open its own transaction — the caller owns the transaction boundary, exactly as the block does
inside `voidPeriod` today.

**3. `voidRun` must gain a `$transaction`.** It has none today. The status flip and the reversal
must commit or fail together, or a crash mid-reversal leaves a `VOIDED` run with half its
balances credited back. Wrap the `payrollRun.update` and the `reverseAmortization` call in one
`db.$transaction`, matching `voidPeriod`'s shape.

**4. The reversal is conditional on the period, not the run.** Amortization is applied at
**lock**, which is a period operation. So `voidRun` reverses only when the run's period is
`LOCKED` or `RELEASED` — the same `wasLocked` test as `periods.ts:312`. A run on a `GENERATED`
period never had amortization applied and must not be credited. `voidRun`'s current
`findFirst` does **not** include the period; step 6 adds `include: { period: true }`.

**5. The status precondition is `VOIDED`-only.** AC-7.4 says nobody is newly blocked from
voiding a run in a valid state. DRAFT and COMPUTED voids may be pointless but they are not
harmful and somebody may rely on them. **Refuse only an already-`VOIDED` run** — the one state
that was never meaningful to void, and the one `voidPeriod` already refuses (`periods.ts:310`).
Do not add a DRAFT or APPROVED refusal; that would fail AC-7.4.

**6. AC-7.5 is a doc file, not a code comment.** "One place a reader can see what each does and
does not reverse" means a reader who is not already in the file. `docs/payroll-void-semantics.md`
is that place; both service functions get a one-line comment pointing at it.

**7. D11 requires no code.** See the enumeration. The sweep is clean; the one ambiguous field
is already D2's. AC-8.2's deliverable in this plan is a **regression fence**, not a fix.

---

## Implementation Checklist

Order is load-bearing. **Step 1 gates steps 3–9 completely.** Step 3 must be green before step 6
uses it. Steps 10–12 are independent and may be done at any time.

### Phase A — the gate (steps 1–2)

**1. Run the live probe. AC-7.1. Nothing else in D10 may start until this has a recorded
result.**

The user starts the dev server; **the agent never starts it, and never starts the database.**
Then, from a clean tree with no code changes:

```bash
# 1a. session cookie for the Super Admin (the only holder of OVERRIDE_FINALIZED)
curl -s -c /tmp/void-probe.txt -X POST http://localhost:5173/api/v1/_dev/login-as \
  -H 'content-type: application/json' -d '{"email":"SUPERADMIN_EMAIL_HERE"}'
```

Then, in the browser as that user, build the marker state — **name it `ZZ-D10-PROBE`** so every
row is findable:

1. Give an employee an ACTIVE loan with a balance well above one installment.
2. Open a period named **`ZZ-D10-PROBE`**, import attendance, generate.
3. Note the run id from the URL. Note the loan id.

**Before lock** — record the baseline:

```bash
docker exec veent-db-5434 psql -U veent -d veent_hris -p 5434 -tAc \
"select p.id, p.name, p.status, r.id, r.status
   from payroll_periods p join payroll_runs r on r.\"periodId\" = p.id
  where p.name = 'ZZ-D10-PROBE';"

docker exec veent-db-5434 psql -U veent -d veent_hris -p 5434 -tAc \
"select id, balance, status from loans where id = 'LOAN_ID_HERE';"

docker exec veent-db-5434 psql -U veent -d veent_hris -p 5434 -tAc \
"select count(*) from loan_payments where \"loanId\" = 'LOAN_ID_HERE';"
```

Expect: period `GENERATED`, run `COMPUTED`, loan balance = the full principal, **0** payment rows.

**Lock the period** in the browser. Re-run all three queries.
Expect: period `LOCKED`, loan balance **reduced by the installment**, **1** payment row.
*If the balance did not move, the probe is invalid — the deduction was not generated. Fix the
seed and start again; do not record a result from a run where lock did nothing.*

**Void the RUN — via curl, there is no button:**

```bash
curl -s -b /tmp/void-probe.txt -X POST \
  'http://localhost:5173/api/v1/payroll/RUN_ID_HERE?action=void'
```

Expect HTTP 200 and the run back with `status: "VOIDED"`. Re-run all three queries.

**The recorded result of AC-7.1 is these three numbers after the void:**

| Query | Reproduces (the SPEC's claim) | Does NOT reproduce |
|---|---|---|
| `payroll_runs.status` | `VOIDED` | `VOIDED` either way — this is not the signal |
| `payroll_periods.status` | still **`LOCKED`** | anything else |
| `loans.balance` | still **reduced** | back at the full principal |
| `count(loan_payments)` | still **1** | 0 |

Then, as the **negative control on the same data**, void the **period** through the UI on a
fresh `ZZ-D10-PROBE-2` cycle and confirm the balance **does** return and the payment row **is**
deleted. Without this control, "the balance stayed reduced" could equally mean the reversal is
broken everywhere.

**Cleanup:** delete both probe periods, their runs, entries, deductions, payment rows and the
seeded loan — or state explicitly in the report that they were left and why.

**2. Record the result and branch.**

Write the four post-void numbers, the negative control, and a one-line verdict into the EXECUTE
report **before writing any code**.

- **Reproduces** → continue to step 3.
- **Does not reproduce** → **D10 drops out entirely.** Steps 3–9 are cancelled. Record the
  disproof with the exact queries and numbers, mark AC-7.2/7.3/7.4 as `NOT APPLICABLE — premise
  disproved live`, and go straight to step 10. AC-7.5 (the doc) is still worth doing and should
  then describe the behaviour as it actually is. Do not build a fix for a defect that did not
  reproduce — SPEC constraint 12.

### Phase B — extract the reversal (steps 3–4)

**3. Lift the reversal out of `voidPeriod`.** New file
`src/lib/server/services/payroll/amortization.ts`:

- Export `reverseAmortization(tx: Prisma.TransactionClient, runId: string): Promise<void>`.
- Its body is `periods.ts:314-370` — the `findMany` of entries with deductions, and the loop —
  **moved verbatim**. Do not change the loan branch. Do not change the cash-advance branch. Do
  not "tidy" the decimal handling.
- Move the existing comments with it (the `#119` decimal note and the "reverse what was actually
  applied" note). They explain non-obvious code and must not be lost in the move.
- **Add one new doc comment** naming the known bug, in the shape of this repo's landmine
  comments: the cash-advance arm credits back the frozen `d.amount` while lock applied
  `min(d.amount, liveBalance)` and forced `status: 'ACTIVE'` unconditionally, so a capped payment
  over-credits and a separately-settled advance can be resurrected. State that the loan arm is a
  true inverse because `loan_payments` exists and the cash advance has no ledger; that fixing it
  needs a cash-advance payment ledger; and that it is **pre-existing, out of scope for #298, and
  recorded for the owner**.

**4. Point `voidPeriod` at it.** `periods.ts` — replace the lifted block with
`await reverseAmortization(tx, run.id)` inside the existing `if (run && wasLocked)`. The
`$transaction`, the guard at `:307`, the already-voided refusal at `:310`, the `wasLocked`
computation and the two `tx.…update` calls that follow all stay exactly where they are.

**Gate before step 5:** `pnpm test` green **and** `pnpm test:e2e -- payroll-lock-idempotency`
run once. That spec exercises the real lock→void balance cycle and is the only thing that proves
the extraction changed no behaviour. If e2e is too flaky to land (#287), record that and re-run
the step-1 probe queries instead as a manual substitute — but do not skip the check entirely.

### Phase C — fix `voidRun` (steps 5–8)

**5. Give the void route a try/catch.** `src/routes/api/v1/payroll/[id]/+server.ts:66-79`. The
approve branch above it already wraps its service call and maps `400/403/404` to `apiError`
(`:57-63`). The void branch does not. Add the same wrapper, with the message
`'Cannot void this run'`. Do this **before** step 7 introduces the `400`, so the refusal never
exists without a handler.

**6. Add the status precondition.** `runs.ts`, immediately after the 404:

```ts
if (run.status === 'VOIDED') error(400, 'Payroll run is already voided')
```

Only `VOIDED`. See Design Note 5. Add a one-line comment saying DRAFT and APPROVED voids stay
allowed deliberately, because SPEC AC-7.4 forbids blocking anybody who can act today.

**7. Fetch the period.** `runs.ts:95` — change the `findFirst` to
`{ where: { id, organizationId }, include: { period: true } }`, and compute
`const wasLocked = run.period.status === 'LOCKED' || run.period.status === 'RELEASED'`.
Use the same two statuses as `periods.ts:312` — not a different list.

**8. Reverse, transactionally.** Replace the bare `db.payrollRun.update` with:

```ts
const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
  if (wasLocked) await reverseAmortization(tx, id)
  return tx.payrollRun.update({ where: { id }, data: { status: 'VOIDED' } })
})
```

Leave the `writeAuditLog` call **outside** the transaction, where it is today — `voidPeriod`
does the same and moving it is a behaviour change. Do not touch the `action:`/`newValue:` of
that call: `payroll-void-audit-298` owns it and will have already set `PAYROLL_VOID` and the
same-actor marker.

**Note the period is deliberately left alone.** A run void still does not unlock the period.
Making it do so is a bigger, undecided behaviour change and is out of scope below.

### Phase D — the documentation (step 9)

**9. Write `docs/payroll-void-semantics.md`.** AC-7.5. Short, table-first, ~40 lines. It must
state, for a reader who has never opened these files:

- **What a run void does**: refuses an already-voided run; reverses loan and cash-advance
  amortization *when the period was locked or released*; flips the run to `VOIDED`; leaves the
  **period status untouched**; is reachable **only** via `POST /api/v1/payroll/[id]?action=void`,
  with no UI button.
- **What a period void does**: refuses an already-voided period; reverses the same amortization
  on the same condition; flips **both** the run and the period to `VOIDED`.
- **What neither does**: no backfill, no un-void, no notification, no re-generation of payslips.
- **The single remaining difference**: the period status. Say plainly that voiding a run leaves
  the period `LOCKED`, so the period must be voided separately if the intent was to reopen it.
- **The known cash-advance over-credit**, cross-referencing the comment in `amortization.ts`.
- The `OVERRIDE_FINALIZED` requirement and that `SUPER_ADMIN` is its only holder today.

Add a one-line pointer comment to this file above both `voidRun` and `voidPeriod`.

### Phase E — D11, the sweep (steps 10–11)

**10. The enumeration below IS the deliverable for AC-8.1 and AC-8.3.** It is already written.
EXECUTE's only job is to **re-run the greps and confirm it still holds** before the report is
written, because the two sibling plans are editing the same area concurrently:

```bash
grep -nE "(approved|reviewed|verified|processed|confirmed|decided|cleared|finalized|changed|completed|awarded|uploaded|submitted|posted|proposed)By(Id)? +String" prisma/schema.prisma
grep -rn "approvedById:" src/ scripts/
```

If either grep returns a site not in the table below, the sweep is **not** clean and this step
becomes a real finding — record it and stop for the owner. If they match, copy the table into
the report verbatim and state "swept, clean" as the recorded result.

**11. Build the AC-8.2 regression fence.** The sweep found nothing to fix, so there is no fix to
test. What is missing is a test that would **notice if D2's fix were reverted**. Add to
`tests/unit/void-run-semantics.test.ts` (or to `payroll-period-actors.test.ts` if the sibling
plan created it first — check before duplicating):

> `lock-writes-no-approver` — call `lock()` real against the mocked db and assert that **no**
> `tx.payrollRun.update` call carries an `approvedById` or `approvedAt` key. Assert on the
> **absence of the key** (`expect(data).not.toHaveProperty('approvedById')`), not on its value.

I checked the suite: **no test today asserts anything about the lock-path `approvedById`**, so
D2 breaks no existing expectation and nothing would go red if D2 were later reverted. That is
the gap this fence closes. If the sibling plan already added an equivalent assertion, say so and
skip — do not write a second copy.

### Phase F — D12, the payslip PAYDATE record (step 12)

**12. Capture the before/after sample and write the Finance note.** AC-10.1, AC-10.2, AC-10.3.

This is a **document sample, not a code assertion.** The chain is `payslip-document.ts:282`
(`payDate: run.approvedAt ? shortDate(run.approvedAt) : shortDate(run.periodEnd)`) →
`payslip-pdf.ts:156` (`labelValue(doc, 'PAYDATE:', …)`). **No Svelte component renders
`approvedAt` at all** — the PDF is the only render, which is exactly why a code-path assertion
would not satisfy AC-10.1.

- **12a. Before.** On a tree **without** D2 step 8: create period `ZZ-D12-PROBE`, generate, and
  **lock it without ever approving the run through the #134 chain**. Download the payslip PDF
  for one entry. Record the literal `PAYDATE:` string. It will be the **lock date**.
- **12b. After.** With D2 step 8 applied, repeat on a fresh `ZZ-D12-PROBE-2`. Record the literal
  `PAYDATE:` string. It will be the **period end date**.
- **12c. The control (AC-10.2).** On the same "after" tree, run a period whose run **was**
  approved through the real approve path, and confirm its `PAYDATE:` is the **approval date**,
  unchanged from before. Without this, 12b could equally mean "PAYDATE is broken for everyone".
- **12d.** Paste both literal strings, the two period names and the control result into the
  EXECUTE report. Attach or transcribe the PDF field — do not paraphrase it.
- **12e (AC-10.3).** Write a short hand-off note to the owner, in the report and in the closeout
  message, in plain words: *"On payslips for a payroll that was locked but never formally
  approved, the printed PAYDATE changes from the lock date to the period end date. Approved
  payrolls are unaffected. Please tell Finance before this ships."* This is due **before** the
  change ships, not after.

---

## Explicitly OUT OF SCOPE

| Item | One-line reason |
|---|---|
| **D9 / final-pay arithmetic / AC-6.x** | Premise disproved; the owner is deciding its fate separately. See the placeholder above. |
| Fixing the cash-advance over-credit in the reversal | Pre-existing, needs a new payment ledger and a backfill decision the owner has not been asked. Named in the code comment (step 3) and reported. |
| Making a run void also unlock or void the period | A bigger, undecided behaviour change. The doc (step 9) states the difference instead. |
| A DRAFT or APPROVED status refusal on `voidRun` | Would newly block somebody who can act today — fails AC-7.4. |
| Any change to `voidPeriod`'s observable behaviour | Step 3/4 is a pure extraction. |
| `separation.ts` and everything in #297 | Owned by a parallel agent. |
| The D1/D2 edits — `PAYROLL_VOID`, `lockedById`, `releasedById`, removing the `lock()` approver write | Owned by `payroll-void-audit-298_PLAN_17-08-26.md`. |
| Touching `JobPosting.approvedById` | Different model, single writer, unambiguous. See the sweep. |
| Backfilling or retro-fixing any historical void | SPEC out-of-scope 12. |
| Filing any GitHub issue | SPEC constraint 11 — the 18-08-26 approval covered #304–#308 only. |

---

## AC-8.1 / AC-8.3 — the "who approved" enumeration (the permanent record)

**Verdict: SWEPT, CLEAN.** 22 actor-attribution fields across 19 models. **Exactly one is
ambiguous — `PayrollRun.approvedById` — and D2 already fixes it.** No other site needs a change,
and that clean result is itself the deliverable (AC-8.3).

> *Bookkeeping note:* the research sweep reported 23 fields. Reproduced independently here as 22
> schema scalars — the delta is one row of bookkeeping, not a missing site, and does not change
> the verdict. If EXECUTE's step-10 grep finds a 23rd scalar, add it; do not silently drop it.

| # | Model . field | Writer(s) | Verdict |
|---|---|---|---|
| 1 | `EmployeeCompensation.changedById` | `employees.ts:541,552` (`'system'` sentinel), `:833/:848` (param) | **Correct** — one meaning: who changed it. Note the literal `'system'` sentinel; it is a documented shape here, not an ambiguity. |
| 2 | `EmployeeEmploymentType.changedById` | `employees.ts` (same helper pair) | **Correct** |
| 3 | `Timesheet.reviewedById` | `timesheets.ts:348`, `:401` | **Correct** — both writes mean "the reviewer"; `:401` is conditional on `settled`. |
| 4 | `OnboardingCompletion.completedById` | `onboarding.ts:414` | **Correct** — single writer |
| 5 | `Award.awardedById` | `awards.ts:32` | **Correct** — single writer |
| 6 | `LeaveRequest.reviewedById` (+ `reviewedAt`) | **none** | **Out of scope — dead columns.** Zero writers anywhere. Not ambiguous; unused. Do not "fix". |
| 7 | `RequestDocument.verifiedById` | `requests/documents.ts:186` | **Correct** — single writer, one meaning |
| 8 | `EmployeeDocument.uploadedById` | `documents.ts:74` | **Correct** — single writer |
| 9 | `SeparationRecord.finalizedById` | `separation.ts:247` | **Correct** — single writer. #297's territory; do not touch. |
| 10 | `ClearanceItem.clearedById` | `separation.ts:135` | **Correct** — single writer (nulled on un-clear). #297's territory. |
| 11 | **`PayrollRun.approvedById`** | `approvals.ts:673` (the approver), `payroll/index.ts:508` (the approver), **`periods.ts:252` inside `lock()` (whoever locked)** | **AMBIGUOUS — the only one.** Three writers, two meanings. **Fixed by D2 step 8**, which removes the `lock()` write. Nothing further is needed here. |
| 12 | `JobPosting.submittedById` | `recruitment.ts:81` | **Correct** — single writer |
| 13 | `JobPosting.approvedById` | `recruitment.ts:174` | **Out of scope — explicitly.** Different model, single writer, unambiguous. Named out of scope by SPEC AC-8.1 itself. |
| 14 | `JobPostingChannel.postedById` | `job-boards.ts:227,233` | **Correct** — both mean "who posted it" |
| 15 | `ApplicantStageHistory.changedById` | `recruitment.ts:285,354,423,462` | **Correct** — four writers, all "who moved the applicant" |
| 16 | `StatutoryRateProposal.proposedById` | `payroll/statutory-rates.ts:337` | **Correct** — single writer |
| 17 | `StatutoryRateProposal.decidedById` | `statutory-rates.ts:363` (apply), `:412` (reject) | **Correct** — two writers, one meaning: the decider. Apply/reject are both decisions. |
| 18 | `ActionProposal.decidedById` | `action-proposals.ts:212` (apply), `:257` (reject) | **Correct** — same shape as 17 |
| 19 | `ActionProposal.initiatorId` | `action-proposals.ts` (create path) | **Correct** — distinct field for a distinct actor. This is the *right* pattern: proposer and decider have separate columns. |
| 20 | `ApprovalStep.actorId` | approvals chain (#134) | **Correct** — the per-step actor, one meaning |
| 21 | `PostingApprover.approverId` | recruitment config | **Correct** — configuration, not an event record |
| 22 | `AuditLog.actorId` | `audit.ts` — the audit mechanism itself | **Out of scope** — this is the mechanism that records everything else, not a domain field. |

### The structural cause, recorded because it explains the whole bug

**`PayrollPeriod` has `lockedAt` (schema `:1613`) and `releasedAt` (`:1614`) with no actor
column at all.** It is the **only timestamp-without-actor pair in the schema** — every other
`*At` above sits beside its `*ById`. `lock()` borrowed the neighbouring model's field because it
had nowhere else to write the actor. D2 closes this by adding `lockedById` / `releasedById`.

**The design rule this yields, worth keeping:** an actor field is ambiguous when two *different
roles* write it, not when two *code paths* do. Rows 17 and 18 have two writers each and are
fine, because apply and reject are both "the decider". Row 11 was broken because "approver" and
"locker" are different people doing different jobs. Row 19 shows the correct fix shape: a second
column, which is exactly what D2 does.

---

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `void-run-divergence-live-probe` — step 1's four post-void numbers plus the period-void negative control, **recorded either way** | Agent-Probe | **AC-7.1 (gate)** |
| `void-run-reverses-amortization` — live-seeded loan, real lock via the real route, real run void via curl; loan balance returns to principal and the `loan_payments` row is deleted | Hybrid (new e2e spec + step-1 psql re-run) | AC-7.2 |
| `void-run-skips-reversal-on-unlocked-period` — a run on a `GENERATED` period is voided; balances **do not** move | Fully-Automated | AC-7.2 (the negative half) |
| `void-run-status-precondition` — voiding an already-`VOIDED` run rejects with `status: 400` and a message naming "already voided" | Fully-Automated | AC-7.3 |
| `void-run-capability-unchanged` — `tests/unit/override-finalized-guard.test.ts` stays green **with zero edits** | Fully-Automated | AC-7.4 |
| `void-run-allows-draft-and-approved` — a `COMPUTED` and an `APPROVED` run both still void successfully | Fully-Automated | AC-7.4 |
| `void-period-unchanged-after-extract` — `pnpm test:e2e -- payroll-lock-idempotency` still passes after step 4 | Hybrid | AC-7.2 (no-regression) |
| `void-semantics-documented` — `docs/payroll-void-semantics.md` exists and names, for both voids: the status precondition, what is reversed, what the period status ends as, and how each is reached | Fully-Automated (file + content grep) | AC-7.5 |
| **The enumeration table above**, re-confirmed by step 10's two greps | Fully-Automated | **AC-8.1, AC-8.3** |
| `lock-writes-no-approver` — `lock()`'s `payrollRun.update` data has **no** `approvedById` key (`not.toHaveProperty`, not `toBe(null)`) | Fully-Automated | AC-8.2 |
| `payslip-paydate-before-after` — the literal `PAYDATE:` string from a real rendered PDF, before and after, on a locked-but-never-approved run | Agent-Probe | AC-10.1 |
| `payslip-paydate-unchanged-when-approved` — the step-12c control: an approved run's `PAYDATE:` does not move | Hybrid | AC-10.2 |
| The Finance hand-off note, written in the report **and** the closeout | Agent-Probe | AC-10.3 |
| `guard-mutation-check` — the mutation table below, **run and its results recorded** | Fully-Automated | AC-5.3 |

### Test files

- **`tests/unit/void-run-semantics.test.ts` — NEW.** Clone the mock setup from
  `tests/unit/override-finalized-guard.test.ts:28-65`, which already runs `voidRun` **real**
  against a mocked `$lib/server/db`. That file is the working template and needs almost no new
  infrastructure. Mock `$lib/server/audit` (`writeAuditLog` as a spy) and
  `payroll/amortization` (`reverseAmortization` as a spy) so the assertions are
  *"was the reversal called / not called"* — which is cheap here and catchable.
- **`tests/e2e/payroll-void-run-amortization.spec.ts` — NEW.** Clone
  `tests/e2e/payroll-lock-idempotency.spec.ts` wholesale. Its `seed()` already creates a live
  `ACTIVE` loan, a period, a run and drives the real lock route with a real `PrismaClient`.
  Change: `TAG = 'e2e-void-d10'`, and after the lock, `POST /api/v1/payroll/[runId]?action=void`
  instead of a second lock. Assert positively: `loan.balance` equals the original principal
  **as a number you name**, and `loan_payments` for that entry is **0 rows**. "Balance is not
  reduced" proves nothing — assert the exact figure.

**Do not modify `tests/unit/override-finalized-guard.test.ts` or
`tests/e2e/payroll-lock-idempotency.spec.ts`.** Their value is that they stay green untouched.

---

## Mutation checks (AC-5.3 — must be RUN, not just intended)

Each row: break it on purpose, run `pnpm test`, confirm the named test goes **red**, then revert.
Record the **actual** result of every row in the EXECUTE report. An unrun mutation table is a
hypothesis, not evidence — this repo has shipped five false greens off a mocked db.

| # | Break this | Must go red |
|---|---|---|
| M1 | Delete the `if (run.status === 'VOIDED')` refusal in `voidRun` | `void-run-status-precondition` |
| M2 | Widen it to also refuse `DRAFT` | `void-run-allows-draft-and-approved` |
| M3 | Delete the `await reverseAmortization(tx, id)` call in `voidRun` | `void-run-reverses-amortization` (unit spy half) |
| M4 | Drop the `wasLocked` condition so the reversal runs unconditionally | `void-run-skips-reversal-on-unlocked-period` |
| M5 | Change `wasLocked` to `LOCKED` only, dropping `RELEASED` | `void-run-reverses-amortization` — **add a `RELEASED`-period case to the unit test specifically so this row is catchable** |
| M6 | Move the `payrollRun.update` out of the `$transaction`, leaving the reversal inside | **Expected: nothing goes red.** The unit suite mocks `$transaction` and cannot see atomicity. Record "no test caught it — by design" and note that only a crash-injection test would, which is out of scope. |
| M7 | Put `approvedById: ctx.actorId` back into `lock()` | `lock-writes-no-approver` |
| M8 | In `lock-writes-no-approver`, change the assertion to `toBe(null)` instead of `not.toHaveProperty` | Should **still** pass with the key absent — which is the point: it proves the weaker assertion is weaker. Record the observation; revert. |
| M9 | Delete `docs/payroll-void-semantics.md` | `void-semantics-documented` |

M6 is the honest finding this repo's history demands: one of the changes is **not unit-provable
at all**. That is why step 1's live probe and the e2e spec are mandatory, not optional.

---

## Live verification (mandatory — not optional)

The unit suite mocks the database, so it cannot prove: **(a)** that a run void actually moves a
loan balance in Postgres, **(b)** that the reversal is transactional, or **(c)** what a payslip
PDF literally prints.

**Harness.** The **user starts the dev server themselves — the agent never starts it, and never
starts the database.** Cookie + psql, exactly as in step 1. Table names are snake_case
(`payroll_periods`, `payroll_runs`, `payroll_entries`, `loans`, `loan_payments`, `cash_advances`,
`audit_logs`, `users`); **column names are camelCase and must be double-quoted** — every `@map`
in this schema is table-level, there are zero field-level ones.

**Plant a marker.** Every probe period is named `ZZ-D10-PROBE`, `ZZ-D10-PROBE-2`,
`ZZ-D12-PROBE`, `ZZ-D12-PROBE-2`. Find every row by that name. Never assert "the row is absent"
— assert a positive value you can name in advance.

| # | Step | Assert |
|---|---|---|
| **L1** | Step 1's probe, **before the change** | The four post-void numbers. This is AC-7.1 and gates everything. |
| **L2** | The same probe, **after** steps 5–8 | `loans.balance` back at the **exact principal** you seeded; `select count(*) from loan_payments where "loanId"=…` → **0**; `payroll_runs.status` → `VOIDED`; `payroll_periods.status` → still **`LOCKED`** (deliberately — say so in the report). |
| **L3** | Void the **same run twice** via curl after the change | Second call returns HTTP **400** with a body naming "already voided". Then confirm the balance did **not** move a second time: `loans.balance` is still the principal, not principal + installment. This is the real risk of AC-7.3 — a double reversal double-credits. |
| **L4** | Void a run whose period is still `GENERATED` | HTTP 200, `payroll_runs.status` = `VOIDED`, and `loans.balance` **unchanged from before the call** (record both numbers). Nothing was ever applied, so nothing may be credited. |
| **L5** | Void a run on a **`RELEASED`** period | Balance returns to principal. This is the `wasLocked` second arm (M5) and no other step covers it. |
| **L6** | Step 12a/12b/12c — the payslip PDFs | Three literal `PAYDATE:` strings recorded: locked-never-approved **before** (= lock date), the same **after** (= period end date), and an **approved** run after (= approval date, unmoved). Transcribe the literal strings; do not paraphrase. |

**Negative controls that must appear on BOTH sides of the change:** L4 (an unlocked period must
never credit, before or after) and L6's approved-run control (its PAYDATE must be identical
before and after).

**Cleanup:** delete every `ZZ-` period and its runs, entries, deductions, loan payments and
seeded loans, or state in the report that they were left and why.

---

## Test Infra Improvement Notes

- **There is no unit test anywhere for `voidPeriod`'s reversal arithmetic.** `voidPeriod` is
  mocked at the route level in `override-finalized-guard.test.ts` and pulled in real only to pin
  the capability guard — nothing exercises the loan or cash-advance math. Step 3's extraction
  into `amortization.ts` makes such a test cheap for the first time (a pure function taking a
  `tx`). **Not built in this plan** — it is a new test surface for existing untested behaviour,
  outside this blast radius. Recorded so it is not lost.
- **The cash-advance over-credit has no test and cannot get one** until a cash-advance payment
  ledger exists. Recorded as a follow-up for the owner, not built, no issue filed.
- **`pnpm test:e2e` is flaky (#287).** Steps 4 and the new e2e spec both depend on it. If it
  cannot be landed green, the step-1 psql script is the manual substitute — but the substitution
  must be recorded, not silent.
- **`pnpm check` does not cover `prisma/**` or `scripts/**`.** Nothing in this plan lands in
  either directory, so this is a note, not a gate.
- The `_dev/login-as` curl harness is the only way to reach `voidRun` at all. It is worth a line
  in the test context docs — a whole service function with no UI path is easy to forget exists.

---

## Commands (exact)

```bash
pnpm prisma generate            # ALWAYS before believing a red check
pnpm format:check
pnpm lint
pnpm check
pnpm test                       # vitest run — there is no test:unit script
pnpm test -- void-run-semantics override-finalized-guard
pnpm test:e2e -- payroll-lock-idempotency
pnpm test:e2e -- payroll-void-run-amortization
```

No `pnpm db:push` — this plan makes no schema change.

---

## Risks

| Risk | Mitigation |
|---|---|
| **A double void double-credits a balance** — the worst outcome here, and the reason AC-7.3 exists | L3 asserts the second call is refused **and** that the balance did not move twice |
| The step-3 extraction silently changes `voidPeriod` behaviour | The block is moved verbatim; the existing lock-idempotency e2e spec is the gate before step 5 |
| A run on an unlocked period is credited money it never paid | Design Note 4 + the `void-run-skips-reversal-on-unlocked-period` test + L4 + mutation M4 |
| The cash-advance over-credit spreads from one void path to two | Named explicitly, commented in the code, reported to the owner; not silently inherited |
| A crash mid-reversal leaves a half-credited void | The `$transaction` in Design Note 3 — but M6 pre-declares this as unit-unprovable |
| Editing `voidRun` collides with the sibling #298 plan | Dependencies section: steps 5–8 land after that plan's steps 9–11, never in parallel |
| Building a D10 fix for a defect that never reproduced | Step 2 is a hard branch; SPEC constraint 12 |
| Vacuous mock green (this repo's #1 historical false-green) | The mutation table is mandatory and its **results** must be recorded; M6 and M8 are pre-declared as uncatchable |
| Finance sees a changed PAYDATE without warning | Step 12e, due **before** ship |

---

## Acceptance Criteria (done means)

1. **Step 1 run and its result recorded, before any code was written.** If it did not reproduce,
   steps 3–9 are correctly **absent** from the diff.
2. All applicable steps applied, in order.
3. `pnpm format:check`, `pnpm lint`, `pnpm check`, `pnpm test` all green.
4. `tests/unit/override-finalized-guard.test.ts` and
   `tests/e2e/payroll-lock-idempotency.spec.ts` green **with zero edits**.
5. Every mutation row M1–M9 **run**, with its actual result recorded (including M6's and M8's
   "nothing went red — by design").
6. L1–L6 run live, with the negative controls on both sides.
7. The D11 enumeration re-confirmed by step 10's greps and copied into the report with the
   verdict "swept, clean" — or the discrepancy escalated.
8. The three literal `PAYDATE:` strings recorded, and the Finance hand-off note written.
9. No new 403 anywhere. Exactly **one** new 400, on an already-voided run only.
10. `separation.ts` untouched — confirm with `git diff --name-only`.
11. `prisma/schema.prisma` untouched — confirm the same way.
12. Nothing committed without explicit owner approval; **no `Co-Authored-By` trailer**; merges go
    to `staging`, so `Closes #298` never fires — the issue is closed by hand. **Do not file any
    GitHub issue** (SPEC constraint 11).

---

## Phase Completion Rules

This plan is a single phase. It is `CODE DONE` when the applicable steps are applied and the four
automated gates are green. It is only `VERIFIED` when, in addition:

- **step 1's live probe has a recorded result** (AC-7.1 is a gate, not a test — an unrun probe
  means D10 is not started, let alone done),
- every mutation row M1–M9 has been **run** with its actual result recorded, and
- L1–L6 have been run live with the negative controls on both sides.

Code-only completion is `CODE DONE`, never `VERIFIED`. A green unit suite alone does not promote
this plan: M6 is pre-declared as uncatchable by the unit suite, and AC-7.1, AC-10.1 and AC-10.3
have no automated form at all.

## Resume and Execution Handoff

1. **Selected plan file:**
   `process/general-plans/active/void-semantics-and-sweep_PLAN_18-08-26.md`
2. **Last completed step:** PLAN written. No code written. Nothing committed. Branch
   `feat/separation-of-duties-298-297`.
3. **Validate-contract status:** pending — VALIDATE has not run against this file.
4. **Context loaded:** the locked SPEC `separation-of-duties-298-297_SPEC_17-08-26.md`, both
   sibling plans (read-only), `runs.ts`, `periods.ts`, `prisma/schema.prisma`,
   `api/v1/payroll/[id]/+server.ts`, `tests/unit/override-finalized-guard.test.ts`,
   `tests/e2e/payroll-lock-idempotency.spec.ts`.
5. **Next step for a fresh agent:** run VALIDATE against this file. Then **step 1 — the live
   probe — first, and nothing else.** It needs no sibling plan, no code change, and it decides
   whether steps 3–9 exist at all. Do not start at step 6. Before touching `runs.ts`, confirm
   with `git log --oneline` and `git diff` that `payroll-void-audit-298`'s steps 9–11 have
   already landed, or you will collide with the parallel agent in the same function body.
6. **If context was compacted mid-run:** the single most important thing to re-read is the
   "recorded result" line for step 1 in the EXECUTE report. If it is not there, D10 has not
   started.

## Validate Contract

(placeholder — vc-validate-agent writes this section before EXECUTE)
