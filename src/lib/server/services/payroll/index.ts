import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { computeStatutoryDeductions } from './ph-statutory'
import type { AuditContext } from '../types'

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

export async function computePayroll(
	runId: string,
	organizationId: string,
	ctx: AuditContext
) {
	const run = await db.payrollRun.findFirst({ where: { id: runId, organizationId } })
	if (!run) error(404, 'Payroll run not found')
	if (run.status !== 'DRAFT') error(400, 'Only draft payroll runs can be computed')

	const employees = await db.employee.findMany({
		where: { user: { organizationId }, employmentStatus: 'ACTIVE' }
	})

	const WORKING_DAYS_PER_MONTH = 22
	const periodDays = Math.ceil(
		(run.periodEnd.getTime() - run.periodStart.getTime()) / (1000 * 60 * 60 * 24)
	) + 1

	const entries = []
	let totalGross = 0
	let totalDeductions = 0
	let totalNet = 0

	for (const emp of employees) {
		const dailyRate = Number(emp.basicMonthlySalary) / WORKING_DAYS_PER_MONTH
		const grossPay = dailyRate * periodDays

		const statutory = computeStatutoryDeductions(Number(emp.basicMonthlySalary))

		const periodFraction = periodDays / WORKING_DAYS_PER_MONTH
		const periodDeductions = statutory.totalDeductions * periodFraction
		const periodNet = grossPay - periodDeductions

		const timesheets = await db.timesheet.findMany({
			where: {
				employeeId: emp.id,
				periodStart: { gte: run.periodStart },
				periodEnd: { lte: run.periodEnd },
				status: 'APPROVED'
			},
			include: { entries: true }
		})

		const hoursWorked = timesheets
			.flatMap((ts: { entries: Array<{ hoursWorked: unknown }> }) => ts.entries)
			.reduce((sum: number, e: { hoursWorked: unknown }) => sum + Number(e.hoursWorked), 0)

		const isFlagged = hoursWorked === 0 && emp.rateType === 'HOURLY'

		entries.push({
			payrollRunId: runId,
			employeeId: emp.id,
			hoursWorked,
			basicPay: grossPay,
			grossPay,
			sssEe: statutory.sssEe * periodFraction,
			sssEr: statutory.sssEr * periodFraction,
			philhealthEe: statutory.philhealthEe * periodFraction,
			philhealthEr: statutory.philhealthEr * periodFraction,
			pagibigEe: statutory.pagibigEe * periodFraction,
			pagibigEr: statutory.pagibigEr * periodFraction,
			withholdingTax: statutory.withholdingTax * periodFraction,
			totalDeductions: periodDeductions,
			netPay: periodNet,
			isFlagged,
			flagReason: isFlagged ? 'No approved timesheet for period' : null
		})

		totalGross += grossPay
		totalDeductions += periodDeductions
		totalNet += periodNet
	}

	await db.$transaction([
		db.payrollEntry.deleteMany({ where: { payrollRunId: runId } }),
		db.payrollEntry.createMany({ data: entries }),
		db.payrollRun.update({
			where: { id: runId },
			data: { status: 'COMPUTED', totalGross, totalDeductions, totalNet }
		})
	])

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'PayrollRun',
		entityId: runId,
		newValue: { status: 'COMPUTED', totalGross, totalNet }
	})

	return db.payrollRun.findUnique({
		where: { id: runId },
		include: { entries: { include: { employee: { select: { firstName: true, lastName: true, employeeNumber: true } } } } }
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
					}
				},
				orderBy: { employee: { lastName: 'asc' } }
			}
		}
	})
	if (!run) error(404, 'Payroll run not found')
	return run
}
