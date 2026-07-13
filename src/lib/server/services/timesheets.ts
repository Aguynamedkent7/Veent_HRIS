import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { AuditContext } from './types'

interface TimesheetEntryInput {
	date: Date
	hoursWorked: number
	notes?: string
}

export async function listTimesheets(params: {
	organizationId: string
	employeeId?: string
	status?: string
}) {
	return db.timesheet.findMany({
		where: {
			employee: { user: { organizationId: params.organizationId } },
			...(params.employeeId && { employeeId: params.employeeId }),
			...(params.status && { status: params.status as never })
		},
		include: {
			employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
			entries: { orderBy: { date: 'asc' } }
		},
		orderBy: { periodStart: 'desc' }
	})
}

export async function getTimesheet(id: string, organizationId: string) {
	const ts = await db.timesheet.findFirst({
		where: { id, employee: { user: { organizationId } } },
		include: {
			employee: { select: { id: true, firstName: true, lastName: true, reportsToId: true } },
			entries: { orderBy: { date: 'asc' } }
		}
	})
	if (!ts) error(404, 'Timesheet not found')
	return ts
}

/**
 * A plain MANAGER may only act on resources belonging to their direct reports.
 * HR_ADMIN / SUPER_ADMIN act org-wide. Throws 403 otherwise.
 */
async function assertManagesEmployee(ctx: AuditContext, reportsToId: string | null) {
	if (ctx.actorRole !== 'MANAGER') return
	const actorEmployee = await db.employee.findUnique({
		where: { userId: ctx.actorId },
		select: { id: true }
	})
	if (!actorEmployee || reportsToId !== actorEmployee.id) {
		error(403, 'You can only review items for your direct reports')
	}
}

export async function createTimesheet(
	employeeId: string,
	periodStart: Date,
	periodEnd: Date,
	entries: TimesheetEntryInput[],
	ctx: AuditContext
) {
	const existing = await db.timesheet.findUnique({
		where: { employeeId_periodStart: { employeeId, periodStart } }
	})
	if (existing) error(409, 'Timesheet for this period already exists')

	const totalHours = entries.reduce((sum, e) => sum + e.hoursWorked, 0)

	const ts = await db.timesheet.create({
		data: {
			employeeId,
			periodStart,
			periodEnd,
			totalHours,
			entries: { create: entries }
		},
		include: { entries: true }
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'Timesheet',
		entityId: ts.id,
		newValue: { periodStart, periodEnd, totalHours }
	})

	return ts
}

export async function submitTimesheet(id: string, employeeId: string, ctx: AuditContext) {
	const ts = await db.timesheet.findUnique({ where: { id } })
	if (!ts || ts.employeeId !== employeeId) error(404, 'Timesheet not found')
	if (ts.status !== 'DRAFT') error(400, 'Only draft timesheets can be submitted')

	const updated = await db.timesheet.update({
		where: { id },
		data: { status: 'SUBMITTED', submittedAt: new Date() }
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Timesheet',
		entityId: id,
		newValue: { status: 'SUBMITTED' }
	})

	return updated
}

export async function reviewTimesheet(
	id: string,
	organizationId: string,
	approved: boolean,
	rejectionReason: string | undefined,
	ctx: AuditContext
) {
	const ts = await getTimesheet(id, organizationId)
	await assertManagesEmployee(ctx, ts.employee.reportsToId)
	if (ts.status !== 'SUBMITTED') error(400, 'Only submitted timesheets can be reviewed')

	const updated = await db.timesheet.update({
		where: { id },
		data: {
			status: approved ? 'APPROVED' : 'REJECTED',
			reviewedAt: new Date(),
			reviewedById: ctx.actorId,
			rejectionReason: approved ? null : rejectionReason
		}
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Timesheet',
		entityId: id,
		newValue: { status: updated.status, rejectionReason }
	})

	return updated
}
