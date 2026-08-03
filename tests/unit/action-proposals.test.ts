import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuditContext } from '$lib/server/services/types'

/**
 * #224 Part 2 / #243 — propose → confirm.
 *
 * The rules worth pinning are the ones that decide WHO may confirm, because every one of them has
 * a plausible-looking wrong version:
 *
 *   - a rank floor instead of a capability would admit MANAGER (rank 2 = HR_ADMIN), i.e. exactly
 *     the people #243 exists to stop acting alone;
 *   - one flat capability for both shapes would either let an HR_ADMIN sign off the CEO's own
 *     raise, or push every routine manager pay change to the CEO;
 *   - a capability check alone, without initiator ≠ confirmer, would let a CEO confirm their own
 *     filing, since CEO holds APPROVE_FINANCE.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		actionProposal: {
			create: vi.fn(),
			findFirst: vi.fn(),
			findUniqueOrThrow: vi.fn(),
			updateMany: vi.fn()
		},
		user: { findMany: vi.fn() },
		employee: { findUnique: vi.fn() },
		$transaction: vi.fn()
	}
}))

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/services/notifications', () => ({
	notifyMany: vi.fn().mockResolvedValue(undefined)
}))

const { createProposal, confirmProposal, rejectProposal, confirmerCapabilityFor } =
	await import('$lib/server/services/action-proposals')

const CEO_USER = 'user-ceo'
const TARGET_EMP = 'emp-ceo'

const ctxOf = (over: Partial<AuditContext> = {}): AuditContext => ({
	organizationId: 'org1',
	actorId: 'user-someone',
	actorRole: 'SUPER_ADMIN',
	...over
})

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(dbMock))
	dbMock.user.findMany.mockResolvedValue([{ id: 'user-sa' }])
	dbMock.actionProposal.create.mockResolvedValue({ id: 'p1' })
	dbMock.actionProposal.updateMany.mockResolvedValue({ count: 1 })
	dbMock.actionProposal.findUniqueOrThrow.mockResolvedValue({ id: 'p1', status: 'APPLIED' })
})

/** A PENDING self-action: the CEO filed it against their own employee record. */
const selfProposal = {
	id: 'p1',
	organizationId: 'org1',
	initiatorId: CEO_USER,
	targetEmployeeId: TARGET_EMP,
	domain: 'COMPENSATION',
	payload: { basicMonthlySalary: 200000 },
	status: 'PENDING'
}

/** A PENDING proposal a manager filed for one of their reports (#243). */
const onBehalfProposal = { ...selfProposal, initiatorId: 'user-manager' }

const pendSelf = () => {
	dbMock.actionProposal.findFirst.mockResolvedValue(selfProposal)
	dbMock.employee.findUnique.mockResolvedValue({ userId: CEO_USER }) // target IS the initiator
}
const pendOnBehalf = () => {
	dbMock.actionProposal.findFirst.mockResolvedValue(onBehalfProposal)
	dbMock.employee.findUnique.mockResolvedValue({ userId: CEO_USER }) // target ≠ initiator
}

describe('which capability confirms which shape', () => {
	it('self-actions need finance sign-off, on-behalf proposals need org-wide HR', () => {
		expect(confirmerCapabilityFor(true)).toBe('APPROVE_FINANCE')
		expect(confirmerCapabilityFor(false)).toBe('ADMINISTER_HR_ORGWIDE')
	})
})

describe('confirming — who is refused', () => {
	// The whole reason this is capability-keyed and not `requireMinRole('HR_ADMIN')`: MANAGER ranks
	// level with HR_ADMIN, so a rank floor would let a manager confirm a manager's proposal.
	it('refuses a MANAGER on an on-behalf proposal', async () => {
		pendOnBehalf()
		await expect(
			confirmProposal('org1', 'p1', vi.fn(), ctxOf({ actorRole: 'MANAGER' }))
		).rejects.toMatchObject({ status: 403 })
		expect(dbMock.actionProposal.updateMany).not.toHaveBeenCalled()
	})

	it('refuses an HR_ADMIN on a self-action — that needs APPROVE_FINANCE', async () => {
		pendSelf()
		await expect(
			confirmProposal('org1', 'p1', vi.fn(), ctxOf({ actorRole: 'HR_ADMIN' }))
		).rejects.toMatchObject({ status: 403 })
		expect(dbMock.actionProposal.updateMany).not.toHaveBeenCalled()
	})

	it('allows an HR_ADMIN on an on-behalf proposal', async () => {
		pendOnBehalf()
		const apply = vi.fn().mockResolvedValue(undefined)
		await expect(
			confirmProposal('org1', 'p1', apply, ctxOf({ actorRole: 'HR_ADMIN' }))
		).resolves.toBeDefined()
		expect(apply).toHaveBeenCalled()
	})

	// Asserting the message, not just the 403: a CEO holds APPROVE_FINANCE, so the capability check
	// passes and only the initiator≠confirmer rule can stop them. A status-only assertion would
	// still pass with that rule deleted, because the wrong layer would answer.
	it('refuses the initiator even when they hold the right capability', async () => {
		pendSelf()
		await expect(
			confirmProposal('org1', 'p1', vi.fn(), ctxOf({ actorId: CEO_USER, actorRole: 'CEO' }))
		).rejects.toMatchObject({
			status: 403,
			body: { message: 'You cannot confirm a change you proposed yourself.' }
		})
		expect(dbMock.actionProposal.updateMany).not.toHaveBeenCalled()
	})

	it('lets a different APPROVE_FINANCE holder confirm the self-action', async () => {
		pendSelf()
		const apply = vi.fn().mockResolvedValue(undefined)
		await expect(
			confirmProposal('org1', 'p1', apply, ctxOf({ actorId: 'user-sa', actorRole: 'SUPER_ADMIN' }))
		).resolves.toBeDefined()
		expect(apply).toHaveBeenCalled()
	})
})

describe('confirming — applying it', () => {
	it('claims the row atomically before applying, and only from PENDING', async () => {
		pendOnBehalf()
		await confirmProposal('org1', 'p1', vi.fn().mockResolvedValue(undefined), ctxOf())
		expect(dbMock.actionProposal.updateMany).toHaveBeenCalledWith({
			where: { id: 'p1', organizationId: 'org1', status: 'PENDING' },
			data: expect.objectContaining({ status: 'APPLIED', decidedById: 'user-someone' })
		})
	})

	// The loser of a race claims nothing; it must not go on to apply the change a second time.
	it('does not apply when the claim is lost', async () => {
		pendOnBehalf()
		dbMock.actionProposal.updateMany.mockResolvedValue({ count: 0 })
		const apply = vi.fn()
		await expect(confirmProposal('org1', 'p1', apply, ctxOf())).rejects.toMatchObject({
			status: 404
		})
		expect(apply).not.toHaveBeenCalled()
	})

	// Re-validation at apply time is the real trust boundary, so a stale payload throwing must undo
	// the claim rather than burn the proposal — it runs inside the same transaction for that reason.
	it('propagates an apply failure so the claim rolls back', async () => {
		pendOnBehalf()
		const apply = vi.fn().mockRejectedValue(new Error('salary moved since this was proposed'))
		await expect(confirmProposal('org1', 'p1', apply, ctxOf())).rejects.toThrow('salary moved')
	})
})

describe('filing a proposal', () => {
	it('refuses when nobody else could ever confirm it', async () => {
		dbMock.user.findMany.mockResolvedValue([]) // initiator is the only qualified user
		await expect(
			createProposal(
				'org1',
				{
					targetEmployeeId: TARGET_EMP,
					targetUserId: CEO_USER,
					domain: 'COMPENSATION',
					payload: {}
				},
				ctxOf({ actorId: CEO_USER, actorRole: 'CEO' })
			)
		).rejects.toMatchObject({ status: 409 })
		// An unconfirmable row would read as success to the initiator and strand the change.
		expect(dbMock.actionProposal.create).not.toHaveBeenCalled()
	})

	it('never offers the initiator as their own confirmer', async () => {
		await createProposal(
			'org1',
			{ targetEmployeeId: TARGET_EMP, targetUserId: CEO_USER, domain: 'COMPENSATION', payload: {} },
			ctxOf({ actorId: CEO_USER, actorRole: 'CEO' })
		)
		expect(dbMock.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ id: { not: CEO_USER }, isActive: true })
			})
		)
	})

	it('looks for a finance confirmer on a self-action and an HR one otherwise', async () => {
		const rolesUsed = async (targetUserId: string) => {
			dbMock.user.findMany.mockClear()
			await createProposal(
				'org1',
				{ targetEmployeeId: TARGET_EMP, targetUserId, domain: 'COMPENSATION', payload: {} },
				ctxOf({ actorId: CEO_USER, actorRole: 'CEO' })
			)
			return dbMock.user.findMany.mock.calls[0][0].where.role.in
		}
		expect(await rolesUsed(CEO_USER)).not.toContain('HR_ADMIN') // self → APPROVE_FINANCE
		expect(await rolesUsed('user-other')).toContain('HR_ADMIN') // on behalf → HR org-wide
	})
})

describe('rejecting', () => {
	it('requires a reason', async () => {
		await expect(rejectProposal('org1', 'p1', '   ', ctxOf())).rejects.toMatchObject({
			status: 400
		})
		expect(dbMock.actionProposal.updateMany).not.toHaveBeenCalled()
	})

	it('applies the same confirmer rule as confirming', async () => {
		pendOnBehalf()
		await expect(
			rejectProposal('org1', 'p1', 'not budgeted', ctxOf({ actorRole: 'MANAGER' }))
		).rejects.toMatchObject({ status: 403 })
		expect(dbMock.actionProposal.updateMany).not.toHaveBeenCalled()
	})
})
