import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { AuditContext } from './types'

interface TimesheetEntryInput {
	date: Date
	timeIn?: Date | null
	timeOut?: Date | null
	hoursWorked: number
	otHours?: number
	notes?: string
}

// Persist-shape for an entry row (fills defaults for the optional columns).
function entryData(e: TimesheetEntryInput) {
	return {
		date: e.date,
		timeIn: e.timeIn ?? null,
		timeOut: e.timeOut ?? null,
		hoursWorked: e.hoursWorked,
		otHours: e.otHours ?? 0,
		notes: e.notes
	}
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
			entries: { create: entries.map(entryData) }
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

/**
 * Replace a timesheet's entries and recompute its total (HR review edits). Managers are scoped
 * to their direct reports; approved timesheets are locked. Runs in a transaction so the entries
 * and total stay consistent.
 */
export async function updateTimesheetEntries(
	id: string,
	organizationId: string,
	entries: TimesheetEntryInput[],
	ctx: AuditContext
) {
	const ts = await getTimesheet(id, organizationId)
	await assertManagesEmployee(ctx, ts.employee.reportsToId)
	if (ts.status === 'APPROVED') error(400, 'Approved timesheets cannot be edited')

	const totalHours = entries.reduce((sum, e) => sum + e.hoursWorked, 0)

	const updated = await db.$transaction(async (tx) => {
		await tx.timesheetEntry.deleteMany({ where: { timesheetId: id } })
		return tx.timesheet.update({
			where: { id },
			data: {
				totalHours,
				entries: {
					create: entries.map(entryData)
				}
			},
			include: { entries: { orderBy: { date: 'asc' } } }
		})
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Timesheet',
		entityId: id,
		oldValue: { entries: ts.entries.length, totalHours: Number(ts.totalHours) },
		newValue: { entries: entries.length, totalHours }
	})

	return updated
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

/**
 * Delete a timesheet of any status (entries cascade). Managers are scoped to their direct
 * reports; HR/super act org-wide. Deletion is explicit (confirmed in the UI), never automatic.
 */
export async function deleteTimesheet(id: string, organizationId: string, ctx: AuditContext) {
	const ts = await getTimesheet(id, organizationId)
	await assertManagesEmployee(ctx, ts.employee.reportsToId)

	await db.timesheet.delete({ where: { id } })

	await writeAuditLog(ctx, {
		action: 'DELETE',
		entityType: 'Timesheet',
		entityId: id,
		oldValue: {
			periodStart: ts.periodStart,
			periodEnd: ts.periodEnd,
			status: ts.status,
			entries: ts.entries.length
		}
	})

	return { deleted: true }
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
