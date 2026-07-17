import { db } from '$lib/server/db'
import { error } from '@sveltejs/kit'
import { computeEarnings } from './earnings'
import { ratesFromRule, type PayRates } from './rates'
import { computeDeductions, type AmortItem } from './deductions'
import { recurringDeductionComponents } from './employee-deductions'
import { computeStatutoryDeductions } from './ph-statutory'
import {
	hourlyRateOf,
	round2,
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
	const earnings = computeEarnings(comp, attendance, adjustments, cfg.rates)
	// Requirement: taxability from EarningType config.
	for (const c of earnings.components) {
		const configured = cfg.taxableByCode.get(c.code)
		if (configured !== undefined) c.taxable = configured
	}
	const taxableGross = round2(
		earnings.components.filter((c) => c.taxable).reduce((s, c) => s + c.amount, 0)
	)

	const m = computeStatutoryDeductions(comp.basicMonthlySalary)
	const statutory: ProratedStatutory = {
		sssEe: round2(m.sssEe * cfg.periodShare),
		sssEr: round2(m.sssEr * cfg.periodShare),
		philhealthEe: round2(m.philhealthEe * cfg.periodShare),
		philhealthEr: round2(m.philhealthEr * cfg.periodShare),
		pagibigEe: round2(m.pagibigEe * cfg.periodShare),
		pagibigEr: round2(m.pagibigEr * cfg.periodShare),
		withholdingTax: round2(m.withholdingTax * cfg.periodShare)
	}

	const ded = computeDeductions({
		gross: earnings.gross,
		hourlyRate: hourlyRateOf(comp),
		lateMinutes: attendance.lateMinutes,
		undertimeMinutes: attendance.undertimeMinutes,
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
		const amount = round2(Number(g._sum.monthlyAmount ?? 0) * periodShare)
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
			installment: Number(l.installment),
			balance: Number(l.balance)
		})),
		cashAdvances: advancesAll.map((a) => ({
			refId: a.id,
			label: 'Cash advance',
			installment: Number(a.installment),
			balance: Number(a.balance)
		}))
	}

	const comp: EmployeeComp = {
		basicMonthlySalary: Number(employee.basicMonthlySalary),
		rateType: employee.rateType
	}
	const result = computeEmployeeResult(comp, input.attendance, input.adjustments ?? {}, cfg)

	return {
		employee: { id: employee.id, firstName: employee.firstName, lastName: employee.lastName },
		...result
	}
}
