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
			employee: { select: { id: true, firstName: true, lastName: true, reportsToId: true } },
			// Surfaced on the approval card so a reviewer sees at a glance whether
			// supporting documents exist and still need verification.
			documents: { select: { id: true, verifiedAt: true } }
		},
		orderBy: { createdAt: 'asc' }
	})

	return pending.filter((r) => {
		const step = r.steps.find((s) => s.stageIndex === r.currentStage)
		return step != null && canActOnStage(step, actorRole, actorEmployeeId, r.employee.reportsToId)
	})
}

// Roles that can reach the approvals surface. Payroll Officer sits on the Payroll
// stage of request chains; timesheet approval is MANAGER+ only.
export const APPROVER_ROLES: Role[] = ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN', 'PAYROLL_OFFICER']

export interface PendingApprovalCounts {
	timesheets: number
	requests: number
	total: number
}

// Count items awaiting this user's decision — pending requests at their stage and
// SUBMITTED timesheets they can approve — split by type for the sidebar dropdown
// dot + per-child badges. Zeros for non-approver roles.
export async function countPendingApprovals(user: {
	id: string
	role: Role
	organizationId: string
}): Promise<PendingApprovalCounts> {
	if (!APPROVER_ROLES.includes(user.role)) return { timesheets: 0, requests: 0, total: 0 }

	const myEmployee = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true }
	})

	const isManagerLadder = ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)
	const isAdmin = ['HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)
	// A non-admin manager scopes to their direct reports, so without an employee record
	// there is nothing to scope by — count 0 rather than falling through to org-wide.
	const canCountTimesheets = isManagerLadder && (isAdmin || Boolean(myEmployee))

	const [requests, timesheets] = await Promise.all([
		listPendingRequestsForApprover(user.organizationId, user.role, myEmployee?.id ?? null),
		canCountTimesheets
			? db.timesheet.count({
					where: {
						status: 'SUBMITTED',
						employee: {
							user: { organizationId: user.organizationId },
							...(!isAdmin ? { reportsToId: myEmployee!.id } : {})
						}
					}
				})
			: Promise.resolve(0)
	])

	return { timesheets, requests: requests.length, total: timesheets + requests.length }
}
