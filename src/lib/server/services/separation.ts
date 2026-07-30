import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import type { SeparationType } from '@prisma/client'
import type { AuditContext } from './types'
import { clearanceTemplateForOrg } from './offboarding'
import { currentCompensation } from './payroll/compensation'
import { sendOffboardingNoticeEmail } from '$lib/server/notifications'

// Average paid working days per month — used to convert a monthly salary to a
// daily rate for unused-leave conversion. A deliberate, adjustable simplification;
// swap for the DOLE factor (313/12) if payroll policy requires it.
const WORKING_DAYS_PER_MONTH = 22

export interface CreateSeparationInput {
	employeeId: string
	type: SeparationType
	effectiveDate: Date
	reason?: string
}

export async function createSeparation(
	organizationId: string,
	input: CreateSeparationInput,
	ctx: AuditContext
) {
	const employee = await db.employee.findFirst({
		where: { id: input.employeeId, organizationId },
		select: {
			id: true,
			employmentStatus: true,
			firstName: true,
			lastName: true,
			user: { select: { email: true } }
		}
	})
	if (!employee) error(404, 'Employee not found')
	if (employee.employmentStatus === 'OFFBOARDED') error(409, 'Employee is already offboarded')

	const existing = await db.separationRecord.findFirst({
		where: { employeeId: input.employeeId, status: { not: 'FINALIZED' } },
		select: { id: true }
	})
	if (existing) error(409, 'An open separation case already exists for this employee')

	// Seed the case's clearance items from the org's editable offboarding checklist (#192),
	// falling back to the built-in defaults when none are configured.
	const clearance = await clearanceTemplateForOrg(organizationId)

	const record = await db.separationRecord.create({
		data: {
			organizationId,
			employeeId: input.employeeId,
			type: input.type,
			effectiveDate: input.effectiveDate,
			reason: input.reason || null,
			clearanceItems: { create: clearance }
		}
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'SeparationRecord',
		entityId: record.id,
		newValue: { employeeId: input.employeeId, type: input.type, effectiveDate: input.effectiveDate }
	})

	// Email the departing employee a due-diligence / transition-period notice with their
	// effective date and the clearance checklist (#185). Best-effort: a notifier failure
	// must not roll back an opened case.
	try {
		sendOffboardingNoticeEmail(employee.user.email, {
			employeeName: `${employee.firstName} ${employee.lastName}`,
			effectiveDate: input.effectiveDate,
			checklist: clearance
		})
	} catch (e) {
		console.error('[NOTIFY] Failed to email offboarding notice for', record.id, e)
	}

	return record
}

export async function listSeparations(organizationId: string) {
	return db.separationRecord.findMany({
		where: { organizationId },
		orderBy: { createdAt: 'desc' },
		include: {
			employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
			clearanceItems: { select: { status: true } }
		}
	})
}

export async function getSeparation(id: string, organizationId: string) {
	const record = await db.separationRecord.findFirst({
		where: { id, organizationId },
		include: {
			employee: {
				select: {
					id: true,
					firstName: true,
					lastName: true,
					employeeNumber: true,
					jobTitle: true,
					employmentStatus: true,
					department: { select: { name: true } }
				}
			},
			clearanceItems: { orderBy: { department: 'asc' } }
		}
	})
	if (!record) error(404, 'Separation record not found')
	return record
}

export async function setClearanceItem(
	itemId: string,
	organizationId: string,
	cleared: boolean,
	ctx: AuditContext
) {
	const item = await db.clearanceItem.findFirst({
		where: { id: itemId, separation: { organizationId } },
		include: { separation: { select: { id: true, status: true } } }
	})
	if (!item) error(404, 'Clearance item not found')
	if (item.separation.status === 'FINALIZED') error(409, 'Separation is already finalized')

	await db.clearanceItem.update({
		where: { id: itemId },
		data: {
			status: cleared ? 'CLEARED' : 'PENDING',
			clearedById: cleared ? ctx.actorId : null,
			clearedAt: cleared ? new Date() : null
		}
	})

	// Roll the parent status forward/back so the finalize gate reflects the checklist.
	const remaining = await db.clearanceItem.count({
		where: { separationId: item.separation.id, status: 'PENDING' }
	})
	await db.separationRecord.update({
		where: { id: item.separation.id },
		data: { status: remaining === 0 ? 'CLEARED' : 'OPEN' }
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'ClearanceItem',
		entityId: itemId,
		newValue: { status: cleared ? 'CLEARED' : 'PENDING' }
	})
}

export interface FinalPayLine {
	label: string
	amount: number // positive = pay to employee, negative = deducted/owed
}

export interface FinalPayResult {
	lines: FinalPayLine[]
	total: number
}

// Snapshot-style final pay: unused paid-leave conversion, minus outstanding loan
// and cash-advance balances. Prorated 13th-month and tax refunds are out of scope
// here (they need YTD payroll) and can be layered on later.
export async function computeFinalPay(
	separationId: string,
	organizationId: string
): Promise<FinalPayResult> {
	const record = await getSeparation(separationId, organizationId)
	const employeeId = record.employee.id

	const [employee, compHistory, leaveBalances, loans, cashAdvances] = await Promise.all([
		db.employee.findUniqueOrThrow({
			where: { id: employeeId },
			select: { basicMonthlySalary: true, rateType: true }
		}),
		// #170 Stage 1.5: final pay reads salary directly (not via getEmployee), so resolve the comp in
		// effect on the separation date from history — a raise effective by then must reach final pay.
		db.employeeCompensation.findMany({
			where: { employeeId },
			select: { basicMonthlySalary: true, rateType: true, effectiveDate: true, changedAt: true }
		}),
		db.leaveBalance.findMany({
			where: { employeeId, year: record.effectiveDate.getFullYear() },
			select: { remaining: true }
		}),
		db.loan.findMany({ where: { employeeId, status: 'ACTIVE' }, select: { balance: true } }),
		db.cashAdvance.findMany({
			where: { employeeId, status: 'ACTIVE' },
			select: { balance: true }
		})
	])

	const comp = currentCompensation(compHistory, record.effectiveDate, {
		basicMonthlySalary: employee.basicMonthlySalary,
		rateType: employee.rateType
	})
	const rate = comp.salary.toNumber()
	// #189: the stored figure means something different per basis (mirror payslip-document.ts). Dividing
	// an hourly/daily rate by the monthly working days would understate the day value 176×/22×.
	const dailyRate =
		comp.rateType === 'HOURLY'
			? rate * 8
			: comp.rateType === 'DAILY'
				? rate
				: rate / WORKING_DAYS_PER_MONTH
	const leaveDays = leaveBalances.reduce((sum, b) => sum + Number(b.remaining), 0)
	const leaveConversion = round2(leaveDays * dailyRate)
	const loanBalance = round2(loans.reduce((sum, l) => sum + Number(l.balance), 0))
	const caBalance = round2(cashAdvances.reduce((sum, c) => sum + Number(c.balance), 0))

	const lines: FinalPayLine[] = [
		{ label: `Unused leave conversion (${leaveDays.toFixed(2)} days)`, amount: leaveConversion },
		{ label: 'Outstanding loan balances', amount: -loanBalance },
		{ label: 'Outstanding cash advances', amount: -caBalance }
	]
	const total = round2(lines.reduce((sum, l) => sum + l.amount, 0))
	return { lines, total }
}

// Finalize: requires all clearance items CLEARED. Snapshots final pay, marks the
// employee OFFBOARDED (endDate = effectiveDate), and deactivates their login.
export async function finalizeSeparation(id: string, organizationId: string, ctx: AuditContext) {
	const record = await getSeparation(id, organizationId)
	if (record.status === 'FINALIZED') error(409, 'Separation is already finalized')

	const pending = record.clearanceItems.filter((i) => i.status !== 'CLEARED').length
	if (pending > 0) error(409, `Cannot finalize — ${pending} clearance item(s) still pending`)

	const finalPay = await computeFinalPay(id, organizationId)

	await db.$transaction(async (tx) => {
		// Status-guarded update: the check above is only preliminary — a concurrent
		// finalize between it and here would otherwise double-snapshot.
		const updated = await tx.separationRecord.updateMany({
			where: { id, status: { not: 'FINALIZED' } },
			data: {
				status: 'FINALIZED',
				finalPayAmount: new Prisma.Decimal(finalPay.total),
				finalPayBreakdown: finalPay as unknown as Prisma.InputJsonValue,
				finalizedAt: new Date(),
				finalizedById: ctx.actorId
			}
		})
		if (updated.count === 0) error(409, 'Separation is already finalized')

		// The outstanding balances were offset against final pay above — settle them
		// so they don't linger as ACTIVE receivables on an offboarded employee.
		await tx.loan.updateMany({
			where: { employeeId: record.employee.id, status: 'ACTIVE' },
			data: { balance: 0, status: 'PAID' }
		})
		await tx.cashAdvance.updateMany({
			where: { employeeId: record.employee.id, status: 'ACTIVE' },
			data: { balance: 0, status: 'PAID' }
		})

		await tx.employee.update({
			where: { id: record.employee.id },
			data: { employmentStatus: 'OFFBOARDED', endDate: record.effectiveDate }
		})
		await tx.user.updateMany({
			where: { employee: { id: record.employee.id } },
			data: { isActive: false }
		})
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'SeparationRecord',
		entityId: id,
		newValue: { status: 'FINALIZED', finalPayAmount: finalPay.total }
	})

	return finalPay
}

// Separation report rows for the Reports module / CSV export.
export async function generateSeparationReport(
	organizationId: string,
	range: { startDate: Date; endDate: Date }
) {
	const records = await db.separationRecord.findMany({
		where: {
			organizationId,
			effectiveDate: { gte: range.startDate, lte: range.endDate }
		},
		orderBy: { effectiveDate: 'desc' },
		include: {
			employee: {
				select: {
					firstName: true,
					lastName: true,
					employeeNumber: true,
					department: { select: { name: true } }
				}
			},
			clearanceItems: { select: { status: true } }
		}
	})

	// TitleCase keys: the report table renders row[column] and the CSV export uses
	// the keys as headers, matching the other report generators.
	return records.map((r) => {
		const cleared = r.clearanceItems.filter((c) => c.status === 'CLEARED').length
		return {
			EmployeeNumber: r.employee.employeeNumber,
			Employee: `${r.employee.lastName}, ${r.employee.firstName}`,
			Department: r.employee.department?.name ?? '',
			Type: r.type,
			EffectiveDate: r.effectiveDate.toISOString().slice(0, 10),
			Status: r.status,
			Clearance: `${cleared}/${r.clearanceItems.length}`,
			FinalPay: r.finalPayAmount ? Number(r.finalPayAmount).toFixed(2) : ''
		}
	})
}

function round2(n: number) {
	return Math.round(n * 100) / 100
}
