# Implementation Plan (Addendum): Payroll Expansion

**Branch**: `001-hris-platform` | **Date**: 2026-07-10 | **Spec**: [spec.md](./spec.md) FR-060–FR-066
**Parent plan**: [plan.md](./plan.md) — this is a scoped addendum for the Phase 11 Payroll epic; it does not replace plan.md.

## Summary

Evolve the existing single-shot payroll (basic pay + PH statutory deductions) into a full,
period-based payroll engine: a lifecycle-managed **PayrollPeriod**, an **earnings engine**
(overtime, night differential, holiday, rest-day, allowances, incentives), a **deductions
engine** (loans + cash advances on top of SSS/PhilHealth/Pag-IBIG/BIR), **lock + payslip
release** semantics, and a non-persisting **Payroll Calculator** for what-if previews. All
compute logic stays in pure, unit-tested functions under `src/lib/server/services/payroll/`,
mirroring the existing `ph-statutory.ts` pattern; routes/actions stay thin.

## Technical Context

**Language/Version**: TypeScript 5 · Node 20 · SvelteKit 2 / Svelte 5 (unchanged)
**Primary Dependencies**: Prisma 5 + PostgreSQL 16, Zod, Lucia (unchanged) — no new runtime deps
**Storage**: PostgreSQL. New tables: `PayrollPeriod`, `PayrollEarning`, `PayrollDeduction`, `Loan`,
`LoanPayment`, `CashAdvance`, `EarningType`, `DeductionType` (see data-model.md "Phase 11 — Proposed Entities").
Money as `Decimal`; serialized via the existing transport hook.
**Testing**: Vitest units for every compute function (Red-Green like `ph-statutory.test.ts`); a period-lifecycle integration test.
**Project Type**: Full-stack SvelteKit web app (unchanged).
**Performance Goals**: A payroll run for ~200 employees < 30s (well within SC-004's 5-min budget).
**Constraints**: PH labor-law pay rules (DOLE); locked runs immutable; payslip PII RBAC-gated; all mutations audited.

**Dependencies on other Phase 11 epics** (design the seams now, don't block):
- **Attendance engine (11.3, FR-053)** — supplies per-employee, per-period hour buckets
  (`regularHours, otHours, nightDiffHours, holidayHours, restDayHours, lateMinutes, undertimeMinutes`).
  The earnings engine consumes an **`AttendanceInput` interface**; until the attendance engine lands,
  populate it from approved `TimesheetEntry`/`AttendanceDay` where available or via manual entry.
- **Roles foundation (11.1, T161)** — `PAYROLL_OFFICER` (manage payroll) and `FINANCE` (read-only reports).
- **Settings codes (11.1, T163)** — `EarningType`/`DeductionType` catalogs + configurable rate table.

**NEEDS CLARIFICATION** (carry to /speckit-clarify before build):
1. Exact PH multipliers to encode as defaults (OT 125%, rest-day 130%, special/regular holiday 130%/200%,
   night diff 10% — confirm the company's actual rates and whether they're org-configurable).
2. Loan amortization model: fixed installment vs. balance %; behavior on skipped/partial periods.
3. Does `PayrollPeriod` replace `PayrollRun`, or wrap it? (Recommended below: evolve `PayrollRun`.)

## Key Decisions (Phase 0 research)

- **D1 — Lifecycle on the run, period as container.** Add a `PayrollPeriod` (cutoff window + config
  snapshot) that owns one `PayrollRun`. Expand run status to `OPEN → IMPORTED → GENERATED → LOCKED → RELEASED`
  (keep `VOIDED`). *Rationale*: minimal churn to the existing `PayrollRun`/`PayrollEntry`; `LOCKED` gives
  immutability, `RELEASED` gates payslip visibility (today gated on `APPROVED`). *Alt considered*: a brand-new
  model tree — rejected (throws away working code + the statutory engine).
- **D2 — Line-item earnings/deductions.** `PayrollEntry` keeps its summary columns but gains child
  `PayrollEarning[]` / `PayrollDeduction[]` (typeCode + amount + taxable flag). *Rationale*: payslip itemization,
  BIR reporting, and auditability; taxable vs. non-taxable feeds withholding correctly. *Alt*: wide columns — rejected (not extensible to configurable codes).
- **D3 — Pure compute engine.** `payroll/earnings.ts` and `payroll/deductions.ts` export side-effect-free
  functions `(AttendanceInput, EmployeeComp, Config) → {lineItems, totals}`, composed by `computePayrollRun`.
  The **Payroll Calculator reuses the exact same functions** with no DB writes. *Rationale*: one source of truth,
  fully unit-testable, guarantees calculator == actual run.
- **D4 — Withholding order.** Gross = basic + earnings; taxable-gross = gross − (statutory EE + non-taxable items);
  then BIR withholding; then net = gross − all deductions (statutory + tax + loans + cash advances). Encode explicitly and test.
- **D5 — Loans/cash advances.** `Loan`/`CashAdvance` carry a `balance`; each run creates a `PayrollDeduction`
  and decrements balance **inside the run transaction**; `VOID`/unlock reverses it. Never go negative (cap at balance).
- **D6 — Immutability & adjustments.** `LOCKED`/`RELEASED` runs reject edits (409); corrections are new
  adjustment entries in a later period (honors FR-022 + FR-063). Lock, release, and void are audited events.

## Constitution Check

| Principle | Gate | Status |
|-----------|------|--------|
| I. Data Privacy & Security | Payslip/salary/bank PII behind RBAC; secrets in env | ✅ RBAC-gated views; no new secrets |
| II. RBAC | Every payroll route declares roles; server-side | ✅ Needs `PAYROLL_OFFICER`/`FINANCE` (T161) — dependency noted |
| III. Spec-Driven | Spec precedes build | ✅ FR-060–066 written; this plan + clarify precede code |
| IV. Audit & Compliance | All mutations logged; compliance noted | ✅ compute→generate→lock→release→void all `writeAuditLog`; PH DOLE/BIR noted |
| V. Test-First & Deliverability | Tests before impl; each slice independently shippable | ✅ pure-fn units first; slices below ship incrementally |

No violations. No Complexity Tracking entries required (reuses existing structure).

## Project Structure (new/changed)

```text
prisma/schema.prisma                         # + PayrollPeriod, PayrollEarning/Deduction, Loan(+Payment), CashAdvance, EarningType/DeductionType; expand PayrollRunStatus
src/lib/server/services/payroll/
├── index.ts                                 # computePayrollRun(): orchestrate earnings + deductions + statutory
├── ph-statutory.ts                          # (existing) SSS/PhilHealth/Pag-IBIG/BIR — unchanged
├── earnings.ts        (new)                 # OT, night diff, holiday, rest-day, allowance, incentive (pure)
├── deductions.ts      (new)                 # loans + cash advances amortization (pure)
├── periods.ts         (new)                 # lifecycle: openPeriod, importAttendance, generate, lock, release, void
├── calculator.ts      (new)                 # what-if preview (reuses earnings/deductions, no persistence)
└── types.ts           (new)                 # AttendanceInput, EmployeeComp, PayComponent
src/routes/(app)/payroll/                    # add period lifecycle actions + calculator page
src/routes/(app)/payroll/calculator/         # HR what-if UI
src/routes/api/v1/payroll/                   # add period + calculator endpoints (see contracts/payroll-v2.md)
tests/unit/payroll-earnings.test.ts (new), payroll-deductions.test.ts (new)
```

**Structure Decision**: Extend the existing payroll service module — thin routes, pure testable
services, one orchestrator. New REST surface documented in `contracts/payroll-v2.md` (additive; the
original `contracts/payroll.md` stays valid for the statutory core).

## Delivery slices (each independently shippable & testable)

1. **Schema + engine (no UI)** — new entities + `earnings.ts`/`deductions.ts` with full unit tests; `computePayrollRun` composes them. Verifiable via Vitest against known PH cases.
2. **Period lifecycle** — `periods.ts` + run-status expansion + lock/release gating on payslip views (RELEASED replaces APPROVED). Integration test: open→generate→lock→release.
3. **Payroll Calculator** — `calculator.ts` + `(app)/payroll/calculator` + API; asserts calculator output == run output for the same inputs.
4. **Loans & cash advances** — CRUD in Settings/Employee + amortization wired into a run + balance decrement/reversal on void.
5. **Reports hook-in** — feed payroll register / payslip / BIR reports (FR-067) from the new line items.

## Verification

- `pnpm test` — earnings/deductions/statutory units green for PHP 15k/30k/100k fixtures incl. OT/holiday/night-diff cases; calculator == run.
- `pnpm exec svelte-check` — no new errors.
- `pnpm prisma db push` — schema applies; existing payroll data migrates (additive columns/tables).
- E2E: open period → import attendance → generate → lock → release → employee sees released payslip; locked run rejects edits (409).
- `speckit-analyze` — FR-060–066 map to these tasks; no orphans.

## Out of scope (this addendum)
Attendance derivation (epic 11.3), disbursement/bank-GCash export (FR-065, integration), the Reports
UI itself (FR-067 tracked separately), and the new roles' full RBAC matrix (T161).
