---
name: plan:flexible-periods-163
description: "Custom same-month date ranges for payroll runs, payroll periods and Save-as-timesheet: day-count proration, overlap guards, and a fourth picker segment (#163)"
date: 20-08-26
feature: flexible-periods
---

# PLAN — Flexible calendar periods (#163)

**Date**: 20-08-26 · **Status**: PLANNED (not started) · **Complexity**: COMPLEX (single plan, single PR) · **Issue**: #163 · **Branch**: `feat/flexible-periods-163`

## Overview

**TL;DR** — Three ordered sections, one PR, one branch (`feat/flexible-periods-163`).
1. **Share math** — `periodShareOf` learns day-count for non-standard ranges; standard shapes stay
   frozen at 0.5 / 0.5 / 1. Guarded by a golden-value snapshot captured BEFORE any edit.
2. **Service layer** — shape gate → sanity gate (`end >= start` + same month), scoped overlap
   guards on PayrollRun and Timesheet, loan installment proration, #173 EE-share answer.
3. **UI** — a fourth `Custom range` segment in `PeriodPicker.svelte`; `/attendance` loses
   `rangeIsStandard`.

Upstream (do not re-litigate): `flexible-periods-163_SPEC_20-08-26.md` (incl. **Decisions Resolved
— round 2**), `research-findings_REF_20-08-26.md`, `design-brief_REF_20-08-26.md`.

Complexity: **COMPLEX** (money-affecting, three layers, 20 acceptance criteria) — but a **single
plan, single PR**. The repo has explicit bad experience with splitting one issue across PRs.

---

## Goals

- A payroll run, a payroll period, and a Save-as-timesheet accept any **same-month** start/end pair.
- Standard shapes (1–15, 16–EOM, 1–EOM) produce **byte-identical** peso output after the change.
- Custom ranges prorate statutory **and** loan/cash-advance installments by `periodDays ÷ daysInMonth`.
- Overlapping ranges are refused with a 409, **without** breaking the supported
  whole-month-adjustment-run-alongside-two-halves workflow.
- The every-15-days cutoff stays the default, never pre-empted by Custom.

## Non-Goals

Cross-month ranges (rejected in v1), per-month statutory split, wiring `firstCutoff`/`secondCutoff`,
the 62-day export cap, the CSV export, the #133 MANAGER attendance reach, 13th-month accrual, YTD.

---

## Context Loaded

- `process/context/all-context.md` — routing entry point; `process/context/tests/all-tests.md` — test routing (vitest unit suite + Playwright e2e against build+preview, per #287).
- Feature folder: `research-findings_REF_20-08-26.md`, `flexible-periods-163_SPEC_20-08-26.md`, `design-brief_REF_20-08-26.md`.
- `CLAUDE.md` — pnpm not npm, no `Co-Authored-By`, Prisma enum traps (not applicable: no schema change), `{@const}` placement.

## Phase Completion Rules

This is one plan with three ordered sections, not a phase program. A section is **CODE DONE** when
its edits are made; it is **VERIFIED** only when its own gate at the end of the section is green.

| Section | CODE DONE when | VERIFIED when |
|---|---|---|
| 1 — Share math | checklist 1–7 applied | golden snapshot green **without** `-u`, plus `pnpm test tests/unit/pay-periods.test.ts tests/unit/payroll-calculator.test.ts tests/unit/payroll-standard-period-golden.test.ts` |
| 2 — Services | checklist 9–19 applied | full `pnpm test` green, incl. the nine new unit files |
| 3 — UI | checklist 21–23 applied | `pnpm test:e2e` green with the two incumbent picker specs **unmodified** |
| Whole plan | checklist 28 | all five gate commands green + manual M1–M8 passed + the criterion-17 backlog stub written |

Section 1 must be VERIFIED before section 2 starts (the sanity gate depends on `isSameMonthRange`).
Section 3 must not start before section 2 is VERIFIED — the `/attendance` unlock without the
timesheet overlap guard double-counts hours in payroll.

## Touchpoints

| File | Role |
|---|---|
| `src/lib/utils/pay-periods.ts` | `periodShareOf` (`:125-130`), new `isSameMonthRange` sanity helper |
| `src/lib/server/services/payroll/index.ts` | `createPayrollRun` gate + overlap (`:78-87`), share/kind (`:222-227`), loan installments (`:314-325`) |
| `src/lib/server/services/payroll/periods.ts` | `openPeriod` gate + overlap (`:48-65`) |
| `src/lib/server/services/timesheets.ts` | `createTimesheet` gate (`:136-140`), duplicate 409 (`:142-145`), new employee-scoped overlap |
| `src/lib/server/services/payroll/calculator.ts` | `resolveEE` (`:141-157`) — #173 Feature-E answer |
| `src/lib/components/ui/PeriodPicker.svelte` | fourth `Custom range` segment + preview share |
| `src/routes/(app)/attendance/+page.svelte` | delete `rangeIsStandard` (`:54-59`, `:396-399`) |
| `scripts/seed-payslip-demo.ts:102`, `tests/unit/timesheet-selfservice.test.ts:203` | drop `allowNonStandardPeriod` |
| `scripts/legacy-nonstandard-runs.ts` (new, throwaway) | pre-flight read-only DB check |

## Public Contracts

- `periodShareOf(start, end)` — **signature narrows**: the `fallback` param is deleted. Only caller
  is `payroll/index.ts:223`; `frequencyShare` (`:222`) is deleted with it. `config.payFrequency`
  stops influencing proration — accepted, it was already dead for standard shapes.
- The three service functions lose their `allowNonStandardPeriod` opt (2 external callers).
- HTTP: new **409** from `createPayrollRun`, `openPeriod`, `createTimesheet` on overlap; new **400**
  on `end < start` and on cross-month. Existing 400/409 texts for standard-shape rejection are
  replaced, not added to.
- `PeriodPicker` hidden-input contract (`:67-68`) is **unchanged** — same field names, same values.
- `#pp-month` id and the three existing button labels are byte-frozen (e2e selectors).
- **No schema change. No migration. No `prisma db push`.**

## Blast Radius

9 source files + 1 throwaway script + 8 test files. Risk class: **money-affecting** (statutory
remittance + take-home pay) and **write-path guard** (new 409s). No schema, no auth, no secrets.
Second-order: a legacy off-cycle **DRAFT/COMPUTED** run recomputes to different numbers after this
change (step 1.0 below finds them). LOCKED/RELEASED runs never recompute, so they are safe.

---

# Section 1 — Share math (pure functions + unit tests)

### 1.0 — Golden-value guard (DO THIS FIRST, BEFORE ANY EDIT)

**Why first:** risk #1 in the SPEC is a standard period silently moving to 15/31. A golden file
captured from post-edit code proves nothing.

1. On a clean tree (`git status` empty), create `tests/unit/payroll-standard-period-golden.test.ts`.
   It calls `computeEmployeeResult` (the pure engine, `calculator.ts`) three times — FIRST_HALF,
   SECOND_HALF, WHOLE_MONTH of **May 2026 (31 days)** and again for **Feb 2026 (28 days)** — with
   `periodShare` taken from `periodShareOf(periodOf(kind, y, m).periodStart, …periodEnd)`, the
   `comp`/`att`/`cfg` fixtures copied from `tests/unit/payroll-calculator.test.ts:13-23`, one loan
   (`installment 1000, balance 3000`) and `statutoryAllocations: { sss: 'FIRST' }` on one case.
2. Assert with `toMatchInlineSnapshot()` on the whole result object (gross, basicPay, every
   `statutory.*`, each deduction line amount, totalDeductions, netPay).
3. Run `pnpm test tests/unit/payroll-standard-period-golden.test.ts -u` **now**, on unmodified
   source, so vitest writes today's pesos into the file.
4. `git add` + commit that file **before touching any source**, commit message
   `test(payroll): golden peso snapshot for the three standard periods (#163)`.

Verified by: the file contains real numbers (not `undefined`), and `pnpm test` is green on an
otherwise-unmodified tree. From here on this test is the tripwire — **it must never be re-run with
`-u`**. Note that rule in a comment at the top of the file.

### 1.1 — Legacy non-standard-run pre-flight

Write `scripts/legacy-nonstandard-runs.ts` (throwaway, read-only): list every `PayrollRun` whose
`status` is `DRAFT` or `COMPUTED` and whose `(periodStart, periodEnd)` is not one of the three
shapes (reuse `isValidStandardPeriod`). Run with
`pnpm dotenv -e .env.dev -- tsx scripts/legacy-nonstandard-runs.ts`.

- Zero rows → note "no legacy exposure" in the PR body and delete the script.
- Any rows → record their ids in the PR body: those runs' numbers **will move** on recompute (they
  currently take the flat 0.5). This is the intended fix, but it must be declared, not discovered.

Verified by: the script's output is pasted into the PR body either way.

### 1.2 — `periodShareOf`: day-count for non-standard ranges

`src/lib/utils/pay-periods.ts:119-130`. Keep the three branches; replace only the final line.

- `if (kind === 'WHOLE_MONTH') return 1` — unchanged.
- `if (kind === 'FIRST_HALF' || kind === 'SECOND_HALF') return 0.5` — unchanged.
- final: `return periodDays(start, end) / daysInMonth(s.getUTCFullYear(), s.getUTCMonth())` using
  `utcMidnight(start)` for `s`. Both helpers are already in this file (`:33`, `:61`).
- Delete the `fallback = 0.5` parameter. Update the doc comment above (`:119-124`) to state the new
  rule and the hard constraint that the three shapes are frozen.
- **Do not** attempt a single-formula simplification: May 1–15 is 15/31 = 0.4839, not 0.5.

Verified by: 1.5 tests + the 1.0 golden snapshot staying green **without** `-u`.

### 1.3 — Same-month sanity helper

Same file, next to `isValidStandardPeriod` (`:113-117`):

```
export function isSameMonthRange(start: Date, end: Date): boolean
```
returns true when `utcMidnight(end) >= utcMidnight(start)` **and** both share year+month. This is
the single replacement for the shape gate at all three service sites. `isValidStandardPeriod` and
`describePeriod` **stay** — labels and the #173 `kind` still need them.

Verified by: 1.5 tests.

### 1.4 — Drop the dead `frequencyShare`

`src/lib/server/services/payroll/index.ts:222-223`: delete the `frequencyShare` const and pass only
two args to `periodShareOf`. Update the comment block at `:217-221` to describe day-count proration
and to keep the note about the supported whole-month adjustment run.

Verified by: `pnpm check` (the removed param is a type error at any missed call site) + `pnpm test`.

### 1.5 — Unit tests, section 1

| File | Change |
|---|---|
| `tests/unit/pay-periods.test.ts:79-96` | Rewrite the `isValidStandardPeriod` "rejects" cases as **classification** cases (still `false` — the function is unchanged), and add a new `describe('isSameMonthRange')`: `2026-05-13 → 2026-05-21` true; `2026-05-21 → 2026-05-13` false; `2026-05-01 → 2026-06-15` false; single day `2026-05-13 → 2026-05-13` true. |
| `tests/unit/pay-periods.test.ts:98-108` | Replace the two `fallback` cases (`:105-106`). New: a **month-length table** — for each of Jan(31)/Feb-2026(28)/Feb-2024(29)/Apr(30), assert `periodShareOf` is exactly `0.5`, `0.5`, `1` for the three shapes (`toBe`, not `toBeCloseTo`). New day-count cases: May 13–21 → `9/31`; a 7-day May range → `7/31`; Feb-2026 1–14 → `14/28` = 0.5 (coincidence, assert anyway); single day → `1/31`. Bounds: every custom same-month share is `> 0` and `<= 1`, and monotonic — extending the end date never lowers the share. |
| `tests/unit/payroll-calculator.test.ts:73-76` | Keep both assertions verbatim (they are the 0.5/1 guard); drop nothing. Add a third: a custom `periodShareOf(utc(2026,4,3), utc(2026,4,9))` is `7/31`. |
| `tests/unit/payroll-standard-period-golden.test.ts` | Created in 1.0. Re-run, no `-u`. |

Gate for section 1: `pnpm test tests/unit/pay-periods.test.ts tests/unit/payroll-calculator.test.ts tests/unit/payroll-standard-period-golden.test.ts` green.

---

# Section 2 — Service gates, overlap guards, EE allocation

### 2.1 — Sanity gate replaces the shape gate (three sites)

Each site: **replace**, never merely delete. `isValidStandardPeriod` is today the only thing
blocking `end < start`; a negative `periodDays` yields a negative share and negative deductions.

| Site | Old | New |
|---|---|---|
| `payroll/index.ts:78-82` | `!opts.allowNonStandardPeriod && !isValidStandardPeriod(...)` → 400 | `if (utcMidnight(periodEnd) < utcMidnight(periodStart)) error(400, 'End date must be on or after the start date.')` then `if (!isSameMonthRange(periodStart, periodEnd)) error(400, 'A custom period must start and end in the same month.')` |
| `payroll/periods.ts:48-54` | same on `input.startDate/endDate` | same two errors |
| `timesheets.ts:136-140` | same on `periodStart/periodEnd` | same two errors |

Message strings are **verbatim from the design brief** so the UI inline copy and the server error
match exactly. Then delete the `allowNonStandardPeriod` field from all three signatures and their
doc comments, and update the two remaining callers: `scripts/seed-payslip-demo.ts:102` (drop the
opts object; if its demo range is cross-month, change the demo dates to a same-month range) and
`tests/unit/timesheet-selfservice.test.ts:203` (drop the opts argument).

Verified by: 2.6 unit tests + `pnpm check` + `pnpm lint` (an unused import of
`isValidStandardPeriod` in `payroll/index.ts:21` / `periods.ts:10` / `timesheets.ts:5` fails lint —
remove them; **keep** the `describePeriod` import in `payroll/index.ts`).

### 2.2 — Scoped overlap guard for PayrollRun

Add to `src/lib/server/services/payroll/index.ts`, exported, above `createPayrollRun`:

```
export async function assertNoOverlappingRun(organizationId, periodStart, periodEnd)
```

- **Fires only when at least one side is non-standard.** If the new range IS standard, first check
  whether any candidate conflict is itself standard; a standard-vs-standard pair is allowed through.
  Concretely: return early when `isValidStandardPeriod(periodStart, periodEnd)` is true **and** the
  fetched conflicts are all standard. This preserves the documented, supported workflow of a
  WHOLE_MONTH adjustment run coexisting with the two halves (`pay-periods.ts:3-4`,
  `payroll/index.ts:218-221`). An unconditional guard would silently delete it.
- Query: `db.payrollRun.findFirst({ where: { organizationId, status: { not: 'VOIDED' }, periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } } })`.
- On a real conflict: `error(409, 'This range overlaps an existing payroll run (' + formatShortDate(hit.periodStart) + ' – ' + formatShortDate(hit.periodEnd) + ').')` — the message names the conflicting range (criterion 10). Reuse `formatShortDate` from `$lib/utils/format`, already imported in `periods.ts`.

Call it:
- `createPayrollRun` — **replace** the `findUnique` 409 at `:84-87`. Identical ranges are a subset
  of intersection, so the exact-duplicate 409 still fires; only its message may change, so keep the
  literal `'Payroll run for this period already exists'` for the exact-duplicate case (criterion 13).
- `openPeriod` — **replace** the `findUnique` 409 at `:56-65`, importing the helper from `./index`
  (`periods.ts:5` already imports `computePayroll` from there). `openPeriod` creates its PayrollRun
  inside its own transaction (`:77-83`), so guarding PayrollRun covers PayrollPeriod too — no
  separate PayrollPeriod query, no schema index.
- **Adjacent ranges must pass**: May 1–10 and May 11–20 do not intersect under `lte`/`gte` on
  inclusive UTC-midnight dates. Assert this (criterion 12).

Verified by: 2.6 unit tests.

### 2.3 — Employee-scoped overlap guard for Timesheet

`src/lib/server/services/timesheets.ts`, immediately before the existing `findUnique` at `:142-145`:
`db.timesheet.findFirst({ where: { employeeId, periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } } })` → `error(409, 'This range overlaps an existing timesheet (…).')`.

- Scope is `employeeId`, not org.
- **Same fire-only-on-non-standard rule** as 2.2, for symmetry and so today's standard-shape
  timesheet behaviour is untouched.
- Keep the existing `@@unique([employeeId, periodStart])` `findUnique` 409 after it — it is the
  same-start-day message (criterion 15) and must stay a plain 409, never a raw Prisma error. The
  attendance action already funnels this through `toFail(e)`
  (`attendance/+page.server.ts:295-296`), so it surfaces as a form error, not a 500.
- **This MUST ship in the same change as the /attendance unlock (3.2).** Payroll sums timesheets by
  containment (`payroll/index.ts:297-310`); two overlapping timesheets double-count hours.

Verified by: 2.6 unit tests + the manual script.

### 2.4 — Loan / cash-advance installment proration

`src/lib/server/services/payroll/index.ts`. After `periodKind` is derived (`:227`), add:

```
// #163: a custom (non-standard) range collects a proportional slice of the flat monthly
// installment; a standard period keeps taking the full installment exactly as today.
const amortShare = periodKind === null ? periodShare : 1
```

Apply at `:314-325` — `installment: q2(D(l.installment).times(amortShare))` for loans and the same
for cash advances. `q2` and `D` are already imported in this file.

Consequence covered by criterion 8: four ~7-day May runs collect `4 × 7/31 ≈ 0.90` of one
installment — under one month's worth.

Verified by: 2.6 unit tests.

### 2.5 — #173 Feature-E EE share for a custom run

`src/lib/server/services/payroll/calculator.ts:141-157`, `resolveEE`. Reorder the guard only:

- **First**: `if (kind === 'WHOLE_MONTH' || kind === undefined) return monthlyEE.times(share)` —
  this is the guard rail. WHOLE_MONTH must stay on the `times(share)` path; `undefined` (the
  preview path, which never supplies a kind) keeps today's behaviour.
- Then `if (mode === 'FIRST') return kind === 'FIRST_HALF' ? monthlyEE : ZERO`.
- Then `if (mode === 'SECOND') return kind === 'SECOND_HALF' ? monthlyEE : ZERO`.
- Fall through: `return monthlyEE.times(share)` — EVEN, untouched.

Net effect: `kind === null` (a custom range) under FIRST or SECOND returns `ZERO`; the designated
cutoff run still takes the whole month, so a month never exceeds 100% of the monthly EE
contribution. ER share and withholding tax keep `× share` — do not touch them. Update the doc
comment at `:139-145` to state the custom-range rule.

Verified by: 2.6 unit tests + the 1.0 golden snapshot (which includes a `sss: 'FIRST'` case).

### 2.6 — Unit tests, section 2

All new files under `tests/unit/`, using the existing hoisted-`vi.mock('$lib/server/db')` pattern
from `tests/unit/timesheet-selfservice.test.ts:16-33`.

| File | Cases |
|---|---|
| `payroll-period-sanity-gate.test.ts` | For each of `createPayrollRun`, `openPeriod`, `createTimesheet`: `end < start` → 400 with the exact copy; cross-month → 400 with the exact copy; a valid custom same-month range → reaches `db.*.create`; the three standard shapes → still reach create. Asserts the mock create was **not** called on each rejection. |
| `payroll-run-overlap-guard.test.ts` | Custom new range vs an existing run: **partial** overlap (May 1–20 vs May 10–31) → 409; **contained** (May 5–10 inside May 1–20) → 409; **identical** → 409; **adjacent** (May 1–10 then May 11–20) → allowed; existing run `status: 'VOIDED'` → allowed; the 409 message contains both conflicting dates. **Plus the coexistence case: 1–15, 16–31 and 1–31 all insert together with no 409.** |
| `payroll-run-duplicate-409.test.ts` | Exact-duplicate standard range still 409s with `'Payroll run for this period already exists'` — closes a pre-existing test gap. |
| `payroll-period-overlap-guard.test.ts` | `openPeriod` refuses an overlapping custom range and creates neither the PayrollPeriod nor the PayrollRun (assert `$transaction` never ran). |
| `timesheet-overlap-guard.test.ts` | Overlapping custom range for the **same** employee → 409; the same range for a **different** employee → allowed; same-start-day duplicate still 409s with the existing message and is never a raw Prisma error. |
| `payroll-custom-period-loan-proration.test.ts` | `computeEmployeeResult` with `periodShare = 7/31` and a 1000 installment → LOAN line ≈ 225.81; with a standard 0.5 share and `amortShare = 1` → exactly 1000 (unchanged). |
| `payroll-loan-no-double-amortization.test.ts` | Four 7-day May runs → summed LOAN lines `< 1000`. |
| `payroll-custom-period-ee-share.test.ts` | `resolveEE` via `computeEmployeeResult`: `kind: null` + `sss: 'FIRST'` → `sssEe === 0`; `kind: 'FIRST_HALF'` + FIRST → full monthly; `kind: 'WHOLE_MONTH'` + FIRST → `monthly × share` (the guard rail); `kind: null` + EVEN → `monthly × share`; `kind: undefined` → `monthly × share`. In every case `sssEr` and `withholdingTax` stay on `× share`. |
| `payroll-custom-period-statutory-proration.test.ts` | A 7-day May range takes `7/31` of monthly SSS/PhilHealth/Pag-IBIG/tax, not half; a 45-day range is impossible (same-month rule) — assert the gate rejects it instead. |

Gate for section 2: `pnpm test` (full suite) green.

---

# Section 3 — UI, both surfaces

### 3.1 — `PeriodPicker.svelte` — fourth `Custom range` segment

`src/lib/components/ui/PeriodPicker.svelte`.

- `KIND_OPTIONS` (`:49-53`): the three existing entries and their **label text stay byte-identical**
  (e2e selectors). Add a fourth entry with value `'CUSTOM'` and label `Custom range`. Widen the
  local option type to `PeriodKind | 'CUSTOM'`; the `kind` prop type becomes
  `PeriodKind | 'CUSTOM'`, default still `'FIRST_HALF'` — Custom is never pre-selected.
- New `$state` `customStart` / `customEnd` (YYYY-MM-DD strings, empty by default).
- `period` (`:55`) becomes `$derived`: in Custom mode, parse the two strings with `new Date(v)`
  (they are UTC-midnight by the `<input type="date">` convention already documented at
  `pay-periods.ts:6-9`); otherwise `periodOf(...)` as today.
- Month and Year selects **stay rendered in Custom mode** — hiding them removes `#pp-month` from the
  DOM and breaks two e2e specs.
- Reveal two `<input type="date">` fields in a `{#if kind === 'CUSTOM'}` block, in the same
  two-column grid, using the incumbent `selectClass`, with real `<label for>` bindings
  (`pp-custom-start`, `pp-custom-end`) matching the Month/Year pattern at `:73`/`:81`. The block
  grows downward only.
- Inline validation, `aria-describedby`-linked, exact copy from the design brief:
  `End date must be on or after the start date.` and `A custom period must start and end in the
  same month.` (reuse `isSameMonthRange` from 1.3 — one rule, one implementation).
- Preview `<p>` (`:106`) gains `aria-live="polite"`. Empty custom state reads `Pick a start and end
  date`. A valid custom range reads
  `` `${formatPeriodPreview(s, e)} · statutory and loans prorated to ${Math.round(periodShareOf(s, e) * 100)}% of the month` ``.
  Standard shapes keep today's preview string exactly — no suffix.
- Hidden inputs (`:67-68`) keep their names and emit `''` while the custom range is invalid or
  incomplete, so the server never receives a half-range.
- **`{@const}` rule:** if any is needed, it must be an immediate child of the `{#if}`/`{#each}`,
  never inside a plain element.
- No new component file, no date-picker dependency, no calendar popover.

Verified by: e2e (3.3) + `pnpm check` + the mechanical detector from the design brief:
`node /home/hyuse/.claude/skills/impeccable/scripts/detect.mjs --json src/lib/components/ui/PeriodPicker.svelte "src/routes/(app)/attendance/+page.svelte"`.

### 3.2 — `/attendance` — delete the client gate

`src/routes/(app)/attendance/+page.svelte`. A **deletion**, net negative lines:

- Remove the `rangeIsStandard` `$derived` (`:54-59`) and the now-unused `isValidStandardPeriod`
  import (`:9`). Leave `periodOf`, `toPeriodInputValue` and `PeriodKind` — the quick-picks still use
  them.
- Save-as-timesheet button (`:394-401`): `disabled={saveTimesheet.busy}` only; replace the
  conditional `title` with the plain `Persist this range as a Timesheet record`.
- Date inputs (`:311-330`) and quick-picks (`:332-342`) are untouched. The 62-day cap message stays.
- Server-side, the range is already validated by `rangeSchema` and `spanExceeded`
  (`+page.server.ts:280-283`); the new sanity gate and overlap guard in `createTimesheet` do the
  rest, surfaced through the existing `toFail(e)`.

Verified by: e2e (3.3) + the manual script.

### 3.3 — E2E tests, section 3

| Spec | Change |
|---|---|
| `tests/e2e/timesheet-create-for-employee.spec.ts` (`:105,107,196,198`) | Re-run **unchanged** as the regression gate for criterion 2. If it breaks, the picker change is wrong — fix the picker, not the spec. |
| `tests/e2e/manager-org-wide-timesheets.spec.ts` (`:91,93`) | Same — unchanged regression gate. |
| `tests/e2e/multi-role-sod.spec.ts:139` | Posts `periodStart`/`periodEnd` directly; unchanged. |
| `tests/e2e/period-picker-default-cutoff.spec.ts` (new) | Open the create-run panel: `First half (1–15)` has `aria-pressed="true"`, `Custom range` has `false`, and the two date inputs are absent until Custom is clicked. |
| `tests/e2e/attendance-save-timesheet-custom-range.spec.ts` (new) | On `/attendance` with an employee selected, set From/To to a 7-day same-month range; assert the Save-as-timesheet button is **enabled**; click it; assert the visible success text `Timesheet saved (7 days).`; then repeat the same range and assert the visible overlap 409 message and that no second timesheet row exists. |
| `tests/e2e/payroll-custom-range-overlap.spec.ts` (new) | Create a May 1–20 custom run; then attempt May 10–31; assert the visible error names the May 1–20 range and that the run list still shows exactly one custom run. |
| `tests/e2e/payroll-custom-range-labels.spec.ts` (new) | A custom run's row/detail shows its exact start date, end date and inclusive day count (criterion 18). |

Gate for section 3: `pnpm test:e2e` green (the suite runs against build+preview per #287, 127 specs, ~35s).

---

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `payroll-standard-period-golden.test.ts` (captured pre-edit, never `-u`) | Fully-Automated | 4 (and risk #1) |
| `pay-periods.test.ts` month-length share table | Fully-Automated | 3 |
| `pay-periods.test.ts` day-count + bounds/monotonicity cases | Fully-Automated | 5, 6 |
| `payroll-custom-period-statutory-proration.test.ts` | Fully-Automated | 5, 6 |
| `payroll-custom-period-loan-proration.test.ts` | Fully-Automated | 7 |
| `payroll-loan-no-double-amortization.test.ts` | Fully-Automated | 8 |
| existing `computeWorkingDays` coverage, re-run | Fully-Automated | 9 |
| `payroll-run-overlap-guard.test.ts` (incl. 1–15 + 16–31 + 1–31 coexistence) | Fully-Automated | 10, 12 |
| `payroll-period-overlap-guard.test.ts` | Fully-Automated | 11 |
| `payroll-run-duplicate-409.test.ts` | Fully-Automated | 13 |
| `attendance-save-timesheet-custom-range.spec.ts` | Fully-Automated | 14, 15 |
| `timesheet-overlap-guard.test.ts` | Fully-Automated | 15, 16 |
| `payroll-period-sanity-gate.test.ts` | Fully-Automated | (Decision round-2 #1) same-month + `end >= start` |
| `payroll-custom-period-ee-share.test.ts` | Fully-Automated | (Decision round-2 #2) + guard rail |
| `period-picker-default-cutoff.spec.ts` | Fully-Automated | 1 |
| `timesheet-create-for-employee.spec.ts` + `manager-org-wide-timesheets.spec.ts` unchanged | Fully-Automated | 2 |
| `payroll-custom-range-labels.spec.ts` | Fully-Automated | 18 |
| existing `requirePayrollManage` / RBAC unit coverage, re-run | Fully-Automated | 19 |
| payslip + report suites re-run as a regression gate | Fully-Automated | 20 |
| Manual script below (GUI, real DB) | Hybrid — precondition: `./start.sh` + `pnpm db:seed` | 14, 15, 18; end-to-end confidence |
| impeccable `detect.mjs` on the two changed Svelte files | Agent-Probe | design-brief conformance |
| Criterion 17 — timesheet sourcing by containment for a custom range | **Known-Gap → backlog stub** | 17 |

**Known-gap → backlog stub (criterion 17).** `payroll/index.ts:297-310` selects timesheets by
containment: a run **shorter** than an existing timesheet reads zero hours and silently falls back
to `scheduledHours`. The overlap guard (2.3) makes the reverse case unreachable, but a pre-existing
standard 1–15 timesheet plus a new May 3–9 run still exhibits it. Fixing the query is a change to
how every existing run sources hours — outside this blast radius and a money-affecting change of
its own. **Gate for criterion 17 stays CONDITIONAL.** Write
`process/features/flexible-periods/backlog/timesheet-containment-sourcing_NOTE_20-08-26.md`
recording the query, the failing scenario, and the two options (intersection query vs pro-rating
timesheet hours). This is a recorded residual, not a pass.

## Test Infra Improvement Notes

- No component-test infrastructure for `.svelte` — `PeriodPicker` validation copy and the deleted
  `rangeIsStandard` are reachable only via e2e. Noted, not fixed here.
- No shared fixture for creating a payroll run; every e2e hand-rolls Prisma inserts with bespoke
  dates to dodge the unique constraint. The three new e2e specs will each need their own dates —
  pick ranges in **June 2026** to stay clear of existing seeds and of each other.

## Gate Commands (pnpm, never npm)

```
pnpm lint          # eslint .
pnpm format:check  # prettier --check .
pnpm check         # svelte-kit sync && svelte-check --tsconfig ./tsconfig.json
pnpm test          # vitest run
pnpm test:e2e      # dotenv -e .env.dev -- playwright test  (build+preview, per #287)
```

**`pnpm check` does NOT cover `prisma/**` or `scripts/**`.** The edit to
`scripts/seed-payslip-demo.ts:102` (2.1) is therefore type-unchecked — verify it by actually running
`pnpm dotenv -e .env.dev -- tsx scripts/seed-payslip-demo.ts` once. A site shipped broken on exactly
this assumption in #282.

---

## Manual Test Script (GUI, exact)

Precondition: `./start.sh` (Postgres on 5434), then `pnpm db:push`, `pnpm db:seed`, then
`pnpm dev`. Env is `.env.dev`; there is no `.env`.

**Login.** Open `http://localhost:5173/login`. Type `admin@veent.ph` in the **Email** field and
`Admin@1234` in the **Password** field. Click **Sign in**. Assert the dashboard heading is visible.

**M1 — the default did not move.** Go to `/payroll`. Click **Create Payroll Run**. Assert the
button labelled `First half (1–15)` is highlighted (selected) and `Custom range` is not. Assert the
preview line reads a 1–15 range with `(15 days)` and has **no** `prorated to` suffix. Do not submit.

**M2 — a custom run is created and labelled.** Still in that panel, click **Custom range**. Assert
two new fields labelled **Start date** and **End date** appear, and that the **Month** select is
still on screen. Type `2026-06-03` into **Start date** and `2026-06-09` into **End date**. Assert
the preview reads `Jun 3 – Jun 9, 2026 (7 days) · statutory and loans prorated to 23% of the month`.
Click **Create**. Assert a new row appears in the payroll run list showing `Jun 3` and `Jun 9` and
`7 days`. **Marker:** this Jun 3–9 range is the record you will look for in every later step — no
other run in the seed uses June 2026.

**M3 — the money is prorated.** Open that Jun 3–9 run. Pick the employee **Head of Operations**
(employee number ending `-001`, basic 40,000). Assert the SSS employee line is **greater than 0 and
less than** the amount on the seeded 1–15 run for the same employee — and that it is close to
`7/31` of a month, i.e. roughly 23% of the monthly figure, not 50%. Write the two numbers down.

**M4 — overlap is refused.** Back on `/payroll`, click **Create Payroll Run**, click **Custom
range**, enter `2026-06-05` and `2026-06-20`, click **Create**. Assert a red error message is
visible that contains the text `Jun 3` and `Jun 9`. Reload `/payroll` and assert the run list still
contains exactly **one** June 2026 run (the Jun 3–9 one) — count the June rows.

**M5 — the sanity gate.** Same panel: enter `2026-06-20` and `2026-06-05`. Assert the inline message
`End date must be on or after the start date.` is visible and the **Create** button is disabled.
Then enter `2026-06-20` and `2026-07-05`. Assert the inline message
`A custom period must start and end in the same month.` is visible and **Create** is still disabled.

**M6 — Save as timesheet for a custom range.** Go to `/attendance`. Select the employee **Head of
Operations**. Set **From** to `2026-06-03` and **To** to `2026-06-09`. Assert the **Save as
timesheet** button is **enabled** (before this change it was greyed out). Click it. Assert a green
success message appears containing the word `Timesheet saved` and a day count. Go to the timesheets
list and assert a row exists whose period reads `Jun 3` to `Jun 9`.

**M7 — timesheet overlap is refused, not a 500.** Back on `/attendance`, same employee, set **From**
to `2026-06-07` and **To** to `2026-06-14`, click **Save as timesheet**. Assert a red error message
is visible on the same page (assert the page still shows the attendance table — **not** a
"500 Internal Error" page). Assert the timesheets list still contains exactly one June 2026 row.

**M8 — the standard path is untouched.** Go to `/payroll`, **Create Payroll Run**, leave everything
default except set Month to `July` and Year to `2026`, keep `First half (1–15)`, click **Create**.
Assert the new run row reads `Jul 1` – `Jul 15`. Open it, find **Head of Operations**, and assert
the SSS employee line is **exactly double** the number you wrote down in M3 divided by 0.46 — i.e.
assert it equals the seeded half-period figure (`450.00` for a 30,000 employee, scale for 40,000).
The point: a standard half still takes exactly half a month.

---

## Rollback

- Single branch `feat/flexible-periods-163`, single PR. **No schema change, no migration** — a
  revert is `git revert` of the merge commit and nothing else. No data written by this change needs
  undoing.
- If a standard-period regression is found after merge, revert the whole PR; do **not** hot-patch
  `periodShareOf`. The golden snapshot test (1.0) is committed first and separately, so it survives
  a revert of the feature and keeps guarding the tree.
- Any custom-range runs created before a revert become "legacy non-standard" rows again — they stay
  readable (`describePeriod` handles them) but will recompute at the flat 0.5 if left in
  DRAFT/COMPUTED. Before reverting, VOID or LOCK any custom run found by
  `scripts/legacy-nonstandard-runs.ts` (step 1.1).
- Commit messages: no `Co-Authored-By`, no attribution footer of any kind (project rule).

---

## Implementation Checklist

1. On a clean tree, create `tests/unit/payroll-standard-period-golden.test.ts` and run
   `pnpm test tests/unit/payroll-standard-period-golden.test.ts -u`; commit it alone.
2. Write and run `scripts/legacy-nonstandard-runs.ts`; paste its output into the PR body.
3. `src/lib/utils/pay-periods.ts:119-130` — day-count fallback in `periodShareOf`; delete the
   `fallback` param; update the doc comment.
4. `src/lib/utils/pay-periods.ts` — add `isSameMonthRange(start, end)`.
5. `src/lib/server/services/payroll/index.ts:222-223` — delete `frequencyShare`; two-arg
   `periodShareOf`; update the `:217-221` comment.
6. `tests/unit/pay-periods.test.ts:79-108` — rewrite the share cases and add `isSameMonthRange`.
7. `tests/unit/payroll-calculator.test.ts:73-76` — keep both, add the custom-share case.
8. Run the section-1 gate: `pnpm test tests/unit/pay-periods.test.ts tests/unit/payroll-calculator.test.ts tests/unit/payroll-standard-period-golden.test.ts`.
9. `payroll/index.ts:78-82` — replace the shape gate with the two sanity errors.
10. `payroll/periods.ts:48-54` — same replacement.
11. `timesheets.ts:136-140` — same replacement.
12. Delete `allowNonStandardPeriod` from all three signatures and doc comments.
13. Update `scripts/seed-payslip-demo.ts:102` and `tests/unit/timesheet-selfservice.test.ts:203`;
    remove any now-unused `isValidStandardPeriod` imports; run the seed script once.
14. `payroll/index.ts` — add exported `assertNoOverlappingRun` (fires only when a side is
    non-standard); call it in `createPayrollRun` replacing `:84-87`.
15. `payroll/periods.ts:56-65` — call `assertNoOverlappingRun`, delete the `findUnique`.
16. `timesheets.ts:142` — add the employee-scoped overlap `findFirst` before the existing
    `findUnique` 409; keep the duplicate-start message.
17. `payroll/index.ts:227` — add `amortShare`; apply it to the loan and cash-advance installments
    at `:314-325`.
18. `payroll/calculator.ts:141-157` — reorder `resolveEE` (WHOLE_MONTH/undefined first, then
    FIRST/SECOND, then EVEN); update the doc comment.
19. Write the nine unit test files listed in 2.6.
20. Run `pnpm test` (full suite).
21. `PeriodPicker.svelte` — fourth `Custom range` segment, revealed date inputs, inline validation,
    `aria-live` preview with the prorated-share suffix, hidden inputs empty while invalid.
22. `attendance/+page.svelte` — delete `rangeIsStandard` (`:54-59`), its `disabled=` use and the
    tooltip (`:396-399`), and the unused import (`:9`).
23. Write the four new e2e specs listed in 3.3.
24. Run all gates: `pnpm lint`, `pnpm format:check`, `pnpm check`, `pnpm test`, `pnpm test:e2e`.
25. Run the impeccable detector on the two Svelte files.
26. Write the criterion-17 backlog stub at
    `process/features/flexible-periods/backlog/timesheet-containment-sourcing_NOTE_20-08-26.md`.
27. Run the manual script M1–M8 against a live `pnpm dev`.
28. Commit and open one PR for #163 — no `Co-Authored-By` line.

---

## Resume and Execution Handoff

1. **Selected plan file:** `process/features/flexible-periods/active/flexible-periods-163_20-08-26/flexible-periods-163_PLAN_20-08-26.md`
2. **Last completed step:** PLAN written; no source touched.
3. **Validate-contract status:** pending — vc-validate-agent writes it before EXECUTE.
4. **Supporting context loaded:** `research-findings_REF_20-08-26.md`,
   `flexible-periods-163_SPEC_20-08-26.md` (incl. Decisions Resolved — round 2),
   `design-brief_REF_20-08-26.md`, `CLAUDE.md`.
5. **Next step for a fresh agent:** checklist item 1 — the golden snapshot must be captured on an
   unmodified tree. If `git status` is not clean, stop and reconcile first; a golden captured after
   an edit proves nothing.

## Validate Contract

(placeholder — vc-validate-agent writes this section before EXECUTE)
