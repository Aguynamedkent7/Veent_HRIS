import type { ApprovalStage, Role } from '@prisma/client'

// Three-stage maker-checker chain (#134). Every request is MADE (branch HR / Manager),
// VERIFIED (Verifier), then APPROVED (Approver). Stage authority is a capability,
// enforced in approvals.ts; `requiredRole` is the canonical holder the UI displays and
// the seed provisions. The old per-type Supervisor→HR→Payroll routing is retired — the
// customer's process is a uniform maker-checker for every request type.
export const MAKER_CHECKER_CHAIN: { stage: ApprovalStage; requiredRole: Role }[] = [
	{ stage: 'MAKE', requiredRole: 'HR_ADMIN' },
	{ stage: 'VERIFY', requiredRole: 'VERIFIER' },
	{ stage: 'APPROVE', requiredRole: 'APPROVER' }
]

export interface NewStep {
	attempt: number
	stageIndex: number
	stageKind: 'ROLE'
	stage: ApprovalStage
	role: Role
	requiredRole: Role
	decision?: 'APPROVED'
	actorId?: string
	decidedAt?: Date
}

// Build one attempt's three steps. When the filer is the maker (holds MANAGE_HR), the
// MAKE step is completed at file-time and the chain enters at VERIFY; otherwise MAKE is
// pending and branch HR acts on it first (employee → HR → verifier → approver).
export function buildApprovalChain(opts: {
	attempt: number
	makerUserId: string | null
	decidedAt: Date
}): { steps: NewStep[]; currentStage: number } {
	const steps: NewStep[] = MAKER_CHECKER_CHAIN.map((s, i) => {
		const base: NewStep = {
			attempt: opts.attempt,
			stageIndex: i,
			stageKind: 'ROLE',
			stage: s.stage,
			role: s.requiredRole,
			requiredRole: s.requiredRole
		}
		if (s.stage === 'MAKE' && opts.makerUserId) {
			return {
				...base,
				decision: 'APPROVED',
				actorId: opts.makerUserId,
				decidedAt: opts.decidedAt
			}
		}
		return base
	})
	// currentStage = the first stage still pending (0 when MAKE is open, 1 when the filer
	// was the maker and MAKE auto-completed).
	const firstPending = steps.findIndex((s) => s.decision == null)
	return { steps, currentStage: firstPending === -1 ? steps.length - 1 : firstPending }
}
