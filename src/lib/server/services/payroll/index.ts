import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import { computeEmployeeResult } from './calculator'
import { ratesFromRule } from './rates'
import { type AmortItem } from './deductions'
import { recurringDeductionComponents } from './employee-deductions'
import { D, q2n, sum, sumQ, ZERO } from './money'
import { emptyAttendance, round2, type EmployeeComp } from './types'
import { buildAttendanceInput } from '../attendance/input'
import { computeWorkingDays } from '$lib/utils/dates'
import type { AuditContext } from '../types'

function groupByEmployee<T extends { employeeId: string }>(rows: T[]): Map<string, T[]> {
	const map = new Map<string, T[]>()
	for (const row of rows) {
		const list = map.get(row.employeeId) ?? []
		list.push(row)
		map.set(row.employeeId, list)
	}
	return map
}

export async function createPayrollRun(
	organizationId: string,
	periodStart: Date,
	periodEnd: Date,
	ctx: AuditContext
) {
	const existing = await db.payrollRun.findUnique({
		where: { organizationId_periodStart_periodEnd: { organizationId, periodStart, periodEnd } }
	})
	if (existing) error(409, 'Payroll run for this period already exists')

	const run = await db.payrollRun.create({
		data: { organizationId, periodStart, periodEnd }
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'PayrollRun',
		entityId: run.id,
		newValue: { periodStart, periodEnd }
	})

	return run
}

/**
 * Compute a draft payroll run using the earnings/deductions engine and persist itemized
 * PayrollEarning/PayrollDeduction line items (PAY-008).
 *
 * Interim attendance sourcing (until the Attendance engine, Phase 11.3): `regularHours` come
 * from the employee's APPROVED timesheets for the period; when none exist, a monthly-salaried
 * employee is paid for the full scheduled hours (working days × 8). OT/holiday/night-diff buckets
 * are zero until real attendance is available. Statutory contributions are monthly, prorated to the
 * period by pay frequency (semi-monthly ÷2). Loan/cash-advance balances are NOT mutated here —
 * the deduction is computed from current balances and shown as a line item; the actual decrement +
 * LoanPayment happens at lock time (Slice 2, PAY-021), which keeps compute safely re-runnable.
 */
export async function computePayroll(runId: string, organizationId: string, ctx: AuditContext) {
	const run = await db.payrollRun.findFirst({ where: { id: runId, organizationId } })
	if (!run) error(404, 'Payroll run not found')
	// Recomputing a COMPUTED run is safe — entries are wiped and rebuilt in one
	// transaction below. Only approval locks the numbers.
	if (run.status !== 'DRAFT' && run.status !== 'COMPUTED')
		error(400, 'Only draft or computed payroll runs can be computed')

	const [
		employees,
		config,
		earningTypes,
		loansAll,
		advancesAll,
		enrollmentsAll,
		payRateRule,
		recurringAll,
		recurringDeductionsAll,
		holidays
	] = await Promise.all([
		db.employee.findMany({ where: { user: { organizationId }, employmentStatus: 'ACTIVE' } }),
		db.payrollConfig.findUnique({ where: { organizationId } }),
		db.earningType.findMany({ where: { organizationId }, select: { code: true, taxable: true } }),
		db.loan.findMany({
			where: { employee: { organizationId }, status: 'ACTIVE', balance: { gt: 0 } }
		}),
		db.cashAdvance.findMany({
			where: { employee: { organizationId }, status: 'ACTIVE', balance: { gt: 0 } }
		}),
		// Active benefit enrollments whose plan charges the employee (T148).
		db.benefitEnrollment.findMany({
			where: { status: 'ACTIVE', plan: { organizationId, employeeCost: { gt: 0 } } },
			select: { id: true, employeeId: true, plan: { select: { name: true, employeeCost: true } } }
		}),
		db.payRateRule.findUnique({ where: { organizationId } }),
		// Recurring allowance/incentive assignments feed the adjustment buckets (#65).
		db.employeeEarning.findMany({
			where: { employee: { organizationId }, isActive: true }
		}),
		// Recurring custom-deduction assignments from Settings → Pay Codes (#66).
		db.employeeDeduction.findMany({
			where: { employee: { organizationId }, isActive: true, deductionType: { isActive: true } },
			include: { deductionType: { select: { code: true, label: true } } }
		}),
		// Public holidays inside the period — the scheduled-hours fallback below must not
		// bill them as ordinary working days.
		db.publicHoliday.findMany({
			where: {
				organizationId,
				date: { gte: run.periodStart, lte: run.periodEnd }
			},
			select: { date: true }
		})
	])

	// Requirement #1 (review): taxability comes from EarningType config, not hard-coded defaults.
	const taxableByCode = new Map(earningTypes.map((e) => [e.code, e.taxable]))
	// Premium-pay multipliers from PayRateRule (falls back to DOLE defaults when unset).
	const rates = ratesFromRule(payRateRule)
	// Requirement #5 (review): prorate monthly statutory to the period.
	const periodShare = (config?.payFrequency ?? 'SEMI_MONTHLY') === 'MONTHLY' ? 1 : 0.5
	const loansByEmp = groupByEmployee(loansAll)
	const advancesByEmp = groupByEmployee(advancesAll)
	const enrollmentsByEmp = groupByEmployee(enrollmentsAll)
	const recurringByEmp = groupByEmployee(recurringAll)
	const recurringDeductionsByEmp = groupByEmployee(recurringDeductionsAll)
	// Holidays were previously passed as [], so a period containing public holidays
	// counted them as ordinary working days. That inflates `scheduledHours` below, and
	// since BASIC = regularHours * hourlyRate, it inflated basic pay for every employee
	// falling back to the schedule (i.e. with no approved timesheet hours).
	const workingDays = computeWorkingDays(
		run.periodStart,
		run.periodEnd,
		holidays.map((h) => h.date)
	)

	const perEmployee: Array<{
		entry: Prisma.PayrollEntryUncheckedCreateWithoutEarningsInput
		earnings: Array<{ code: string; label: string; amount: number; taxable: boolean }>
		deductions: Array<{ code: string; label: string; amount: number; refId: string | null }>
	}> = []
	// #119: run totals are the exact sum of the entries' already-quantized figures, so the run
	// header reconciles against its entry rows the same way an entry reconciles against its lines.
	let totalGross = ZERO
	let totalDeductions = ZERO
	let totalNet = ZERO

	for (const emp of employees) {
		const comp: EmployeeComp = {
			basicMonthlySalary: emp.basicMonthlySalary,
			rateType: emp.rateType
		}

		const timesheets = await db.timesheet.findMany({
			where: {
				employeeId: emp.id,
				periodStart: { gte: run.periodStart },
				periodEnd: { lte: run.periodEnd },
				status: 'APPROVED'
			},
			include: { entries: true }
		})
		const approvedHours = timesheets
			.flatMap((ts) => ts.entries)
			// Hours, not money — plain number arithmetic is correct here. Named `acc` so it does not
			// shadow the exact-money `sum` helper imported above.
			.reduce((acc, e) => acc + Number(e.hoursWorked), 0)
		const scheduledHours = workingDays * (comp.dailyWorkingHours ?? 8)
		const regularHours = approvedHours > 0 ? approvedHours : scheduledHours

		const loans: AmortItem[] = (loansByEmp.get(emp.id) ?? []).map((l) => ({
			refId: l.id,
			label: l.type ?? 'Loan',
			installment: l.installment,
			balance: l.balance
		}))
		const cashAdvances: AmortItem[] = (advancesByEmp.get(emp.id) ?? []).map((a) => ({
			refId: a.id,
			label: 'Cash advance',
			installment: a.installment,
			balance: a.balance
		}))

		// Prefer derived attendance (OT/holiday/night-diff buckets); fall back to timesheet hours.
		const attInput = await buildAttendanceInput(emp.id, run.periodStart, run.periodEnd)
		const attendance = attInput ?? { ...emptyAttendance(), regularHours }

		// Recurring allowances/incentives, prorated to the period like statutory (#65).
		const recurring = recurringByEmp.get(emp.id) ?? []
		// #119: sum exactly, prorate exactly, quantize once — not sum→round→scale→round.
		const monthlyOf = (kind: 'ALLOWANCE' | 'INCENTIVE') =>
			sum(recurring.filter((r) => r.kind === kind).map((r) => D(r.monthlyAmount)))
		const adjustments = {
			allowances: q2n(monthlyOf('ALLOWANCE').times(periodShare)),
			incentives: q2n(monthlyOf('INCENTIVE').times(periodShare))
		}

		// Shared engine — identical to the Payroll Calculator for the same inputs.
		const result = computeEmployeeResult(comp, attendance, adjustments, {
			taxableByCode,
			rates,
			periodShare,
			// Holiday-aware schedule for the period — values absences for fixed-basic staff (#121).
			expectedHours: scheduledHours,
			loans,
			cashAdvances,
			recurringDeductions: recurringDeductionComponents(
				recurringDeductionsByEmp.get(emp.id) ?? [],
				periodShare
			)
		})
		const paidHours =
			attendance.regularHours +
			attendance.overtimeHours +
			attendance.restDayHours +
			attendance.restDayOtHours +
			attendance.regularHolidayHours +
			attendance.regularHolidayOtHours +
			attendance.specialHolidayHours +
			attendance.specialHolidayOtHours
		const isFlagged = paidHours === 0

		// Fold employee-paid benefit costs into deductions, prorated to the period (T148).
		const benefitDeductions = (enrollmentsByEmp.get(emp.id) ?? []).map((e) => ({
			code: 'BENEFIT',
			label: e.plan.name,
			// Each benefit line quantizes once, here — it is a payable line like any other.
			amount: q2n(D(e.plan.employeeCost).times(periodShare)),
			refId: e.id
		}))
		// Lines-authoritative (#119): totals are sums of already-quantized lines, so the entry
		// reconciles against its printed deduction lines with no residual.
		const benefitTotal = sumQ(benefitDeductions.map((d) => d.amount))
		const entryTotalDeductions = D(result.totalDeductions).plus(benefitTotal).toNumber()
		const entryNetPay = D(result.netPay).minus(benefitTotal).toNumber()

		perEmployee.push({
			entry: {
				payrollRunId: runId,
				employeeId: emp.id,
				hoursWorked: round2(paidHours),
				basicPay: result.basicPay,
				grossPay: result.grossPay,
				sssEe: result.statutory.sssEe,
				sssEr: result.statutory.sssEr,
				philhealthEe: result.statutory.philhealthEe,
				philhealthEr: result.statutory.philhealthEr,
				pagibigEe: result.statutory.pagibigEe,
				pagibigEr: result.statutory.pagibigEr,
				withholdingTax: result.statutory.withholdingTax,
				totalDeductions: entryTotalDeductions,
				netPay: entryNetPay,
				isFlagged,
				flagReason: isFlagged ? 'No hours recorded for period' : null
			},
			earnings: result.earnings.map((c) => ({
				code: c.code,
				label: c.label,
				amount: c.amount,
				taxable: c.taxable
			})),
			deductions: [
				...result.deductions.map((c) => ({
					code: c.code,
					label: c.label,
					amount: c.amount,
					refId: c.refId ?? null
				})),
				...benefitDeductions
			]
		})

		totalGross = totalGross.plus(result.grossPay)
		totalDeductions = totalDeductions.plus(entryTotalDeductions)
		totalNet = totalNet.plus(entryNetPay)
	}

	await db.$transaction(async (tx: Prisma.TransactionClient) => {
		// Cascade deletes the old entries' line items via onDelete: Cascade.
		await tx.payrollEntry.deleteMany({ where: { payrollRunId: runId } })
		for (const p of perEmployee) {
			await tx.payrollEntry.create({
				data: { ...p.entry, earnings: { create: p.earnings }, deductions: { create: p.deductions } }
			})
		}
		await tx.payrollRun.update({
			where: { id: runId },
			data: {
				status: 'COMPUTED',
				totalGross,
				totalDeductions,
				totalNet
			}
		})
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'PayrollRun',
		entityId: runId,
		newValue: {
			status: 'COMPUTED',
			totalGross: totalGross.toNumber(),
			totalNet: totalNet.toNumber()
		}
	})

	return db.payrollRun.findUnique({
		where: { id: runId },
		include: {
			entries: {
				include: {
					employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
					earnings: true,
					deductions: true
				}
			}
		}
	})
}

export async function approvePayroll(runId: string, organizationId: string, ctx: AuditContext) {
	const run = await db.payrollRun.findFirst({ where: { id: runId, organizationId } })
	if (!run) error(404, 'Payroll run not found')
	if (run.status !== 'COMPUTED') error(400, 'Only computed payroll runs can be approved')

	const updated = await db.payrollRun.update({
		where: { id: runId },
		data: { status: 'APPROVED', approvedById: ctx.actorId, approvedAt: new Date() }
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'PayrollRun',
		entityId: runId,
		newValue: { status: 'APPROVED' }
	})

	return updated
}

export async function overridePayrollEntry(
	entryId: string,
	organizationId: string,
	overrides: { netPay?: number; flagReason?: string },
	note: string,
	ctx: AuditContext
) {
	const entry = await db.payrollEntry.findFirst({
		where: { id: entryId, payrollRun: { organizationId } },
		include: { payrollRun: true }
	})
	if (!entry) error(404, 'Payroll entry not found')
	if (entry.payrollRun.status === 'APPROVED') error(400, 'Cannot override approved payroll')

	const updated = await db.payrollEntry.update({
		where: { id: entryId },
		data: { ...overrides, isFlagged: false }
	})

	await db.payrollRun.update({
		where: { id: entry.payrollRunId },
		data: { hasOverride: true, overrideNote: note }
	})

	await writeAuditLog(ctx, {
		action: 'PAYROLL_OVERRIDE',
		entityType: 'PayrollEntry',
		entityId: entryId,
		oldValue: { netPay: Number(entry.netPay) },
		newValue: { ...overrides, note }
	})

	return updated
}

export async function listPayrollRuns(organizationId: string) {
	return db.payrollRun.findMany({
		where: { organizationId },
		orderBy: { periodStart: 'desc' }
	})
}

export async function getPayrollRun(id: string, organizationId: string) {
	const run = await db.payrollRun.findFirst({
		where: { id, organizationId },
		include: {
			entries: {
				include: {
					employee: {
						select: {
							firstName: true,
							lastName: true,
							employeeNumber: true,
							department: { select: { name: true } }
						}
					},
					// Itemized lines for the run-detail breakdown (allowances, incentives,
					// OT, statutory, loans, …) — not just the aggregate columns.
					earnings: true,
					deductions: true
				},
				orderBy: { employee: { lastName: 'asc' } }
			}
		}
	})
	if (!run) error(404, 'Payroll run not found')
	return run
}
