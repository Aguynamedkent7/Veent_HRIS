import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { ApprovalDecision, Role } from '@prisma/client'
import { applyApprovedRequest } from './requests/apply'
import { notify } from './notifications'
import type { AuditContext } from './types'

type StageShape = { stageKind: 'SUPERVISOR' | 'ROLE'; role: Role | null }

// Can this actor decide the given stage? SUPER_ADMIN overrides everything; a
// SUPERVISOR stage is only the employee's direct supervisor; a ROLE stage requires
// the exact role (keeps HR / Payroll separation intentional).
export function canActOnStage(
	step: StageShape,
	actorRole: Role,
	actorEmployeeId: string | null,
	employeeReportsToId: string | null
): boolean {
	if (actorRole === 'SUPER_ADMIN') return true
	if (step.stageKind === 'SUPERVISOR') {
		return actorEmployeeId != null && actorEmployeeId === employeeReportsToId
	}
	return actorRole === step.role
}

// Pure transition: given the current stage / chain length / decision, what are the
// request's next status and currentStage?
export function nextState(
	currentStage: number,
	stepCount: number,
	decision: ApprovalDecision
): { status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RETURNED'; currentStage: number } {
	if (decision === 'REJECTED') return { status: 'REJECTED', currentStage }
	if (decision === 'RETURNED') return { status: 'RETURNED', currentStage }
	// APPROVED
	const isLast = currentStage >= stepCount - 1
	return isLast
		? { status: 'APPROVED', currentStage }
		: { status: 'PENDING', currentStage: currentStage + 1 }
}

// Act on the request's current stage. `actorEmployeeId` is the deciding user's own
// employee id (needed to authorize SUPERVISOR stages).
export async function decide(
	requestId: string,
	decision: ApprovalDecision,
	note: string | undefined,
	ctx: AuditContext,
	actorEmployeeId: string | null
) {
	const req = await db.request.findFirst({
		where: { id: requestId, employee: { user: { organizationId: ctx.organizationId } } },
		include: {
			steps: { orderBy: { stageIndex: 'asc' } },
			employee: { select: { reportsToId: true, userId: true } }
		}
	})
	if (!req) error(404, 'Request not found')
	if (req.status !== 'PENDING')
		error(400, `Request is ${req.status.toLowerCase()}, not open for decisions`)

	const step = req.steps.find((s) => s.stageIndex === req.currentStage)
	if (!step) error(500, 'Approval chain is inconsistent')
	if (!canActOnStage(step, ctx.actorRole, actorEmployeeId, req.employee.reportsToId)) {
		error(403, 'You cannot act on this stage')
	}

	const transition = nextState(req.currentStage, req.steps.length, decision)

	await db.$transaction([
		db.approvalStep.update({
			where: { id: step.id },
			data: { decision, actorId: ctx.actorId, note: note ?? null, decidedAt: new Date() }
		}),
		db.request.update({
			where: { id: req.id },
			data: { status: transition.status, currentStage: transition.currentStage }
		})
	])

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Request',
		entityId: req.id,
		newValue: { stage: req.currentStage, decision, status: transition.status }
	})

	// On full approval, apply the request to attendance/payroll state. Time-based
	// requests (OT/rest-day/holiday/leave) are consumed lazily by the attendance
	// derivation; INFO_UPDATE writes the employee field here.
	if (transition.status === 'APPROVED') {
		await applyApprovedRequest(
			{
				id: req.id,
				type: req.type,
				employeeId: req.employeeId,
				dateFrom: req.dateFrom,
				payload: req.payload
			},
			ctx
		)
	}

	// Notify the requester of the outcome (final approval / rejection / return).
	const label = req.type.replace(/_/g, ' ').toLowerCase()
	const verb =
		transition.status === 'APPROVED'
			? 'approved'
			: transition.status === 'REJECTED'
				? 'rejected'
				: transition.status === 'RETURNED'
					? 'returned for correction'
					: null
	if (verb) {
		await notify(req.employee.userId, `Your ${label} request was ${verb}.`, `/requests/${req.id}`)
	}

	return { status: transition.status, currentStage: transition.currentStage }
}

// Pending requests this user can act on right now (their stage is the current one).
export async function listPendingRequestsForApprover(
	organizationId: string,
	actorRole: Role,
	actorEmployeeId: string | null
) {
	const pending = await db.request.findMany({
		where: { status: 'PENDING', employee: { user: { organizationId } } },
		include: {
			steps: { orderBy: { stageIndex: 'asc' } },
			employee: { select: { id: true, firstName: true, lastName: true, reportsToId: true } }
		},
		orderBy: { createdAt: 'asc' }
	})

	return pending.filter((r) => {
		const step = r.steps.find((s) => s.stageIndex === r.currentStage)
		return step != null && canActOnStage(step, actorRole, actorEmployeeId, r.employee.reportsToId)
	})
}
