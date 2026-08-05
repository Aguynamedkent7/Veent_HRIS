import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'
import type { AuditContext } from '$lib/server/services/types'

/**
 * Separation of duties on a user's own role and account status.
 *
 * The rule already existed, but only as two copies in the routes — the roles form action and the v1
 * PATCH twin each tested `userId === user.id` and `setUserRole` / `setUserActive` did not. A third
 * caller would have inherited neither copy. Moved into the writers; these pin it there so it cannot
 * drift back out, and cover the last-super-admin guardrail that sits beside it.
 *
 * #248 widens the last-holder guardrail from SUPER_ADMIN to CEO, since the CEO is the only role
 * that can grant any role back; those cases live here beside it.
 *
 * #260 (CodeRabbit review of #248's PR): the guard now (1) checks every org the target is
 * reachable from — home org and every membership, not just the acting org — and (2) runs inside a
 * serializable transaction with the write it guards, so a count-then-write TOCTOU race between two
 * concurrent admin requests can't leave an org without a holder. The mock therefore routes all
 * writer queries through a `txMock` handed into `db.$transaction`'s callback, matching the pattern
 * used elsewhere in this repo (see `promotion.test.ts`).
 */

const { dbMock, txMock } = vi.hoisted(() => {
	const txMock = {
		user: { findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
		userOrganization: { findMany: vi.fn() }
	}
	return {
		txMock,
		dbMock: {
			$transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock))
		}
	}
})

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

const { setUserRole, setUserActive } = await import('$lib/server/services/settings/org')

const ACTOR = 'user-self'
const CTX: AuditContext = {
	organizationId: 'org1',
	actorId: ACTOR,
	actorRole: 'CEO',
	ipAddress: 'test'
}

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.$transaction.mockImplementation(async (fn: (tx: typeof txMock) => unknown) => fn(txMock))
	// Someone else in the same org, and never the last super admin, so only the self-guard can fire.
	txMock.user.findFirst.mockResolvedValue({
		id: 'user-other',
		role: 'HR_ADMIN',
		isActive: true,
		organizationId: 'org1'
	})
	txMock.user.count.mockResolvedValue(1)
	txMock.user.update.mockResolvedValue({ id: 'user-other', role: 'MANAGER' })
	txMock.userOrganization.findMany.mockResolvedValue([])
})

describe('setUserRole', () => {
	// #256: the writer had NO capability check — its only enforcement was the two routes, which
	// makes MANAGE_USER_ROLES the one self-amplifying capability (it can grant itself) guarded
	// solely at the route layer. Now checked here, on the full role set, above everything else.
	it('refuses an actor who does not hold MANAGE_USER_ROLES', async () => {
		await expect(
			setUserRole('user-other', 'org1', 'MANAGER', { ...CTX, actorRole: 'SUPER_ADMIN' })
		).rejects.toMatchObject({ status: 403 })
		expect(dbMock.$transaction).not.toHaveBeenCalled()
		expect(txMock.user.update).not.toHaveBeenCalled()
	})

	// The capability check runs BEFORE the self-check, so an unauthorized caller cannot use a
	// self-targeted call to distinguish "you may not" from anything about the target at all.
	it('refuses an unauthorized actor without any lookup, even targeting themselves', async () => {
		await expect(
			setUserRole(ACTOR, 'org1', 'MANAGER', { ...CTX, actorRole: 'EMPLOYEE' })
		).rejects.toMatchObject({ status: 403 })
		expect(dbMock.$transaction).not.toHaveBeenCalled()
		expect(txMock.user.findFirst).not.toHaveBeenCalled()
	})

	// #256's fix: the authority is CEO, held as a secondary role.
	it('admits an actor holding CEO through the role set (#256)', async () => {
		await expect(
			setUserRole('user-other', 'org1', 'MANAGER', {
				...CTX,
				actorRole: 'EMPLOYEE',
				actorRoles: ['EMPLOYEE', 'CEO']
			})
		).resolves.toBeDefined()
		expect(txMock.user.update).toHaveBeenCalled()
	})

	it('refuses to change the actor’s own role', async () => {
		await expect(setUserRole(ACTOR, 'org1', 'SUPER_ADMIN', CTX)).rejects.toMatchObject({
			status: 403,
			body: { message: 'You cannot change your own role.' }
		})
		expect(txMock.user.update).not.toHaveBeenCalled()
	})

	// The self-check must not need a database round trip to refuse — it also means a self-call
	// cannot be turned into an existence probe.
	it('refuses before touching the database', async () => {
		await setUserRole(ACTOR, 'org1', 'SUPER_ADMIN', CTX).catch(() => {})
		expect(dbMock.$transaction).not.toHaveBeenCalled()
	})

	// #255: the write must carry the role SET too. Every capability check resolves authority from
	// `roles` and falls back to `[role]` only when it is empty — which it never is after the #133
	// backfill — so a change that touched only `role` left the user on their old authority forever.
	it('still changes somebody else’s role, and syncs the role set with it (#255)', async () => {
		await expect(setUserRole('user-other', 'org1', 'MANAGER', CTX)).resolves.toBeDefined()
		expect(txMock.user.update).toHaveBeenCalledWith({
			where: { id: 'user-other' },
			data: { role: 'MANAGER', roles: ['MANAGER'] }
		})
	})

	it('still blocks demoting the last active super admin', async () => {
		txMock.user.findFirst.mockResolvedValue({
			id: 'user-other',
			role: 'SUPER_ADMIN',
			isActive: true,
			organizationId: 'org1'
		})
		txMock.user.count.mockResolvedValue(0)

		await expect(setUserRole('user-other', 'org1', 'HR_ADMIN', CTX)).rejects.toMatchObject({
			status: 409
		})
		expect(txMock.user.update).not.toHaveBeenCalled()
	})

	// #248: the three roles no picker offered. The service always accepted them (it takes a Role);
	// what was missing was any route that would pass them. Pinned end-to-end at the writer.
	it.each(['CEO', 'VERIFIER', 'APPROVER'] as const)(
		'promotes a user to %s (#248)',
		async (role) => {
			txMock.user.update.mockResolvedValue({ id: 'user-other', role })
			await expect(setUserRole('user-other', 'org1', role, CTX)).resolves.toBeDefined()
			expect(txMock.user.update).toHaveBeenCalledWith({
				where: { id: 'user-other' },
				data: { role, roles: [role] }
			})
		}
	)

	it('blocks demoting the last active CEO (#248)', async () => {
		txMock.user.findFirst.mockResolvedValue({
			id: 'user-other',
			role: 'CEO',
			isActive: true,
			organizationId: 'org1'
		})
		txMock.user.count.mockResolvedValue(0)

		await expect(setUserRole('user-other', 'org1', 'HR_ADMIN', CTX)).rejects.toMatchObject({
			status: 409,
			body: { message: 'Cannot remove the last active CEO from the organization.' }
		})
		expect(txMock.user.update).not.toHaveBeenCalled()
	})

	it('demotes a CEO while another active CEO remains', async () => {
		txMock.user.findFirst.mockResolvedValue({
			id: 'user-other',
			role: 'CEO',
			isActive: true,
			organizationId: 'org1'
		})
		txMock.user.count.mockResolvedValue(1)

		await expect(setUserRole('user-other', 'org1', 'HR_ADMIN', CTX)).resolves.toBeDefined()
	})

	// The seeded CEO belongs to all three tenants via userOrganization while User.organizationId
	// names only one. Counting the org column alone would report "no other CEO" in the other two
	// and trap a promotion the same actor had just made (#248).
	it('counts holders who reach the org through a membership', async () => {
		txMock.user.findFirst.mockResolvedValue({
			id: 'user-other',
			role: 'CEO',
			isActive: true,
			organizationId: 'org1'
		})
		await setUserRole('user-other', 'org1', 'HR_ADMIN', CTX)

		expect(txMock.user.count).toHaveBeenCalledWith({
			where: {
				role: 'CEO',
				isActive: true,
				id: { not: 'user-other' },
				OR: [{ organizationId: 'org1' }, { memberships: { some: { organizationId: 'org1' } } }]
			}
		})
	})

	// #260 finding 2: a target reachable from a SECOND org only via membership (not their home org)
	// can be that org's only reachable holder. Checking solely the acting org (org1, the target's
	// home org here) would miss that org2 would be left without one.
	it('blocks a demotion that would strand a different org the target only reaches via membership (#260)', async () => {
		txMock.user.findFirst.mockResolvedValue({
			id: 'user-other',
			role: 'CEO',
			isActive: true,
			organizationId: 'org1'
		})
		txMock.userOrganization.findMany.mockResolvedValue([{ organizationId: 'org2' }])
		// org1 (home/acting org) has another active CEO; org2 (membership-only) does not.
		txMock.user.count.mockImplementation(
			async ({ where }: { where: { OR: [{ organizationId: string }, unknown] } }) =>
				where.OR[0].organizationId === 'org1' ? 1 : 0
		)

		await expect(setUserRole('user-other', 'org1', 'HR_ADMIN', CTX)).rejects.toMatchObject({
			status: 409
		})
		expect(txMock.user.update).not.toHaveBeenCalled()
	})

	// The guard keys on the role being LOST, so re-saving a user's current role — one click, since
	// the select is prefilled — is never mistaken for a demotion.
	it('does not block re-saving the last super admin’s existing role', async () => {
		txMock.user.findFirst.mockResolvedValue({
			id: 'user-other',
			role: 'SUPER_ADMIN',
			isActive: true,
			organizationId: 'org1'
		})
		txMock.user.count.mockResolvedValue(0)

		await expect(setUserRole('user-other', 'org1', 'SUPER_ADMIN', CTX)).resolves.toBeDefined()
		expect(txMock.user.count).not.toHaveBeenCalled()
	})

	// #260 finding 3: the target read, the last-holder count and the write must be one atomic unit,
	// or two concurrent requests can both read "another holder exists" and both proceed. This proves
	// the wiring (Serializable transaction, all three ops routed through its callback's `tx`) — a
	// mock can't reproduce the actual race a real Postgres serialization conflict would catch.
	it('wraps the read, holder count and write in one serializable transaction (#260)', async () => {
		txMock.user.findFirst.mockResolvedValue({
			id: 'user-other',
			role: 'CEO',
			isActive: true,
			organizationId: 'org1'
		})

		await setUserRole('user-other', 'org1', 'HR_ADMIN', CTX)

		expect(dbMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: Prisma.TransactionIsolationLevel.Serializable
		})
		expect(txMock.user.findFirst).toHaveBeenCalled()
		expect(txMock.user.count).toHaveBeenCalled()
		expect(txMock.user.update).toHaveBeenCalled()
	})
})

describe('setUserActive', () => {
	it('refuses to deactivate the actor’s own account', async () => {
		await expect(setUserActive(ACTOR, 'org1', false, CTX)).rejects.toMatchObject({
			status: 403,
			body: { message: 'You cannot deactivate your own account.' }
		})
		expect(txMock.user.update).not.toHaveBeenCalled()
		// As with setUserRole: refused before any round trip, so it is no existence probe either.
		expect(dbMock.$transaction).not.toHaveBeenCalled()
	})

	// Both directions, as the route check it replaces did — reactivating yourself is unreachable
	// anyway (an inactive user holds no session), so there is no case to carve out.
	it('refuses to reactivate the actor’s own account too', async () => {
		await expect(setUserActive(ACTOR, 'org1', true, CTX)).rejects.toMatchObject({ status: 403 })
		expect(dbMock.$transaction).not.toHaveBeenCalled()
	})

	it('still deactivates somebody else', async () => {
		txMock.user.update.mockResolvedValue({ id: 'user-other', isActive: false })
		await expect(setUserActive('user-other', 'org1', false, CTX)).resolves.toBeDefined()
		expect(txMock.user.update).toHaveBeenCalledWith({
			where: { id: 'user-other' },
			data: { isActive: false }
		})
	})

	it('still blocks deactivating the last active super admin', async () => {
		txMock.user.findFirst.mockResolvedValue({
			id: 'user-other',
			role: 'SUPER_ADMIN',
			isActive: true,
			organizationId: 'org1'
		})
		txMock.user.count.mockResolvedValue(0)

		await expect(setUserActive('user-other', 'org1', false, CTX)).rejects.toMatchObject({
			status: 409
		})
		expect(txMock.user.update).not.toHaveBeenCalled()
	})

	// The guard's real bite: only a CEO can change roles and never their own, so a role change always
	// leaves one CEO standing — but a SUPER_ADMIN holds ADMINISTER_SYSTEM and could deactivate the
	// org's only CEO, freezing role management entirely (#248).
	it('blocks deactivating the last active CEO (#248)', async () => {
		txMock.user.findFirst.mockResolvedValue({
			id: 'user-other',
			role: 'CEO',
			isActive: true,
			organizationId: 'org1'
		})
		txMock.user.count.mockResolvedValue(0)

		await expect(setUserActive('user-other', 'org1', false, CTX)).rejects.toMatchObject({
			status: 409
		})
		expect(txMock.user.update).not.toHaveBeenCalled()
	})
})
