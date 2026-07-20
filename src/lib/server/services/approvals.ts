import { canAny, CAPABILITIES } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { ApprovalDecision, ApprovalStage, Role } from '@prisma/client'
import { applyApprovedRequest } from './requests/apply'
import { notify } from './notifications'
import type { AuditContext } from './types'

// Which capability governs each maker-checker stage (#134). MAKE is branch HR/Manager,
// VERIFY the Verifier, APPROVE the Approver — enforced by capability, not exact role,
// so a promoted Manager makes and a [MANAGER, VERIFIER] user can also verify.
const STAGE_CAPABILITY: Record<ApprovalStage, keyof typeof CAPABILITIES> = {
	MAKE: 'MANAGE_HR',
	VERIFY: 'VERIFY_REQUESTS',
	APPROVE: 'APPROVE_SIGNOFF'
}

export function rolesOf(ctx: AuditContext): Role[] {
	return ctx.actorRoles?.length ? ctx.actorRoles : [ctx.actorRole]
}

// Any maker-checker subject (request/timesheet/payroll run) stores append-only steps.
// This resolves the live attempt and the step currently awaiting a decision (#134), so
// timesheets and payroll reuse the same chain semantics as requests.
export interface ChainStep {
	attempt: number
	stageIndex: number
	stage: ApprovalStage
	decision: ApprovalDecision | null
}
export function liveChain<T extends ChainStep>(steps: T[]) {
	if (!steps.length) return null
	const attempt = Math.max(...steps.map((s) => s.attempt))
	const liveSteps = steps
		.filter((s) => s.attempt === attempt)
		.sort((a, b) => a.stageIndex - b.stageIndex)
	const idx = liveSteps.findIndex((s) => s.decision == null)
	return {
		attempt,
		liveSteps,
		currentStage: idx === -1 ? liveSteps.length - 1 : idx,
		currentStep: idx === -1 ? null : liveSteps[idx]
	}
}

// Can this actor decide the given stage? Separation of duties comes first: nobody acts
// on their own submission. Otherwise the actor must hold the stage's capability with any
// of their roles — a checker may not also be the maker of the same request, which the
// per-stage capabilities and the own-submission guard together enforce.
export function canActOnStage(
	stage: ApprovalStage,
	actorRoles: Role[],
	actorEmployeeId: string | null,
	ownerEmployeeId: string | null
): boolean {
	if (actorEmployeeId != null && actorEmployeeId === ownerEmployeeId) return false
	return canAny(actorRoles, STAGE_CAPABILITY[stage])
}

// Pure transition: given the current stage / chain length / decision, what are the
// request's next status and currentStage? A RETURNED decision sends the item back to the
// maker's queue; REJECTED is a terminal denial. APPROVED advances (or commits on the
// last stage).
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

// Act on the request's current stage of its latest attempt. `actorEmployeeId` is the
// deciding user's own employee id (needed for the separation-of-duties guard).
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
			steps: { orderBy: [{ attempt: 'asc' }, { stageIndex: 'asc' }] },
			employee: { select: { reportsToId: true, userId: true } }
		}
	})
	if (!req) error(404, 'Request not found')
	if (req.status !== 'PENDING')
		error(400, `Request is ${req.status.toLowerCase()}, not open for decisions`)

	// #75: separation of duties — nobody decides their own request.
	if (actorEmployeeId != null && actorEmployeeId === req.employeeId) {
		error(403, 'You cannot decide your own request')
	}

	// Only the latest attempt is live; earlier attempts are frozen history (#134).
	const attempt = Math.max(...req.steps.map((s) => s.attempt))
	const liveSteps = req.steps.filter((s) => s.attempt === attempt)
	const step = liveSteps.find((s) => s.stageIndex === req.currentStage)
	if (!step) error(500, 'Approval chain is inconsistent')

	if (!canActOnStage(step.stage, rolesOf(ctx), actorEmployeeId, req.employeeId)) {
		error(403, 'You cannot act on this stage')
	}
	// A returned reason is required so the maker knows what to fix.
	if ((decision === 'RETURNED' || decision === 'REJECTED') && !note?.trim()) {
		error(400, 'A reason is required to return or reject a request')
	}

	const transition = nextState(req.currentStage, liveSteps.length, decision)

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
		newValue: { attempt, stage: step.stage, decision, status: transition.status }
	})

	// On full approval, apply the request to attendance/payroll state.
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

	// Notify the requester of the outcome.
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

// Pending requests this user can act on right now (their stage is the live one).
export async function listPendingRequestsForApprover(
	organizationId: string,
	actorRoles: Role[],
	actorEmployeeId: string | null
) {
	const pending = await db.request.findMany({
		where: { status: 'PENDING', employee: { user: { organizationId } } },
		include: {
			steps: { orderBy: [{ attempt: 'asc' }, { stageIndex: 'asc' }] },
			employee: { select: { id: true, firstName: true, lastName: true, reportsToId: true } },
			documents: { select: { id: true, verifiedAt: true } }
		},
		orderBy: { createdAt: 'asc' }
	})

	return pending.filter((r) => {
		const attempt = Math.max(...r.steps.map((s) => s.attempt))
		const step = r.steps.find((s) => s.attempt === attempt && s.stageIndex === r.currentStage)
		return step != null && canActOnStage(step.stage, actorRoles, actorEmployeeId, r.employeeId)
	})
}

// Roles that can reach the approvals surface (includes the sign-off roles now).
export const APPROVER_ROLES: readonly Role[] = CAPABILITIES.APPROVE_REQUESTS

export interface PendingApprovalCounts {
	timesheets: number
	requests: number
	total: number
}

// Count items awaiting this user's decision — pending requests at their live stage and
// SUBMITTED timesheets they can approve — split for the sidebar dropdown. Zeros for
// non-approver roles.
export async function countPendingApprovals(user: {
	id: string
	role: Role
	roles?: Role[]
	organizationId: string
}): Promise<PendingApprovalCounts> {
	const roles = user.roles?.length ? user.roles : [user.role]
	if (!canAny(roles, 'APPROVE_REQUESTS')) return { timesheets: 0, requests: 0, total: 0 }

	const myEmployee = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true }
	})

	// Timesheets now run the maker-checker chain too (#134): a user can act on one whose
	// live stage they hold (make/verify/approve). Count those awaiting them.
	const canReviewTimesheets =
		canAny(roles, 'MANAGE_HR') ||
		canAny(roles, 'VERIFY_REQUESTS') ||
		canAny(roles, 'APPROVE_SIGNOFF')

	const [requests, timesheetCount] = await Promise.all([
		listPendingRequestsForApprover(user.organizationId, roles, myEmployee?.id ?? null),
		canReviewTimesheets
			? countActionableTimesheets(user.organizationId, roles, myEmployee?.id ?? null)
			: Promise.resolve(0)
	])

	return {
		timesheets: timesheetCount,
		requests: requests.length,
		total: timesheetCount + requests.length
	}
}

// SUBMITTED timesheets whose live maker-checker stage this user can act on (#134).
async function countActionableTimesheets(
	organizationId: string,
	roles: Role[],
	actorEmployeeId: string | null
): Promise<number> {
	const submitted = await db.timesheet.findMany({
		where: {
			status: 'SUBMITTED',
			...(actorEmployeeId ? { employeeId: { not: actorEmployeeId } } : {}),
			employee: { user: { organizationId } }
		},
		select: {
			employeeId: true,
			approvalSteps: { select: { attempt: true, stageIndex: true, stage: true, decision: true } }
		}
	})
	return submitted.filter((ts) => {
		const live = liveChain(ts.approvalSteps)
		// Legacy step-less timesheets remain manager-ladder actionable.
		if (!live || !live.currentStep) return canAny(roles, 'VIEW_TEAM')
		return canActOnStage(live.currentStep.stage, roles, actorEmployeeId, ts.employeeId)
	}).length
}
