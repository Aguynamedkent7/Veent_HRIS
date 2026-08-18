# Draft note for Finance — one date on some payslips is changing

**Status: DRAFT, not sent.** Sending it is your call. It is due **before** this ships, not after.

Everything below the line is the message itself — edit the tone or trim it as you like, then send
it however you normally reach Finance. The background section after it is for you, not for them.

---

## The message

> **Heads-up: one date on some payslips will change.**
>
> **What changes.** On a payslip for a payroll that was **locked but never formally approved**, the
> `PAYDATE:` line currently shows the date somebody locked the payroll. After this update it shows
> the **last day of the pay period** instead.
>
> **A real example from our test system.** The same payslip, for the 1–15 August period:
>
> | | `PAYDATE:` shows | which is |
> |---|---|---|
> | Before | `8/18/26` | the day it was locked |
> | After | `8/15/26` | the last day of the pay period |
>
> **What does NOT change.**
>
> - Payslips for payrolls that **were** approved are untouched.
> - **No amount changes anywhere** — not gross, not deductions, not net pay.
> - Nothing is recalculated, and **no payslip already issued is altered**. This only affects how
>   the date is worked out from now on.
>
> **Why we are doing it.** That date field was being filled in by two different steps, so it meant
> two different things depending on how the payroll was processed. It now means one thing. The same
> fix is what lets us record who locked and who released a payroll — something we could not tell
> apart before.
>
> **What we need from you.** Please tell us if any external filing, remittance, or report keys off
> that date for payrolls that were never approved. If it does, say so before this goes live.

---

## Background — for you, not for Finance

**Why this note exists at all.** The change that causes it (D2) was supposed to be record-only:
start recording who locked and who released a payroll period, and make the "who approved" record
mean one thing. It has exactly one user-visible side effect, and this is it.

**Why it was nearly missed.** No Svelte component renders `approvedAt` anywhere. The PDF is the
only thing that displays it, so searching the UI components would have turned up nothing. The chain
is `payslip-document.ts:282` → `payslip-pdf.ts:156`.

**The mechanism.** `payslip-document.ts:282` reads:

```ts
payDate: run.approvedAt ? shortDate(run.approvedAt) : shortDate(run.periodEnd)
```

Before this work, `lock()` wrote `approvedAt` even though locking is not approving — so a
locked-but-never-approved run had an `approvedAt` (the lock time) and printed it. Now `lock()` no
longer writes it, that run has a null `approvedAt`, and the expression falls through to the period
end date.

**The evidence is real, not predicted.** Both figures in the table come from actual rendered PDFs
captured on either side of the change — see `process/general-plans/active/phase0-evidence_18-08-26.md`,
sections AC-10.1 and AC-10.2. The before-sample had to be taken *before* the code changed, because
once `lock()` stopped writing `approvedAt` the old value was unrecoverable.

**Who decided this.** You did, on 18-08-26, as decision D12 in
`separation-of-duties-298-297_SPEC_17-08-26.md`: accept the change because the new value is the
more correct one, verify it live on both sides, and tell Finance before it ships. The first two are
done. This note is the third.

**Related acceptance criteria.** AC-10.1 (before-sample), AC-10.2 (after-sample, plus proof an
*approved* run's date does not move), AC-10.3 (this note).
