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

/**
 * Authorize a mutation of `ts`: the owner may act on their own timesheet (callers apply the
 * status rules — e.g. draft-only); managers/HR act per their direct-reports scope. A non-owner
 * without a management role is rejected. Returns whether the actor owns the timesheet.
 */
async function assertCanModify(
	ctx: AuditContext,
	ts: { employeeId: string; employee: { reportsToId: string | null } }
) {
	const actorEmployee = await db.employee.findUnique({
		where: { userId: ctx.actorId },
		select: { id: true }
	})
	const isOwner = actorEmployee?.id === ts.employeeId
	if (isOwner) return { isOwner: true }
	if (['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'].includes(ctx.actorRole)) {
		await assertManagesEmployee(ctx, ts.employee.reportsToId)
		return { isOwner: false }
	}
	error(403, 'You can only modify your own timesheet')
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
	const { isOwner } = await assertCanModify(ctx, ts)
	// The owner may only change their own DRAFT (e.g. sync from attendance); managers/HR may edit
	// anything that isn't already APPROVED.
	if (isOwner && ts.status !== 'DRAFT') error(400, 'You can only edit your own draft timesheet')
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
 * Delete a timesheet (entries cascade). The owner may delete their own DRAFT/REJECTED; managers
 * are scoped to their direct reports and HR/super act org-wide (any status). Deletion is explicit
 * (confirmed in the UI), never automatic.
 */
export async function deleteTimesheet(id: string, organizationId: string, ctx: AuditContext) {
	const ts = await getTimesheet(id, organizationId)
	const { isOwner } = await assertCanModify(ctx, ts)
	// The owner may delete only their own DRAFT/REJECTED timesheet — not once it's submitted (under
	// review) or approved (locked). Managers/HR keep the broader scope handled by assertCanModify.
	if (isOwner && ts.status !== 'DRAFT' && ts.status !== 'REJECTED')
		error(400, 'You can only delete your own draft timesheet')

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

/**
 * HR submits an aggregated draft on the employee's behalf. HR builds a draft from time
 * logs on /timesheets (they don't own it, so the owner-only `submitTimesheet` can't be
 * used); this moves it to SUBMITTED so it lands in the normal review queue — /timesheets
 * never approves in place. Only DRAFT timesheets are eligible. Managers are scoped to
 * their direct reports. The update and its audit log share one transaction.
 */
export async function submitDraftByHr(id: string, organizationId: string, ctx: AuditContext) {
	const ts = await getTimesheet(id, organizationId)
	await assertManagesEmployee(ctx, ts.employee.reportsToId)
	if (ts.status !== 'DRAFT') error(400, 'Only draft timesheets can be submitted here')

	return db.$transaction(async (tx) => {
		const updated = await tx.timesheet.update({
			where: { id },
			data: { status: 'SUBMITTED', submittedAt: new Date() }
		})

		await writeAuditLog(
			ctx,
			{
				action: 'UPDATE',
				entityType: 'Timesheet',
				entityId: id,
				oldValue: { status: ts.status },
				newValue: { status: 'SUBMITTED', source: 'hr_submit_on_behalf' }
			},
			tx
		)

		return updated
	})
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
