import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { Prisma, type Role } from '@prisma/client'
import { canAny } from '$lib/rbac'
import { computeEmployeeResult } from './calculator'
import { compensationForPeriod } from './compensation'
import { ratesFromRule } from './rates'
import { statutoryRatesFromConfig } from './statutory-rates'
import { type AmortItem } from './deductions'
import { recurringDeductionComponents } from './employee-deductions'
import {
	statutoryExemptions,
	employerShareExternals,
	statutoryAllocations
} from './employee-statutory'
import { D, q2n, sum, ZERO } from './money'
import { emptyAttendance, round2, type EmployeeComp } from './types'
import { buildAttendanceInput } from '../attendance/input'
import { computeWorkingDays } from '$lib/utils/dates'
import { describePeriod, isValidStandardPeriod, periodShareOf } from '$lib/utils/pay-periods'
import { ensurePayrollApprovalChain } from '../approvals'
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
	ctx: AuditContext,
	// Escape hatch for seeds / legacy imports only (#129).
	opts: { allowNonStandardPeriod?: boolean } = {}
) {
	if (!opts.allowNonStandardPeriod && !isValidStandardPeriod(periodStart, periodEnd)) {
		error(400, 'Payroll runs must cover a standard pay period (1–15, 16–EOM, or the whole month)')
	}

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

	// Compute in the same request (#138): the numbers are deterministic given attendance, so
	// making HR click a separate "Compute" was friction without a decision attached. The run
	// comes back COMPUTED; "Recompute" on the detail page re-derives it after later edits
	// (e.g. assigning a recurring allowance).
	await computePayroll(run.id, organizationId, ctx)

	return db.payrollRun.findUniqueOrThrow({ where: { id: run.id } })
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
		statutoryRateConfig,
		recurringAll,
		recurringDeductionsAll,
		statutoryExemptAll,
		statutoryExternalAll,
		statutoryAllocationAll,
		compensationAll,
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
		// Org statutory rate overrides (#220) — one optional org row, resolved to effective rates below.
		db.statutoryRateConfig.findUnique({ where: { organizationId } }),
		// Recurring allowance/incentive assignments feed the adjustment buckets (#65).
		db.employeeEarning.findMany({
			where: { employee: { organizationId }, isActive: true }
		}),
		// Recurring custom-deduction assignments from Settings → Pay Codes (#66).
		db.employeeDeduction.findMany({
			where: { employee: { organizationId }, isActive: true, deductionType: { isActive: true } },
			include: { deductionType: { select: { code: true, label: true } } }
		}),
		// Per-employee statutory exemptions (#173) — only the exempt rows matter; enrolled is
		// the default (no row). Grouped by employee like the other per-employee data below.
		db.employeeStatutoryConfig.findMany({
			where: { employee: { organizationId }, exempt: true },
			select: { employeeId: true, contribution: true }
		}),
		// Per-employee "employer share paid externally" (#173, Feature C) — zeroes the ER share only.
		// Mirrors the exempt fetch/grouping; independent flag on the same config row.
		db.employeeStatutoryConfig.findMany({
			where: { employee: { organizationId }, employerSharePaidExternally: true },
			select: { employeeId: true, contribution: true }
		}),
		// Per-employee EE-share cutoff allocation (#173, Feature E) — only non-EVEN rows matter; EVEN
		// is the default (half split). Grouped by employee like the other per-employee data below.
		db.employeeStatutoryConfig.findMany({
			where: { employee: { organizationId }, allocation: { not: 'EVEN' } },
			select: { employeeId: true, contribution: true, allocation: true }
		}),
		// #170: effective-dated compensation history for every employee, so the resolver can
		// day-split a run that straddles a salary change and lag statutory to decision B. Ordered
		// ascending so a same-day change's later `changedAt` wins the tiebreak; grouped by employee
		// below like the other per-employee data. An employee with no rows falls back to their
		// current cache, reproducing the pre-#170 numbers exactly.
		db.employeeCompensation.findMany({
			where: { employee: { organizationId } },
			orderBy: [{ effectiveDate: 'asc' }, { changedAt: 'asc' }]
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
	// #220: statutory tables from StatutoryRateConfig (falls back to the hardcoded PH defaults when
	// unset). Resolved once and threaded into the shared engine identically to the preview.
	const statutoryRates = statutoryRatesFromConfig(statutoryRateConfig)
	// Requirement #5 (review) + #129: prorate monthly statutory to the run's ACTUAL period
	// shape — WHOLE_MONTH carries the full month (1), either half carries 0.5. This replaces
	// reading the org-wide payFrequency, which mis-prorated an org that mixes half-month and
	// whole-month (e.g. benefits-only) runs. Legacy non-standard runs fall back to the old
	// frequency-based share so their numbers don't shift.
	const frequencyShare = (config?.payFrequency ?? 'SEMI_MONTHLY') === 'MONTHLY' ? 1 : 0.5
	const periodShare = periodShareOf(run.periodStart, run.periodEnd, frequencyShare)
	// #173 (Feature E): the run's cutoff kind, computed once, drives EE-share allocation in the
	// engine. WHOLE_MONTH/legacy periods (null) make allocation moot — the engine falls back to
	// `× periodShare` there.
	const periodKind = describePeriod(run.periodStart, run.periodEnd).kind
	const loansByEmp = groupByEmployee(loansAll)
	const advancesByEmp = groupByEmployee(advancesAll)
	const enrollmentsByEmp = groupByEmployee(enrollmentsAll)
	const recurringByEmp = groupByEmployee(recurringAll)
	const recurringDeductionsByEmp = groupByEmployee(recurringDeductionsAll)
	const statutoryExemptByEmp = groupByEmployee(statutoryExemptAll)
	const statutoryExternalByEmp = groupByEmployee(statutoryExternalAll)
	const statutoryAllocationByEmp = groupByEmployee(statutoryAllocationAll)
	const compensationByEmp = groupByEmployee(compensationAll)
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
		// #170: resolve the period's compensation from the effective-dated history (holiday-aware
		// working-day weighting). With no history it returns a single full-period segment whose
		// weight is exactly `periodShare` and `statutoryBasis === periodEnd`, so everything below
		// reduces to the pre-#170 behaviour.
		const periodComp = compensationForPeriod(
			compensationByEmp.get(emp.id) ?? [],
			run.periodStart,
			run.periodEnd,
			periodShare,
			{ basicMonthlySalary: emp.basicMonthlySalary, rateType: emp.rateType },
			(s, e) =>
				computeWorkingDays(
					s,
					e,
					holidays.map((h) => h.date)
				)
		)
		// Period-end comp drives basic/premium/tardiness rates — NOT the current cache, which for a
		// past run with a later change would be too high.
		const comp: EmployeeComp = {
			basicMonthlySalary: periodComp.periodEnd.salary,
			rateType: periodComp.periodEnd.rateType
		}
		// Decision B: statutory always follows the day-1-of-month comp (every rate type).
		const statutoryComp: EmployeeComp = {
			basicMonthlySalary: periodComp.statutoryBasis.salary,
			rateType: periodComp.statutoryBasis.rateType
		}
		// Stage 1 day-splits basic ONLY for a pure MONTHLY salary-amount split (>1 segment, every
		// segment MONTHLY). A pay-type flip or an hourly/daily split is Stage 2 — there the single
		// full-period FIXED path / today's hourly path stands, while statutory still lags correctly.
		const segments = periodComp.segments
		const basicSegments =
			segments.length > 1 && segments.every((s) => s.rateType === 'MONTHLY') ? segments : undefined

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

		// Employee-paid benefit costs, prorated to the period (T148). These go INTO the engine as
		// discretionary deductions rather than being subtracted from net afterwards (#103) — a
		// post-hoc subtraction bypasses the affordability gate and can drive net negative again.
		const benefitDeductions = (enrollmentsByEmp.get(emp.id) ?? []).map((e) => ({
			code: 'BENEFIT',
			label: e.plan.name,
			// Each benefit line quantizes once, here — it is a payable line like any other.
			amount: q2n(D(e.plan.employeeCost).times(periodShare)),
			taxable: false,
			refId: e.id
		}))

		// Shared engine — identical to the Payroll Calculator for the same inputs.
		const result = computeEmployeeResult(comp, attendance, adjustments, {
			taxableByCode,
			rates,
			statutoryRates,
			periodShare,
			// #170: decision-B statutory basis (always) and the MONTHLY day-split (when safe).
			statutoryComp,
			basicSegments,
			// Holiday-aware schedule for the period — values absences for fixed-basic staff (#121).
			expectedHours: scheduledHours,
			statutoryExemptions: statutoryExemptions(statutoryExemptByEmp.get(emp.id) ?? []),
			employerShareExternal: employerShareExternals(statutoryExternalByEmp.get(emp.id) ?? []),
			statutoryAllocations: statutoryAllocations(statutoryAllocationByEmp.get(emp.id) ?? []),
			periodKind,
			loans,
			cashAdvances,
			recurringDeductions: [
				...recurringDeductionComponents(recurringDeductionsByEmp.get(emp.id) ?? [], periodShare),
				...benefitDeductions
			]
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
		// #103: a floored net is never silent — it means deductions outran gross and someone has to
		// look at it. Zero paid hours stays a separate, more specific reason.
		const isFlagged = paidHours === 0 || result.uncollected > 0
		const flagReason =
			paidHours === 0
				? 'No hours recorded for period'
				: result.uncollected > 0
					? `Deductions exceed pay — ₱${result.uncollected.toFixed(2)} uncollected`
					: null

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
				totalDeductions: result.totalDeductions,
				netPay: result.netPay,
				isFlagged,
				flagReason
			},
			earnings: result.earnings.map((c) => ({
				code: c.code,
				label: c.label,
				amount: c.amount,
				taxable: c.taxable
			})),
			// Benefits are already among `result.deductions` — the engine took them through the same
			// affordability gate as every other discretionary line (#103).
			deductions: result.deductions.map((c) => ({
				code: c.code,
				label: c.label,
				amount: c.amount,
				refId: c.refId ?? null
			}))
		})

		totalGross = totalGross.plus(result.grossPay)
		totalDeductions = totalDeductions.plus(result.totalDeductions)
		totalNet = totalNet.plus(result.netPay)
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

	// Open (or reopen, after a return) the maker-checker chain (#134). The computing
	// user is the maker; the chain enters at VERIFY. A recompute during an open review
	// is a no-op here, so numbers can be re-derived without disturbing sign-offs.
	await ensurePayrollApprovalChain(runId, ctx.actorId)

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

// Finance approvers (CEO / Super Admin) are the company-wide finance authority and reach
// every tenant's payroll to sign it off (#174); everyone else is scoped to their own org.
// Passing no roles keeps the strict org filter — callers opt into the wider scope.
export function payrollOrgFilter(organizationId: string, roles?: Role[]) {
	return roles && canAny(roles, 'APPROVE_FINANCE') ? {} : { organizationId }
}

export async function listPayrollRuns(organizationId: string, roles?: Role[]) {
	return db.payrollRun.findMany({
		where: payrollOrgFilter(organizationId, roles),
		orderBy: { periodStart: 'desc' },
		include: { organization: { select: { name: true } } }
	})
}

export async function getPayrollRun(id: string, organizationId: string, roles?: Role[]) {
	const run = await db.payrollRun.findFirst({
		where: { id, ...payrollOrgFilter(organizationId, roles) },
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
			},
			// Maker-checker chain (#134), append-only across attempts, with the acting
			// user's email for attribution in the history view.
			approvalSteps: {
				include: { actor: { select: { email: true } } },
				orderBy: [{ attempt: 'asc' }, { stageIndex: 'asc' }]
			}
		}
	})
	if (!run) error(404, 'Payroll run not found')
	return run
}
