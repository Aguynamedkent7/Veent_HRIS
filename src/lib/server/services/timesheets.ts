import { can } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { buildApprovalChain } from './requests/routing'
import { canActOnStage, nextState, liveChain, rolesOf } from './approvals'
import type { AuditContext } from './types'
import type { Prisma } from '@prisma/client'

// Create the maker-checker chain for a timesheet (#134). When a maker (MANAGE_HR)
// submits on the employee's behalf, MAKE completes now; when the employee submits
// their own, MAKE stays pending for branch HR. Runs inside the submit transaction.
async function createTimesheetChain(
	tx: Prisma.TransactionClient,
	timesheetId: string,
	makerUserId: string | null
) {
	const { steps } = buildApprovalChain({ attempt: 1, makerUserId, decidedAt: new Date() })
	await tx.approvalStep.createMany({ data: steps.map((s) => ({ ...s, timesheetId })) })
}

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

interface TimesheetListParams {
	organizationId: string
	employeeId?: string
	/** List everyone except this employee (the managers' "team" table). */
	excludeEmployeeId?: string
	status?: string
}

function timesheetListWhere(params: TimesheetListParams) {
	return {
		employee: { user: { organizationId: params.organizationId } },
		...(params.employeeId && { employeeId: params.employeeId }),
		...(params.excludeEmployeeId && { employeeId: { not: params.excludeEmployeeId } }),
		...(params.status && { status: params.status as never })
	}
}

export async function countTimesheets(params: TimesheetListParams) {
	return db.timesheet.count({ where: timesheetListWhere(params) })
}

export async function listTimesheets(
	params: TimesheetListParams,
	pageArgs?: { skip: number; take: number }
) {
	return db.timesheet.findMany({
		where: timesheetListWhere(params),
		include: {
			employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } },
			entries: { orderBy: { date: 'asc' } }
		},
		orderBy: { periodStart: 'desc' },
		...(pageArgs && { skip: pageArgs.skip, take: pageArgs.take })
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
	if (can(ctx.actorRole, 'VIEW_TEAM')) {
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

	const updated = await db.$transaction(async (tx) => {
		const ts2 = await tx.timesheet.update({
			where: { id },
			data: { status: 'SUBMITTED', submittedAt: new Date() }
		})
		// The employee submits their own, so MAKE stays pending for branch HR (#134).
		await createTimesheetChain(tx, id, null)
		return ts2
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
		// Re-check DRAFT inside the write itself — a concurrent submit or review between
		// the read above and this update must not be stomped back to SUBMITTED.
		const res = await tx.timesheet.updateMany({
			where: { id, status: 'DRAFT' },
			data: { status: 'SUBMITTED', submittedAt: new Date() }
		})
		if (res.count === 0) error(400, 'Only draft timesheets can be submitted here')
		// HR submits on the employee's behalf, so they are the maker — MAKE completes now
		// and the chain opens at VERIFY (#134).
		await createTimesheetChain(tx, id, ctx.actorId)

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

		return tx.timesheet.findUniqueOrThrow({ where: { id } })
	})
}

// Act on a timesheet's current maker-checker stage (#134). `approved` advances the chain
// (final APPROVE commits it); otherwise it returns to the maker with a required reason.
// Legacy timesheets submitted before the chain existed have no steps and fall back to the
// old direct manager review.
export async function reviewTimesheet(
	id: string,
	organizationId: string,
	approved: boolean,
	rejectionReason: string | undefined,
	ctx: AuditContext
) {
	const ts = await db.timesheet.findFirst({
		where: { id, employee: { user: { organizationId } } },
		include: { employee: { select: { reportsToId: true } }, approvalSteps: true }
	})
	if (!ts) error(404, 'Timesheet not found')
	if (ts.status !== 'SUBMITTED') error(400, 'Only submitted timesheets can be reviewed')

	// #75: separation of duties — nobody reviews their own timesheet.
	const actorEmployee = await db.employee.findUnique({
		where: { userId: ctx.actorId },
		select: { id: true }
	})
	if (actorEmployee && actorEmployee.id === ts.employeeId) {
		error(403, 'You cannot review your own timesheet')
	}

	const live = liveChain(ts.approvalSteps)

	// Legacy fallback: a step-less timesheet reviews directly under manager scope.
	if (!live || !live.currentStep) {
		await assertManagesEmployee(ctx, ts.employee.reportsToId)
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

	const step = live.currentStep
	if (!canActOnStage(step.stage, rolesOf(ctx), actorEmployee?.id ?? null, ts.employeeId)) {
		error(403, 'You cannot act on this stage')
	}
	const decision = approved ? 'APPROVED' : 'RETURNED'
	if (!approved && !rejectionReason?.trim()) {
		error(400, 'A reason is required to return a timesheet')
	}

	const transition = nextState(live.currentStage, live.liveSteps.length, decision)
	const tsStatus =
		transition.status === 'APPROVED'
			? 'APPROVED'
			: transition.status === 'RETURNED' || transition.status === 'REJECTED'
				? 'REJECTED'
				: 'SUBMITTED'
	const settled = tsStatus !== 'SUBMITTED'

	const updated = await db.$transaction(async (tx) => {
		await tx.approvalStep.update({
			where: { id: step.id },
			data: {
				decision,
				actorId: ctx.actorId,
				note: approved ? null : (rejectionReason ?? null),
				decidedAt: new Date()
			}
		})
		return tx.timesheet.update({
			where: { id },
			data: {
				status: tsStatus,
				...(settled ? { reviewedAt: new Date(), reviewedById: ctx.actorId } : {}),
				rejectionReason: tsStatus === 'REJECTED' ? (rejectionReason ?? null) : null
			}
		})
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Timesheet',
		entityId: id,
		newValue: { stage: step.stage, decision, status: tsStatus }
	})

	return updated
}
