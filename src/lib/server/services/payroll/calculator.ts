import { db } from '$lib/server/db'
import { error } from '@sveltejs/kit'
import { computeEarnings } from './earnings'
import { ratesFromRule, type PayRates } from './rates'
import { computeDeductions, type AmortItem } from './deductions'
import { recurringDeductionComponents } from './employee-deductions'
import { computeStatutoryDeductions } from './ph-statutory'
import { D, q2n, sumQ } from './money'
import {
	absenceHoursOf,
	basicPayBasis,
	expectedHoursOf,
	hourlyRateOf,
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
	const m = computeStatutoryDeductions(comp.basicMonthlySalary)
	const share = D(cfg.periodShare)
	const statutory: ProratedStatutory = {
		sssEe: q2n(m.sssEe.times(share)),
		sssEr: q2n(m.sssEr.times(share)),
		philhealthEe: q2n(m.philhealthEe.times(share)),
		philhealthEr: q2n(m.philhealthEr.times(share)),
		pagibigEe: q2n(m.pagibigEe.times(share)),
		pagibigEr: q2n(m.pagibigEr.times(share)),
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
		statutory
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

	const [config, earningTypes, loansAll, advancesAll, payRateRule, recurringDeductions] =
		await Promise.all([
			db.payrollConfig.findUnique({ where: { organizationId } }),
			db.earningType.findMany({ where: { organizationId }, select: { code: true, taxable: true } }),
			db.loan.findMany({ where: { employeeId, status: 'ACTIVE', balance: { gt: 0 } } }),
			db.cashAdvance.findMany({ where: { employeeId, status: 'ACTIVE', balance: { gt: 0 } } }),
			db.payRateRule.findUnique({ where: { organizationId } }),
			// Recurring custom deductions apply in the preview too (#66) — same as a real run.
			db.employeeDeduction.findMany({
				where: { employeeId, isActive: true, deductionType: { isActive: true } },
				include: { deductionType: { select: { code: true, label: true } } }
			})
		])

	const periodShare = (config?.payFrequency ?? 'SEMI_MONTHLY') === 'MONTHLY' ? 1 : 0.5
	const cfg: EmployeeComputeConfig = {
		taxableByCode: new Map(earningTypes.map((e) => [e.code, e.taxable])),
		rates: ratesFromRule(payRateRule),
		periodShare,
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
