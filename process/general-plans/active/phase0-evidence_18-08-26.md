---
name: evidence:phase0-298-297
description: "Phase 0 live captures for #298/#297 — the AC-7.1 D10 gate result and the AC-10.1 PAYDATE before-sample, both taken before lock() was touched"
date: 18-08-26
feature: general-plans
spec: process/general-plans/active/separation-of-duties-298-297_SPEC_17-08-26.md
---

# Phase 0 evidence — taken 18-08-26, at `73fd0fd`

Two captures that could only be taken **before** #298 changes what `lock()` writes.
Both are recorded results, not intentions.

---

## AC-7.1 — the D10 gate: **REPRODUCES**

**Steps 3–8 of `void-semantics-and-sweep_PLAN_18-08-26.md` are LIVE, not cancelled.**

Until now the D10 divergence was confirmed by reading the code and had never been run.
It has now been run, through the real service path over HTTP, with a negative control.

Harness: `scripts/probe-d10-void-divergence.ts` (seed / report / cleanup). Lock and void
happen over HTTP between `seed` and `report`, so the real `lock()` and `voidRun()` execute —
the script never re-implements them.

**Why the probe seeds rather than using import → generate.** The first attempt went through
the normal flow and proved nothing: the seeded employees have no attendance, so every entry
lands fully absent, net pay goes negative (an `UNRECOVERED` line of -148,092.50 across 34
entries), and **no amortization line is ever scheduled**. Balances did not move at lock, so
there was nothing for the void to fail to reverse. That is an INCONCLUSIVE probe, not a
passing one, and it must not be read as "the divergence does not reproduce". The e2e spec
`tests/e2e/payroll-lock-idempotency.spec.ts` seeds directly for exactly this reason.

### The result

Same seed, same lock, two different voids:

| | after lock | **void the RUN** | **void the PERIOD** (control) |
|---|---|---|---|
| `payroll_periods.status` | LOCKED | **LOCKED** | VOIDED |
| `payroll_runs.status` | COMPUTED | VOIDED | VOIDED |
| `loans.balance` | 750 | **750** | 1000 |
| `loan_payments` rows | 1 | **1** | 0 |
| `cash_advances.balance` | 500 | **500** | 800 |

Loan principal 1000 / installment 250. Cash advance 800 / installment 300.

**Voiding a run leaves ₱250 of loan and ₱300 of cash advance deducted from an employee for a
payroll that no longer exists, against a period that still reads LOCKED — so nothing on screen
says the payroll is dead.** Voiding the period reverses all of it. Both voids need the same
capability and the same person can do either.

The control is what makes this a finding rather than an observation: the reversal logic exists
and works. It is simply never reached by the run path.

### One more thing the probe settled

**A run void has no UI button.** It is API-only — `POST /api/v1/payroll/[id]?action=void`.
Every step in any plan that says "click void" on a *run* is wrong; the period void is the one
with a button.

---

## AC-10.1 — the PAYDATE before-sample: **CAPTURED**

This was the one-way window. Once #298 step 8 stops `lock()` writing `approvedAt`, this sample
becomes unrecoverable.

Period `ZZ-D12-PROBE`, 2026-08-01 → 2026-08-15. Opened, imported, generated, **locked, and
never approved**, then released so the payslip renders.

```
period.status = RELEASED      run.status = COMPUTED   ← never approved
run.approvedById = admin@veent.ph's user id
run.approvedAt   = 2026-08-18 02:11:17     ← this is the LOCK time
```

That row is the D2 ambiguity caught in the act: the run was never approved, yet it carries an
`approvedById` and an `approvedAt`, because `lock()` wrote them.

**Rendered payslip PDF, 3,927 bytes:**

```
PAYDATE:

8/18/26
```

**8/18/26 is the lock date.** After #298, `approvedAt` will be null for this run, so
`payslip-document.ts:282` falls through to the period end and the same payslip will print
**8/15/26**.

The PDF is at `phase0-evidence/d12-payslip-BEFORE.pdf` in the session scratchpad. Re-take the
after-sample on an identically shaped period once #298 lands (AC-10.2 also needs an *approved*
run to show its PAYDATE does **not** move).

**AC-10.3 is still outstanding**: Finance has not yet been told the printed date moves on
locked-but-never-approved payslips. That is due before the change ships.

---

## Housekeeping

All probe data removed: 0 `ZZ-%` periods remain, and the seeded loans and cash advances are
back at their original balances. The `#297` live pass earlier the same day was cleaned up
separately — 0 separation records, both HR logins re-activated, no employee left offboarded.
