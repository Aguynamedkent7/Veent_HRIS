import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuditContext } from '$lib/server/services/types'
import type { ApprovalStage, Role } from '@prisma/client'

/**
 * Separation of duties in the approval chain — the two enforcement points that had no test.
 *
 * `canActOnStage`'s own-submission rule is already covered as a pure function
 * (approvals.test.ts), but neither service-level guard was: `decide` re-checks ownership
 * independently of the stage capability, and `decidePayrollRun` compares the signer against the
 * MAKE step's actor. The payroll one matters most and was the least reachable — the e2e suite
 * routes deliberately around it ("The maker is the admin, so the CEO acts here",
 * payroll-approval.spec.ts) — so nothing exercised the case of a preparer signing off their own
 * run until now.
 *
 * These pin behaviour that already ships. They are regression tests, not new rules.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		request: { findFirst: vi.fn(), update: vi.fn() },
		payrollRun: { findFirst: vi.fn(), update: vi.fn() },
		approvalStep: { update: vi.fn() },
		$transaction: vi.fn()
	}
}))

vi.mock('$lib/server/db', () => ({ db: dbMock }))
const { writeAuditLogMock } = vi.hoisted(() => ({
	writeAuditLogMock: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: writeAuditLogMock }))
vi.mock('$lib/server/services/notifications', () => ({
	notify: vi.fn().mockResolvedValue(undefined)
}))

const { decide, decidePayrollRun, canActOnStage, decidedActorIds, usedDocVerifierCarveOut } =
	await import('$lib/server/services/approvals')

const OWNER_EMP = 'emp-owner'
const MAKER_USER = 'user-maker'

const ctxOf = (over: Partial<AuditContext> = {}): AuditContext => ({
	organizationId: 'org1',
	actorId: 'user-other',
	actorRoles: ['HR_ADMIN'],
	...over
})

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.$transaction.mockImplementation(async (arg: unknown) =>
		typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(dbMock) : arg
	)
})

describe('decide — nobody decides their own request (#75)', () => {
	// A PENDING request owned by OWNER_EMP, sitting on its first stage.
	const pendingRequest = {
		id: 'req1',
		employeeId: OWNER_EMP,
		// No payload, so approving it applies no leave-balance effect — the ownership check is
		// what these exercise, not the effect.
		type: 'LEAVE',
		payload: null,
		status: 'PENDING',
		currentStage: 0,
		steps: [{ id: 's1', attempt: 1, stageIndex: 0, stage: 'MAKE', decision: null }],
		// #283: decide() now includes documents for the F3 bar; without this key req.documents.map
		// throws before any guard runs and every case here dies on a TypeError.
		documents: [],
		employee: { reportsToId: null, userId: 'user-owner' }
	}

	beforeEach(() => dbMock.request.findFirst.mockResolvedValue(pendingRequest))

	it('refuses when the actor is the request’s own employee', async () => {
		await expect(decide('req1', 'APPROVED', undefined, ctxOf(), OWNER_EMP)).rejects.toMatchObject({
			status: 403,
			body: { message: 'You cannot decide your own request' }
		})
		expect(dbMock.$transaction).not.toHaveBeenCalled()
	})

	// The guard keys on the employee id, not the role — holding the stage capability must not buy
	// a way around it. Asserting the message, not just the 403: `canActOnStage` refuses self-action
	// too, so a status-only assertion would still pass with this guard deleted and prove nothing
	// about which layer stopped it.
	it('refuses even when the actor holds the stage capability', async () => {
		await expect(
			decide('req1', 'APPROVED', undefined, ctxOf({ actorRoles: ['SUPER_ADMIN'] }), OWNER_EMP)
		).rejects.toMatchObject({
			status: 403,
			body: { message: 'You cannot decide your own request' }
		})
	})

	// Asserting the decision actually reaches the transaction, not merely that it failed for some
	// other reason — a catch-all would pass just as well if the guard rejected everyone.
	it('lets a different employee past the ownership check', async () => {
		await expect(
			decide('req1', 'APPROVED', undefined, ctxOf(), 'emp-someone-else')
		).resolves.toBeDefined()
		expect(dbMock.$transaction).toHaveBeenCalled()
	})

	// AC-22 — the carve-out is a privileged waiver of a two-person control, so it leaves a mark.
	// Both halves matter: present when used, ABSENT otherwise. A marker that fires on every
	// decision tells you nothing, and would be worse than none at all.
	describe('the ADMINISTER_SYSTEM carve-out is audited (#283/AC-22)', () => {
		const withSignedDoc = (signerId: string) =>
			dbMock.request.findFirst.mockResolvedValue({
				...pendingRequest,
				documents: [{ verifiedById: signerId }]
			})

		const requestAudit = () =>
			writeAuditLogMock.mock.calls.find((c) => c[1]?.entityType === 'Request')?.[1]

		it('stamps selfVerifiedEvidence when a CEO decides evidence they signed', async () => {
			withSignedDoc('user-ceo')
			await decide(
				'req1',
				'APPROVED',
				undefined,
				ctxOf({ actorId: 'user-ceo', actorRoles: ['CEO'] }),
				'emp-someone-else'
			)
			expect(requestAudit()?.newValue).toMatchObject({ selfVerifiedEvidence: true })
		})

		it('omits the key entirely on an ordinary decision', async () => {
			withSignedDoc('user-somebody-else')
			await decide(
				'req1',
				'APPROVED',
				undefined,
				ctxOf({ actorId: 'user-ceo', actorRoles: ['CEO'] }),
				'emp-someone-else'
			)
			expect(requestAudit()?.newValue).not.toHaveProperty('selfVerifiedEvidence')
		})
	})
})

// ─── #283/F1 — one actor may not decide two stages of the same attempt ──────────────────────
//
// Multi-role is what makes this reachable: a [VERIFIER, APPROVER] user holds both stages'
// capabilities, so before commit 1 of #283 there was no way to produce the state and after it
// there is. These are pure-function cases; the wiring that feeds `sod` is covered by the service
// cases below and by approval-queues.test.ts.
describe('canActOnStage — the same-attempt bar (#283/F1)', () => {
	const TWO_HAT: Role[] = ['VERIFIER', 'APPROVER']
	const barred = (ids: string[]) => ({
		actorId: 'user-two-hat',
		decidedActorIds: ids,
		verifiedDocActorIds: []
	})

	// AC-9
	it('bars an actor from a second stage of the same attempt', () => {
		expect(canActOnStage('APPROVE', TWO_HAT, 'emp-a', 'emp-owner', barred(['user-two-hat']))).toBe(
			false
		)
	})

	// AC-11 — every stage pairing, not just the VERIFY→APPROVE one people picture.
	it('covers MAKE+VERIFY, VERIFY+APPROVE and all three', () => {
		const all: Role[] = ['HR_ADMIN', 'VERIFIER', 'APPROVER']
		for (const stage of ['MAKE', 'VERIFY', 'APPROVE'] as ApprovalStage[]) {
			expect(canActOnStage(stage, all, 'emp-a', 'emp-owner', barred(['user-two-hat']))).toBe(false)
		}
	})

	// AC-10 — the negative control. A bar that excluded everyone would pass AC-9 too.
	it('does not fire for an actor who decided nothing on this attempt', () => {
		expect(
			canActOnStage('APPROVE', TWO_HAT, 'emp-a', 'emp-owner', barred(['user-somebody-else']))
		).toBe(true)
	})

	it('is disabled by a null actorId, so surfaces with no actor are unaffected', () => {
		expect(
			canActOnStage('APPROVE', TWO_HAT, 'emp-a', 'emp-owner', {
				actorId: null,
				decidedActorIds: ['user-two-hat'],
				verifiedDocActorIds: []
			})
		).toBe(true)
	})
})

// ─── #283/F3 — the verifier of a document may not decide that request ───────────────────────
//
// Reachable TODAY with a single role, unlike F1: APPROVE_REQUESTS covers 7 of 9 roles, so one
// approver routinely signs off the evidence and then rules on it. Folded into #283 because it is
// the same defect — one actor standing on both sides of a two-person control.
describe('canActOnStage — the document-verifier bar (#283/F3)', () => {
	const signed = (roles: Role[]) =>
		canActOnStage('APPROVE', roles, 'emp-a', 'emp-owner', {
			actorId: 'user-signer',
			decidedActorIds: [],
			verifiedDocActorIds: ['user-signer']
		})

	// AC-19
	it('bars the verifier of a request document from deciding that request', () => {
		expect(signed(['APPROVER'])).toBe(false)
	})

	// AC-20 / D7. "High enough roles" does not exist in this codebase — #282 deleted ROLE_HIERARCHY
	// and a static scan keeps it deleted — so the escape hatch is a NAMED CAPABILITY and nothing
	// else. Both holders of ADMINISTER_SYSTEM are checked, since naming one role would be a rank in
	// disguise.
	it('carves out ADMINISTER_SYSTEM holders', () => {
		expect(signed(['SUPER_ADMIN', 'APPROVER'])).toBe(true)
		expect(signed(['CEO', 'APPROVER'])).toBe(true)
	})

	it('does not fire for an approver who signed nothing on this request', () => {
		expect(
			canActOnStage('APPROVE', ['APPROVER'], 'emp-a', 'emp-owner', {
				actorId: 'user-signer',
				decidedActorIds: [],
				verifiedDocActorIds: ['user-somebody-else']
			})
		).toBe(true)
	})

	// AC-28 — the bypass VALIDATE found. verifyDoc accepts verified=false, so before D11 a barred
	// approver un-verified their own sign-off (nulling verifiedById) and decided, with the audit
	// marker never firing. The predicate reads verifiedById, never verifiedAt, which is what makes
	// a cleared sign-off keep barring them. requests-documents.test.ts proves the other half:
	// that the clear really does keep the column.
	it('survives un-verifying the document (#283/AC-28)', () => {
		// A cleared sign-off: verifiedAt is null, verifiedById is not. The bar keys on the latter.
		expect(signed(['APPROVER'])).toBe(false)
	})

	// The waiver is privileged, so it must not be silent — this is what the audit marker keys on.
	it('flags the carve-out for audit only when it was actually used', () => {
		const sod = {
			actorId: 'user-signer',
			decidedActorIds: [],
			verifiedDocActorIds: ['user-signer']
		}
		expect(usedDocVerifierCarveOut(sod, ['CEO'])).toBe(true)
		expect(usedDocVerifierCarveOut(sod, ['APPROVER'])).toBe(false)
		expect(usedDocVerifierCarveOut({ ...sod, verifiedDocActorIds: ['user-other'] }, ['CEO'])).toBe(
			false
		)
	})
})

// AC-12 — the auto-completed MAKE step. buildApprovalChain writes it already-decided in the
// filer's name when the filer holds MANAGE_HR, so it carries both a decision and an actorId. If
// decidedActorIds skipped it, an HR admin could file a request AND verify it — the single most
// likely real-world instance of this hole, and the one a stage-scoped implementation would miss.
describe('decidedActorIds (#283)', () => {
	const steps = [
		{ attempt: 1, decision: 'APPROVED' as const, actorId: 'user-hr' },
		{ attempt: 1, decision: null, actorId: null },
		{ attempt: 2, decision: 'APPROVED' as const, actorId: 'user-old' }
	]

	it('counts the auto-completed MAKE step as a decision by its actor', () => {
		expect(decidedActorIds(steps, 1)).toEqual(['user-hr'])
	})

	// Q1: the bar is attempt-scoped. An earlier attempt's decider is not carried forward.
	it('ignores decisions from a superseded attempt', () => {
		expect(decidedActorIds(steps, 1)).not.toContain('user-old')
		expect(decidedActorIds(steps, 2)).toEqual(['user-old'])
	})

	it('ignores undecided steps and steps with no actor', () => {
		expect(decidedActorIds([{ attempt: 1, decision: null, actorId: 'user-x' }], 1)).toEqual([])
		expect(decidedActorIds([{ attempt: 1, decision: 'APPROVED', actorId: null }], 1)).toEqual([])
	})
})

describe('decidePayrollRun — the preparer cannot sign off their own run (#174)', () => {
	// MAKE was auto-completed by the preparer at compute; VERIFY has signed; APPROVE is open.
	const runAwaitingApproval = {
		id: 'run1',
		organizationId: 'org1',
		status: 'COMPUTED',
		approvalSteps: [
			{
				id: 'st-m',
				attempt: 1,
				stageIndex: 0,
				stage: 'MAKE',
				decision: 'APPROVED',
				actorId: MAKER_USER
			},
			{
				id: 'st-v',
				attempt: 1,
				stageIndex: 1,
				stage: 'VERIFY',
				decision: 'APPROVED',
				actorId: 'user-verifier'
			},
			{ id: 'st-a', attempt: 1, stageIndex: 2, stage: 'APPROVE', decision: null, actorId: null }
		]
	}

	beforeEach(() => dbMock.payrollRun.findFirst.mockResolvedValue(runAwaitingApproval))

	// The case #224 exists to prevent: a CEO holds APPROVE_FINANCE and can also run payroll, so
	// without this guard the same person prepares the money and signs it off.
	it('refuses the CEO who prepared the run', async () => {
		await expect(
			decidePayrollRun(
				'run1',
				'org1',
				true,
				undefined,
				ctxOf({ actorId: MAKER_USER, actorRoles: ['CEO'] })
			)
		).rejects.toMatchObject({
			status: 403,
			body: { message: 'You cannot sign off a payroll run you prepared' }
		})
		expect(dbMock.payrollRun.update).not.toHaveBeenCalled()
		expect(dbMock.$transaction).not.toHaveBeenCalled()
	})

	it('refuses the preparer on a return, not just an approval', async () => {
		await expect(
			decidePayrollRun(
				'run1',
				'org1',
				false,
				'looks wrong',
				ctxOf({ actorId: MAKER_USER, actorRoles: ['CEO'] })
			)
		).rejects.toMatchObject({ status: 403 })
	})

	it('lets a different finance approver sign off', async () => {
		await expect(
			decidePayrollRun(
				'run1',
				'org1',
				true,
				undefined,
				ctxOf({ actorId: 'user-ceo', actorRoles: ['CEO'] })
			)
		).resolves.toMatchObject({ decision: 'APPROVED', stage: 'APPROVE', status: 'APPROVED' })
		// APPROVE is the last stage, so a clean sign-off commits the run.
		expect(dbMock.payrollRun.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'run1' },
				data: expect.objectContaining({ status: 'APPROVED', approvedById: 'user-ceo' })
			})
		)
	})

	// AC-27 / #283-F5 — the gap multi-role opens on the highest-value surface in the app. The
	// VERIFY step of this fixture was signed by 'user-verifier'; a [VERIFIER, CEO] user is exactly
	// that person wearing the approver hat afterwards. Before #283 this was allowed: the old guard
	// compared against the MAKE actor only, so verify-then-approve by one person was invisible to it.
	it('refuses a [VERIFIER, CEO] user approving the run they verified (#283/AC-27)', async () => {
		await expect(
			decidePayrollRun(
				'run1',
				'org1',
				true,
				undefined,
				ctxOf({ actorId: 'user-verifier', actorRoles: ['VERIFIER', 'CEO'] })
			)
		).rejects.toMatchObject({ status: 403, body: { message: 'You cannot act on this stage' } })
		expect(dbMock.payrollRun.update).not.toHaveBeenCalled()
		expect(dbMock.$transaction).not.toHaveBeenCalled()
	})

	// The generic bar now subsumes the maker rule, so the maker block survives ONLY for its message
	// and only because it sits above the generic check. Move it back below and the maker is told
	// "you cannot act on this stage" instead of why — this pins the order, not just the refusal.
	it('still tells the preparer specifically that they prepared it (#283/F5)', async () => {
		await expect(
			decidePayrollRun(
				'run1',
				'org1',
				true,
				undefined,
				ctxOf({ actorId: MAKER_USER, actorRoles: ['VERIFIER', 'CEO'] })
			)
		).rejects.toMatchObject({
			body: { message: 'You cannot sign off a payroll run you prepared' }
		})
	})
})
