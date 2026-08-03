import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuditContext } from '$lib/server/services/types'

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
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/services/notifications', () => ({
	notify: vi.fn().mockResolvedValue(undefined)
}))

const { decide, decidePayrollRun } = await import('$lib/server/services/approvals')

const OWNER_EMP = 'emp-owner'
const MAKER_USER = 'user-maker'

const ctxOf = (over: Partial<AuditContext> = {}): AuditContext => ({
	organizationId: 'org1',
	actorId: 'user-other',
	actorRole: 'HR_ADMIN',
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
			decide('req1', 'APPROVED', undefined, ctxOf({ actorRole: 'SUPER_ADMIN' }), OWNER_EMP)
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
				ctxOf({ actorId: MAKER_USER, actorRole: 'CEO' })
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
				ctxOf({ actorId: MAKER_USER, actorRole: 'CEO' })
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
				ctxOf({ actorId: 'user-ceo', actorRole: 'CEO' })
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
})
