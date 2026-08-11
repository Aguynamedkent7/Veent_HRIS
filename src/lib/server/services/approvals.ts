import { canAny, CAPABILITIES } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import { listActionableProposals } from './action-proposals'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { ApprovalDecision, ApprovalStage, Role } from '@prisma/client'
import { applyApprovedRequest, type AppliedEffect } from './requests/apply'
import { buildApprovalChain } from './requests/routing'
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

// Payroll runs are financial sign-offs, so their chain routes the final APPROVE stage
// to the finance approvers — CEO / Super Admin — not the generic APPROVER (#174). MAKE is
// the payroll preparer (auto-completed at compute, never decided here); VERIFY is shared.
const PAYROLL_STAGE_CAPABILITY: Record<ApprovalStage, keyof typeof CAPABILITIES> = {
	MAKE: 'MANAGE_PAYROLL',
	VERIFY: 'VERIFY_REQUESTS',
	APPROVE: 'APPROVE_FINANCE'
}

export function rolesOf(ctx: AuditContext): Role[] {
	return ctx.actorRoles
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
	ownerEmployeeId: string | null,
	stageCapability: Record<ApprovalStage, keyof typeof CAPABILITIES> = STAGE_CAPABILITY
): boolean {
	if (actorEmployeeId != null && actorEmployeeId === ownerEmployeeId) return false
	return canAny(actorRoles, stageCapability[stage])
}

// Payroll variant: the final APPROVE routes to the finance approvers (CEO / Super Admin,
// #174). A run has no employee owner, so the separation-of-duties owner args are null and
// the maker-vs-signer guard is applied by the caller against the MAKE step's actorId.
export function canActOnPayrollStage(stage: ApprovalStage, actorRoles: Role[]): boolean {
	return canActOnStage(stage, actorRoles, null, null, PAYROLL_STAGE_CAPABILITY)
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

	// The step/request flip AND the on-approval effect (leave-balance deduction /
	// INFO_UPDATE write) must commit atomically (#101). Previously the effect ran in a
	// separate call after the flip, so a failure or crash between them left the request
	// permanently APPROVED with the balance never deducted — free leave, with no reversal
	// path. Running the effect on the same `tx` rolls the approval back if it fails.
	const applied = await db.$transaction(async (tx): Promise<AppliedEffect | null> => {
		await tx.approvalStep.update({
			where: { id: step.id },
			data: { decision, actorId: ctx.actorId, note: note ?? null, decidedAt: new Date() }
		})
		await tx.request.update({
			where: { id: req.id },
			data: { status: transition.status, currentStage: transition.currentStage }
		})
		if (transition.status === 'APPROVED') {
			return applyApprovedRequest(tx, {
				id: req.id,
				type: req.type,
				employeeId: req.employeeId,
				dateFrom: req.dateFrom,
				payload: req.payload
			})
		}
		return null
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Request',
		entityId: req.id,
		newValue: { attempt, stage: step.stage, decision, status: transition.status }
	})

	// Audit the applied effect after commit — mirrors the request-decision log above and
	// avoids an orphan entry if the transaction had rolled back.
	if (applied) {
		await writeAuditLog(ctx, {
			action: 'UPDATE',
			entityType: applied.kind === 'LEAVE' ? 'LeaveBalance' : 'Employee',
			entityId: req.employeeId,
			newValue:
				applied.kind === 'LEAVE'
					? { leaveTypeId: applied.leaveTypeId, deducted: applied.deducted, viaRequest: req.id }
					: { [applied.column]: applied.value, viaRequest: req.id }
		})
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
		await notify(
			req.employee.userId,
			`Your ${label} request was ${verb}.`,
			`/requests/${req.id}`,
			'REQUEST'
		)
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
	payrollRuns: number
	/** Pay changes awaiting this user's confirmation (#224 Part 2 / #243). */
	proposals: number
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
	// Harmless for proposals too: every confirmer capability (ADMINISTER_HR_ORGWIDE /
	// APPROVE_FINANCE) is held only by HR_ADMIN, CEO and SUPER_ADMIN, all of whom hold
	// APPROVE_REQUESTS — so no confirmer is short-circuited here.
	if (!canAny(roles, 'APPROVE_REQUESTS'))
		return { timesheets: 0, requests: 0, payrollRuns: 0, proposals: 0, total: 0 }

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

	const [requests, timesheetCount, payrollRunCount, proposals] = await Promise.all([
		listPendingRequestsForApprover(user.organizationId, roles, myEmployee?.id ?? null),
		canReviewTimesheets
			? countActionableTimesheets(user.organizationId, roles, myEmployee?.id ?? null)
			: Promise.resolve(0),
		countActionablePayrollRuns(user.organizationId, roles, user.id),
		// Same "run the filtered list, take .length" shape as requests. Notifications are one-shot
		// toasts marked read on the next page load, so without this badge a proposal filed while the
		// confirmer was away leaves no standing trace anywhere in the UI.
		listActionableProposals(user.organizationId, { actorId: user.id, roles })
	])

	return {
		timesheets: timesheetCount,
		requests: requests.length,
		payrollRuns: payrollRunCount,
		proposals: proposals.length,
		total: timesheetCount + requests.length + payrollRunCount + proposals.length
	}
}

// COMPUTED payroll runs whose live maker-checker stage this user can sign off (#134).
// Only the sign-off roles act on runs; the maker of the live attempt is excluded (SoD).
async function countActionablePayrollRuns(
	organizationId: string,
	roles: Role[],
	userId: string
): Promise<number> {
	if (!canAny(roles, 'VERIFY_REQUESTS') && !canAny(roles, 'APPROVE_FINANCE')) return 0
	// A finance approver counts pending runs across every tenant they sign off for (#174);
	// a Verifier only sees their own org's queue.
	const financeApprover = canAny(roles, 'APPROVE_FINANCE')
	const runs = await db.payrollRun.findMany({
		where: { status: 'COMPUTED', ...(financeApprover ? {} : { organizationId }) },
		select: {
			approvalSteps: {
				select: {
					id: true,
					attempt: true,
					stageIndex: true,
					stage: true,
					decision: true,
					actorId: true
				}
			}
		}
	})
	return runs.filter((r) => {
		const live = livePayrollStage(r.approvalSteps)
		if (!live?.currentStep) return false
		const makeActorId = r.approvalSteps.find(
			(s) => s.attempt === live.attempt && s.stage === 'MAKE'
		)?.actorId
		return canActOnPayrollStage(live.currentStep.stage, roles) && makeActorId !== userId
	}).length
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

// ─── Payroll-run approval chain (#134) ──────────────────────────────────────────
//
// A payroll run adopts the same maker → verifier → approver chain as requests and
// timesheets, but keyed on `payrollRunId`. Two differences shape the helpers below:
//
//   1. A run has no `currentStage` column — the live stage is derived from the
//      append-only steps via liveChain(), exactly like timesheets.
//   2. PayrollRunStatus has no RETURNED state. A returned run stays COMPUTED and the
//      maker recomputes to refile; so a "returned" attempt must read as *closed*
//      (no open stage) until a recompute opens a fresh attempt — otherwise a later
//      stage's null step would look actionable and let an approver skip the return.

export interface PayrollChainStep extends ChainStep {
	id: string
	actorId: string | null
}

// The live, still-actionable stage of a run's chain, or null when the latest attempt
// is closed (fully approved, or returned/rejected and awaiting a recompute).
export function livePayrollStage(steps: PayrollChainStep[]) {
	const live = liveChain(steps)
	if (!live) return null
	// A return/reject halts the attempt: nothing further can be acted on until the maker
	// recomputes, which starts a new attempt.
	const halted = live.liveSteps.some((s) => s.decision === 'RETURNED' || s.decision === 'REJECTED')
	if (halted || !live.currentStep) return { ...live, currentStep: null }
	return live
}

// Ensure a computed run has an open approval chain. Called at the end of compute:
// creates attempt 1 (MAKE auto-completed by the computing user, entering VERIFY) on the
// first compute, and opens a fresh attempt after a return. A recompute while the chain
// is still open is a no-op, so re-deriving numbers mid-review doesn't disturb sign-offs.
export async function ensurePayrollApprovalChain(runId: string, makerUserId: string) {
	const steps = await db.approvalStep.findMany({
		where: { payrollRunId: runId },
		orderBy: [{ attempt: 'asc' }, { stageIndex: 'asc' }]
	})
	if (livePayrollStage(steps)?.currentStep) return // chain already open

	const attempt = steps.length ? Math.max(...steps.map((s) => s.attempt)) + 1 : 1
	const { steps: newSteps } = buildApprovalChain({
		attempt,
		makerUserId,
		decidedAt: new Date()
	})
	await db.approvalStep.createMany({
		data: newSteps.map((s) => ({
			payrollRunId: runId,
			attempt: s.attempt,
			stageIndex: s.stageIndex,
			stageKind: s.stageKind,
			stage: s.stage,
			role: s.role,
			requiredRole: s.requiredRole,
			decision: s.decision ?? null,
			actorId: s.actorId ?? null,
			decidedAt: s.decidedAt ?? null
		}))
	})
}

// Act on a run's current maker-checker stage. `approved` advances the chain (final
// APPROVE commits the run to APPROVED); otherwise the run is returned to the maker with
// a required reason and stays COMPUTED for recompute/refile. Separation of duties: the
// user who prepared (MADE) the attempt cannot verify or approve it.
export async function decidePayrollRun(
	runId: string,
	organizationId: string,
	approved: boolean,
	note: string | undefined,
	ctx: AuditContext
) {
	// A finance approver (CEO / Super Admin) signs off payroll for every tenant, so they
	// reach a run by id alone; everyone else stays scoped to their own org (#174).
	const financeApprover = canAny(rolesOf(ctx), 'APPROVE_FINANCE')
	const run = await db.payrollRun.findFirst({
		where: { id: runId, ...(financeApprover ? {} : { organizationId }) },
		include: { approvalSteps: true }
	})
	if (!run) error(404, 'Payroll run not found')
	if (run.status !== 'COMPUTED') error(400, 'Only computed payroll runs can be reviewed')

	const live = livePayrollStage(run.approvalSteps)
	if (!live || !live.currentStep) error(400, 'This run has no open approval stage')

	const step = live.currentStep
	const roles = rolesOf(ctx)
	// Stage authority is a capability (VERIFY → Verifier, APPROVE → finance approver:
	// CEO / Super Admin, #174). No employee owner exists for a run, so the owner-based
	// guard args are null.
	if (!canActOnPayrollStage(step.stage, roles)) {
		error(403, 'You cannot act on this stage')
	}
	// Separation of duties: the maker of this attempt may not sign it off.
	const makeStep = run.approvalSteps.find((s) => s.attempt === live.attempt && s.stage === 'MAKE')
	if (makeStep?.actorId && makeStep.actorId === ctx.actorId) {
		error(403, 'You cannot sign off a payroll run you prepared')
	}

	const decision: ApprovalDecision = approved ? 'APPROVED' : 'RETURNED'
	if (!approved && !note?.trim()) error(400, 'A reason is required to return a payroll run')

	const transition = nextState(live.currentStage, live.liveSteps.length, decision)
	const finalApproved = transition.status === 'APPROVED'

	await db.$transaction(async (tx) => {
		await tx.approvalStep.update({
			where: { id: step.id },
			data: {
				decision,
				actorId: ctx.actorId,
				note: approved ? null : (note ?? null),
				decidedAt: new Date()
			}
		})
		if (finalApproved) {
			await tx.payrollRun.update({
				where: { id: runId },
				data: { status: 'APPROVED', approvedById: ctx.actorId, approvedAt: new Date() }
			})
		}
	})

	// A cross-tenant finance approval belongs in the run's tenant audit trail, not the
	// approver's home org — log against the run's organization (#174).
	await writeAuditLog(
		{ ...ctx, organizationId: run.organizationId },
		{
			action: 'UPDATE',
			entityType: 'PayrollRun',
			entityId: runId,
			newValue: {
				attempt: live.attempt,
				stage: step.stage,
				decision,
				status: finalApproved ? 'APPROVED' : 'COMPUTED'
			}
		}
	)

	return { status: finalApproved ? 'APPROVED' : 'COMPUTED', stage: step.stage, decision }
}
