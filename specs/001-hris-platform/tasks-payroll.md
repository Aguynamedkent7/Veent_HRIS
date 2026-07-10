# Tasks (Addendum): Payroll Expansion

**Input**: [plan-payroll.md](./plan-payroll.md) · [spec.md](./spec.md) FR-060–FR-066 · [contracts/payroll-v2.md](./contracts/payroll-v2.md)
**Parent**: refines `tasks.md` Phase 11 payroll epics **T170–T175** into buildable tasks. Scoped so
the main `tasks.md` is not regenerated. IDs use the `PAY-###` prefix.

**Decisions applied** (from plan-payroll.md, 2026-07-10): premium multipliers in a config table (DOLE
defaults, engine reads from config); loans/cash advances = fixed installment capped at balance, skipped
when net insufficient; `PayrollPeriod` **wraps** `PayrollRun`.

**Conventions**: services are pure/testable under `src/lib/server/services/payroll/`; routes are thin;
every mutation calls `writeAuditLog`; **tests are written before implementation** (Constitution §V);
`[P]` = parallel-safe (different files, no incomplete deps). Money is `Decimal` (transport hook handles it).

**Cross-epic dependencies** (design the seam now, don't block):
- **Attendance engine** (Phase 11.3, FR-053) produces the `AttendanceInput` hour-buckets. Until it lands,
  populate `AttendanceInput` from approved `TimesheetEntry`/`AttendanceDay` or manual entry.
- **Roles** (T161): `PAYROLL_OFFICER` / `FINANCE`. HR_ADMIN/SUPER_ADMIN paths work meanwhile.
- **Settings codes** (T163): `EarningType`/`DeductionType` catalogs — seeded in Slice 1, richer UI later.

---

## Slice 1 — Schema + pure compute engine (no UI, fully unit-testable) 🎯 foundation

- [X] PAY-001 Schema (`prisma/schema.prisma`): add `PayrollPeriod`, `PayrollEarning`, `PayrollDeduction`, `Loan`, `LoanPayment`, `CashAdvance`, `EarningType`, `DeductionType`, `PayRateRule`; expand `PayrollRunStatus` → `OPEN, IMPORTED, GENERATED, LOCKED, RELEASED, VOIDED`; add `PayrollRun.periodId` + `PayrollEntry.earnings[]/deductions[]`. Apply via `pnpm db:migrate` (db push) + generate.
- [X] PAY-002 [P] Engine types `payroll/types.ts`: `AttendanceInput` (regular/ot/nightDiff/holiday/restDay hours, late/undertime mins), `EmployeeComp` (rate, rateType), `PayComponent`, `RateConfig`, `EngineResult`.
- [X] PAY-003 [P] Rate config accessor `payroll/rates.ts`: load an org's `PayRateRule`/`EarningType` multipliers, falling back to DOLE defaults (OT ×1.25, night diff +10%, rest-day/special-holiday ×1.30, regular-holiday ×2.00 worked / ×1.00 unworked, + stacked combos).
- [X] PAY-004 **Test-first** `tests/unit/payroll-earnings.test.ts` (MUST fail before PAY-005): OT, night diff, holiday (regular/special, worked/unworked), rest-day, and stacked cases (OT-on-holiday, holiday-on-rest-day) for PHP 15k / 30k / 100k monthly rates.
- [X] PAY-005 Implement `payroll/earnings.ts` pure fns (`computeOvertime`, `computeNightDiff`, `computeHoliday`, `computeRestDay`, `sumAllowancesIncentives`, `computeEarnings`) reading rates from config → green.
- [X] PAY-006 **Test-first** `tests/unit/payroll-deductions.test.ts`: fixed installment capped at balance; skip when net insufficient; correct statutory + tax ordering (taxable-gross → BIR → net).
- [X] PAY-007 Implement `payroll/deductions.ts` (`computeLoanDeduction`, `computeCashAdvanceDeduction`, `composeDeductions` with statutory + tax) → green.
- [X] PAY-008 Compose in `payroll/index.ts` `computePayrollRun`: earnings → taxable gross → BIR (reuse `ph-statutory.ts`) → deductions → net; persist `PayrollEntry` + line items. Extends the existing run compute.
- [X] PAY-009 [P] Seed default `EarningType`/`DeductionType`/`PayRateRule` (DOLE) in `prisma/seed.ts` (idempotent).

**Checkpoint**: `pnpm test` proves the full computation for sample salaries incl. OT/holiday/night-diff — no UI, no server needed.

## Slice 2 — Period lifecycle (open → import → generate → lock → release)

- [X] PAY-010 `payroll/periods.ts`: `openPeriod`, `importAttendance`, `generate`, `lock`, `release`, `void` — audited; guards (lock needs no unresolved flags or an override note; release requires `LOCKED`; void = `SUPER_ADMIN`, reverses balances).
- [X] PAY-011 Gate payslip visibility on run status **`RELEASED`** (was `APPROVED`): `payroll/runs.ts` + `(app)/payslips/*` + `api/v1/payroll/payslips/[id]`.
- [X] PAY-012 [P] Page actions `(app)/payroll/[id]/+page.server.ts` (+ list): import/generate/lock/release/void with `requireRole(HR_ADMIN, SUPER_ADMIN, PAYROLL_OFFICER)` (void = SUPER_ADMIN).
- [X] PAY-013 [P] API routes per `contracts/payroll-v2.md`: `api/v1/payroll/periods/+server.ts` and `[id]/{import,generate,lock,release,void}`.
- [X] PAY-014 Integration test: open→import→generate→lock→release; a locked-run edit → 409; employee sees only `RELEASED` payslips.

## Slice 3 — Payroll Calculator (what-if, non-persisting)

- [X] PAY-015 `payroll/calculator.ts`: `preview(employeeId, AttendanceInput, adjustments)` reusing `earnings.ts`/`deductions.ts`, **no DB writes**.
- [X] PAY-016 [P] `api/v1/payroll/calculator/+server.ts` (POST) per contract.
- [X] PAY-017 [P] `(app)/payroll/calculator/+page.{server.ts,svelte}`: HR what-if form + itemized preview; nav entry.
- [X] PAY-018 Test: calculator output **==** a real run's entry for identical inputs (guards engine drift).

## Slice 4 — Loans & cash advances

- [ ] PAY-019 `payroll/loans.ts`: list/create/update `Loan`/`CashAdvance` with balance tracking, audited.
- [ ] PAY-020 [P] UI to manage loans/cash advances (employee detail or Settings) with `PAYROLL_OFFICER`/HR access.
- [ ] PAY-021 Wire amortization into `generate()` (PAY-010): create `PayrollDeduction`, decrement balance in the run transaction; reverse on `void`.
- [ ] PAY-022 [P] API `api/v1/payroll/loans` (+ `[id]`) and `.../cash-advances`.
- [ ] PAY-023 Test: multi-period amortization to zero; skip on insufficient net; void reversal restores balance.

## Slice 5 — Reports hook-in (feeds FR-067)

- [ ] PAY-024 Extend `services/reports.ts` to build payroll register + itemized payslip + BIR reports from `PayrollEarning`/`PayrollDeduction` line items.
- [ ] PAY-025 [P] Report pages/exports: payroll register, tardiness, overtime, loan summary (ties into Reports epic T176).

---

## Dependencies & order

- **PAY-001 blocks everything.** Slice 1 (PAY-002–009) is otherwise internally parallel where `[P]`.
- Slice 2 depends on Slice 1; Slice 3 depends on the engine (Slice 1); Slice 4 depends on PAY-010; Slice 5 depends on line items (PAY-008).
- Test tasks (PAY-004, PAY-006) precede their implementation tasks per Constitution §V.
- `PAYROLL_OFFICER` role (T161) unblocks the officer-scoped paths in PAY-012/020; HR_ADMIN works until then.
- The **Attendance engine** (11.3) is the real producer of `AttendanceInput`; ship Slice 1–3 against `TimesheetEntry`/manual input, then swap in `AttendanceDay` when 11.3 lands.

## Verification (per plan-payroll.md)

`pnpm test` (earnings/deductions/statutory + calculator==run) · `pnpm exec svelte-check` (no new errors) ·
`pnpm db:migrate` (additive) · E2E lifecycle happy-path + locked-run 409 · `speckit-analyze` (FR-060–066 mapped).
