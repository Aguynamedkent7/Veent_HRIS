import { db } from '$lib/server/db'
import { error } from '@sveltejs/kit'
import { computeEarnings } from './earnings'
import { ratesFromRule, type PayRates } from './rates'
import { computeDeductions, type AmortItem } from './deductions'
import { recurringDeductionComponents } from './employee-deductions'
import {
	statutoryExemptions,
	employerShareExternals,
	statutoryAllocations
} from './employee-statutory'
import { computeStatutoryDeductions } from './ph-statutory'
import type { StatutoryAllocation } from '@prisma/client'
import type { PeriodKind } from '$lib/utils/pay-periods'
import { D, q2n, sumQ, ZERO, type Money } from './money'
import {
	absenceHoursOf,
	basicPayBasis,
	expectedHoursOf,
	hourlyRateOf,
	monthlyBasisOf,
	type AttendanceInput,
	type EmployeeComp,
	type PayAdjustments,
	type PayComponent
} from './types'

/**
 * Shared per-employee payroll computation (PAY-015). Both the real run (`computePayrollRun`)
 * and the what-if Payroll Calculator call this, so a preview is byte-for-byte identical to what a
 * run would produce for the same inputs — that is the guarantee PAY-018 tests.
 */

export interface EmployeeComputeConfig {
	/** Code → taxable, from EarningType config. Overrides the engine defaults. */
	taxableByCode: Map<string, boolean>
	/** Monthly-statutory proration: 0.5 for semi-monthly, 1 for monthly. */
	periodShare: number
	loans: AmortItem[]
	cashAdvances: AmortItem[]
	/** Recurring custom deductions (#66), already prorated to the period. */
	recurringDeductions?: PayComponent[]
	/**
	 * Per-employee statutory exemptions (#173). A flagged contribution is not enrolled, so BOTH
	 * its EE and ER share are zeroed before proration. Withholding tax is never exempted. Omitted →
	 * all contributions on (the default).
	 */
	statutoryExemptions?: { sss: boolean; philhealth: boolean; pagibig: boolean }
	/**
	 * Per-employee "employer share paid externally" (#173, Feature C). A flagged contribution has its
	 * ER share zeroed before proration; the EE share is still deducted and tax is untouched. Independent
	 * of `statutoryExemptions` (which zeroes both shares). Omitted → all ER shares kept (the default).
	 */
	employerShareExternal?: { sss: boolean; philhealth: boolean; pagibig: boolean }
	/**
	 * Per-employee statutory EE-share cutoff choice (#173, Feature E). EVEN (or omitted) keeps the
	 * `× periodShare` split; FIRST/SECOND load the full monthly EE onto one semi-monthly cutoff. Only
	 * meaningful when `periodKind` is FIRST_HALF or SECOND_HALF — WHOLE_MONTH/legacy runs ignore it.
	 * ER share and tax keep their normal proration regardless.
	 */
	statutoryAllocations?: {
		sss: StatutoryAllocation
		philhealth: StatutoryAllocation
		pagibig: StatutoryAllocation
	}
	/**
	 * Which standard cutoff this run covers (#173, Feature E), from `describePeriod(start, end).kind`.
	 * Drives `statutoryAllocations`; omitted/null (preview has no period) → allocation is moot and the
	 * EE share falls back to `× periodShare`.
	 */
	periodKind?: PeriodKind | null
	/** Org premium-pay multipliers (from PayRateRule); omitted → DOLE defaults. */
	rates?: PayRates
	/**
	 * Paid hours the period actually schedules, used to value absences for fixed-basic staff
	 * (#121). The real run passes its holiday-aware `scheduledHours`; omitted → derived from the
	 * employee's working days × daily hours × `periodShare`.
	 */
	expectedHours?: number
}

export interface ProratedStatutory {
	sssEe: number
	sssEr: number
	philhealthEe: number
	philhealthEr: number
	pagibigEe: number
	pagibigEr: number
	withholdingTax: number
}

export interface EmployeeComputeResult {
	earnings: PayComponent[]
	deductions: PayComponent[]
	basicPay: number
	grossPay: number
	taxableGross: number
	totalDeductions: number
	netPay: number
	statutory: ProratedStatutory
	/** Deductions gross could not fund (#103). > 0 means net was floored and needs review. */
	uncollected: number
}

/**
 * The employee share for one contribution in this period (#173, Feature E). Outside a semi-monthly
 * cutoff (WHOLE_MONTH or a legacy/null period) allocation is moot and the monthly EE prorates by
 * `× share` exactly as before. On a cutoff: EVEN keeps the half split; FIRST loads the full monthly
 * EE onto the 1–15 cutoff (0 on the other), SECOND onto the 16–EOM cutoff. Returns a Money that the
 * caller quantizes once, exactly like the pre-existing EE line.
 */
function resolveEE(
	monthlyEE: Money,
	mode: StatutoryAllocation,
	kind: PeriodKind | null | undefined,
	share: Money
): Money {
	if (kind !== 'FIRST_HALF' && kind !== 'SECOND_HALF') return monthlyEE.times(share)
	if (mode === 'FIRST') return kind === 'FIRST_HALF' ? monthlyEE : ZERO
	if (mode === 'SECOND') return kind === 'SECOND_HALF' ? monthlyEE : ZERO
	return monthlyEE.times(0.5) // EVEN — today's behaviour (share is 0.5 on any cutoff)
}

export function computeEmployeeResult(
	comp: EmployeeComp,
	attendance: AttendanceInput,
	adjustments: PayAdjustments,
	cfg: EmployeeComputeConfig
): EmployeeComputeResult {
	const earnings = computeEarnings(comp, attendance, adjustments, cfg.rates, {
		periodShare: cfg.periodShare
	})
	// Requirement: taxability from EarningType config.
	for (const c of earnings.components) {
		const configured = cfg.taxableByCode.get(c.code)
		if (configured !== undefined) c.taxable = configured
	}
	// Lines-authoritative: the taxable subtotal is the sum of already-quantized earning lines.
	const taxableGross = sumQ(
		earnings.components.filter((c) => c.taxable).map((c) => c.amount)
	).toNumber()

	// #119: the monthly statutory figures come back EXACT, are prorated in decimal, and quantize
	// exactly once — here. Previously each was rounded, scaled by 0.5, then rounded again.
	// #120: brackets are defined on a MONTHLY salary credit, so hourly staff are projected to a
	// monthly equivalent first — passing a raw hourly rate would floor them in the lowest bracket.
	const m = computeStatutoryDeductions(monthlyBasisOf(comp))
	// #173: an exempted contribution is not enrolled — zero BOTH its EE and ER share before
	// proration, leaving the other contributions and their proration untouched. Withholding tax
	// is never exempted (income-based exemption is already the ₱0 bracket), so it is always
	// computed from the full contributions — `m.withholdingTax` is not affected here.
	const ex = cfg.statutoryExemptions
	// #173 (Feature C): "employer share paid externally" zeroes the ER share only. Exempt already
	// zeroes both shares, so a contribution that is exempt makes this a no-op (EE stays 0 either way).
	const ext = cfg.employerShareExternal
	// #173 (Feature E): the EE share may be loaded onto one semi-monthly cutoff instead of split.
	// Applied AFTER the exempt check — an exempt contribution stays 0 (its allocation is moot). ER
	// share and tax keep `× share` proration. Omitted → EVEN (unchanged).
	const alloc = cfg.statutoryAllocations
	const kind = cfg.periodKind
	const share = D(cfg.periodShare)
	const statutory: ProratedStatutory = {
		sssEe: ex?.sss ? 0 : q2n(resolveEE(m.sssEe, alloc?.sss ?? 'EVEN', kind, share)),
		sssEr: ex?.sss || ext?.sss ? 0 : q2n(m.sssEr.times(share)),
		philhealthEe: ex?.philhealth
			? 0
			: q2n(resolveEE(m.philhealthEe, alloc?.philhealth ?? 'EVEN', kind, share)),
		philhealthEr: ex?.philhealth || ext?.philhealth ? 0 : q2n(m.philhealthEr.times(share)),
		pagibigEe: ex?.pagibig ? 0 : q2n(resolveEE(m.pagibigEe, alloc?.pagibig ?? 'EVEN', kind, share)),
		pagibigEr: ex?.pagibig || ext?.pagibig ? 0 : q2n(m.pagibigEr.times(share)),
		withholdingTax: q2n(m.withholdingTax.times(share))
	}

	// #121: tardiness and absence are fixed-basic semantics. For hourly staff the unworked time is
	// already missing from `regularHours` (and therefore from BASIC), so charging these lines too
	// would deduct the same minutes a second time.
	const fixedBasic = basicPayBasis(comp) === 'FIXED'
	const expectedHours = cfg.expectedHours ?? expectedHoursOf(comp, cfg.periodShare)

	const ded = computeDeductions({
		gross: earnings.gross,
		hourlyRate: hourlyRateOf(comp),
		lateMinutes: fixedBasic ? attendance.lateMinutes : 0,
		undertimeMinutes: fixedBasic ? attendance.undertimeMinutes : 0,
		absenceHours: fixedBasic ? absenceHoursOf(attendance, expectedHours) : 0,
		statutory: {
			sssEe: statutory.sssEe,
			philhealthEe: statutory.philhealthEe,
			pagibigEe: statutory.pagibigEe,
			withholdingTax: statutory.withholdingTax
		},
		loans: cfg.loans,
		cashAdvances: cfg.cashAdvances,
		recurring: cfg.recurringDeductions
	})

	return {
		earnings: earnings.components,
		deductions: ded.components,
		basicPay: earnings.components.find((c) => c.code === 'BASIC')?.amount ?? 0,
		grossPay: earnings.gross,
		taxableGross,
		totalDeductions: ded.total,
		netPay: ded.net,
		statutory,
		uncollected: ded.uncollected
	}
}

/**
 * Roster + recurring-earning defaults for the calculator UI (full page and the floating
 * panel on payroll pages, #72). Prefill amounts are prorated exactly like computePayroll.
 */
export async function loadCalculatorData(organizationId: string) {
	const [employees, config, recurring] = await Promise.all([
		db.employee.findMany({
			where: { user: { organizationId }, employmentStatus: 'ACTIVE' },
			select: { id: true, firstName: true, lastName: true, employeeNumber: true },
			orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
		}),
		db.payrollConfig.findUnique({ where: { organizationId }, select: { payFrequency: true } }),
		db.employeeEarning.groupBy({
			by: ['employeeId', 'kind'],
			where: { employee: { organizationId }, isActive: true },
			_sum: { monthlyAmount: true }
		})
	])

	const periodShare = (config?.payFrequency ?? 'SEMI_MONTHLY') === 'MONTHLY' ? 1 : 0.5
	const recurringDefaults: Record<string, { allowances: number; incentives: number }> = {}
	for (const g of recurring) {
		const rec = (recurringDefaults[g.employeeId] ??= { allowances: 0, incentives: 0 })
		const amount = q2n(D(g._sum.monthlyAmount ?? 0).times(periodShare))
		if (g.kind === 'ALLOWANCE') rec.allowances = amount
		else rec.incentives = amount
	}

	return { employees, recurringDefaults }
}

/**
 * What-if preview for one employee (PAY-016 / PAY-017). Loads the employee's compensation and the
 * org's rate/frequency + active loans, then runs the shared engine WITHOUT persisting anything.
 */
export async function previewPayroll(
	employeeId: string,
	organizationId: string,
	input: { attendance: AttendanceInput; adjustments?: PayAdjustments }
) {
	const employee = await db.employee.findFirst({
		where: { id: employeeId, user: { organizationId } },
		select: { id: true, firstName: true, lastName: true, basicMonthlySalary: true, rateType: true }
	})
	if (!employee) error(404, 'Employee not found')

	const [
		config,
		earningTypes,
		loansAll,
		advancesAll,
		payRateRule,
		recurringDeductions,
		statutoryExempt,
		statutoryExternal,
		statutoryAllocation
	] = await Promise.all([
		db.payrollConfig.findUnique({ where: { organizationId } }),
		db.earningType.findMany({ where: { organizationId }, select: { code: true, taxable: true } }),
		db.loan.findMany({ where: { employeeId, status: 'ACTIVE', balance: { gt: 0 } } }),
		db.cashAdvance.findMany({ where: { employeeId, status: 'ACTIVE', balance: { gt: 0 } } }),
		db.payRateRule.findUnique({ where: { organizationId } }),
		// Recurring custom deductions apply in the preview too (#66) — same as a real run.
		db.employeeDeduction.findMany({
			where: { employeeId, isActive: true, deductionType: { isActive: true } },
			include: { deductionType: { select: { code: true, label: true } } }
		}),
		// Statutory exemptions apply in the preview too (#173) — same as a real run.
		db.employeeStatutoryConfig.findMany({
			where: { employeeId, exempt: true },
			select: { contribution: true }
		}),
		// "Employer share paid externally" applies in the preview too (#173) — same as a real run.
		db.employeeStatutoryConfig.findMany({
			where: { employeeId, employerSharePaidExternally: true },
			select: { contribution: true }
		}),
		// EE-share allocation (#173, Feature E) — wired identically to the run. Moot here (a preview
		// has no cutoff, so `periodKind` stays undefined), but kept symmetric with computePayroll.
		db.employeeStatutoryConfig.findMany({
			where: { employeeId, allocation: { not: 'EVEN' } },
			select: { contribution: true, allocation: true }
		})
	])

	const periodShare = (config?.payFrequency ?? 'SEMI_MONTHLY') === 'MONTHLY' ? 1 : 0.5
	const cfg: EmployeeComputeConfig = {
		taxableByCode: new Map(earningTypes.map((e) => [e.code, e.taxable])),
		rates: ratesFromRule(payRateRule),
		periodShare,
		statutoryExemptions: statutoryExemptions(statutoryExempt),
		employerShareExternal: employerShareExternals(statutoryExternal),
		statutoryAllocations: statutoryAllocations(statutoryAllocation),
		recurringDeductions: recurringDeductionComponents(recurringDeductions, periodShare),
		loans: loansAll.map((l) => ({
			refId: l.id,
			label: l.type ?? 'Loan',
			installment: l.installment,
			balance: l.balance
		})),
		cashAdvances: advancesAll.map((a) => ({
			refId: a.id,
			label: 'Cash advance',
			installment: a.installment,
			balance: a.balance
		}))
	}

	const comp: EmployeeComp = {
		basicMonthlySalary: employee.basicMonthlySalary,
		rateType: employee.rateType
	}
	const result = computeEmployeeResult(comp, input.attendance, input.adjustments ?? {}, cfg)

	return {
		employee: { id: employee.id, firstName: employee.firstName, lastName: employee.lastName },
		...result
	}
}
