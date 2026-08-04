import { describe, it, expect, vi, beforeEach } from 'vitest'
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
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		user: { findFirst: vi.fn(), update: vi.fn(), count: vi.fn() }
	}
}))

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
	// Someone else in the same org, and never the last super admin, so only the self-guard can fire.
	dbMock.user.findFirst.mockResolvedValue({ id: 'user-other', role: 'HR_ADMIN', isActive: true })
	dbMock.user.count.mockResolvedValue(1)
	dbMock.user.update.mockResolvedValue({ id: 'user-other', role: 'MANAGER' })
})

describe('setUserRole', () => {
	it('refuses to change the actor’s own role', async () => {
		await expect(setUserRole(ACTOR, 'org1', 'SUPER_ADMIN', CTX)).rejects.toMatchObject({
			status: 403,
			body: { message: 'You cannot change your own role.' }
		})
		expect(dbMock.user.update).not.toHaveBeenCalled()
	})

	// The self-check must not need a database round trip to refuse — it also means a self-call
	// cannot be turned into an existence probe.
	it('refuses before touching the database', async () => {
		await setUserRole(ACTOR, 'org1', 'SUPER_ADMIN', CTX).catch(() => {})
		expect(dbMock.user.findFirst).not.toHaveBeenCalled()
	})

	// #255: the write must carry the role SET too. Every capability check resolves authority from
	// `roles` and falls back to `[role]` only when it is empty — which it never is after the #133
	// backfill — so a change that touched only `role` left the user on their old authority forever.
	it('still changes somebody else’s role, and syncs the role set with it (#255)', async () => {
		await expect(setUserRole('user-other', 'org1', 'MANAGER', CTX)).resolves.toBeDefined()
		expect(dbMock.user.update).toHaveBeenCalledWith({
			where: { id: 'user-other' },
			data: { role: 'MANAGER', roles: ['MANAGER'] }
		})
	})

	it('still blocks demoting the last active super admin', async () => {
		dbMock.user.findFirst.mockResolvedValue({
			id: 'user-other',
			role: 'SUPER_ADMIN',
			isActive: true
		})
		dbMock.user.count.mockResolvedValue(0)

		await expect(setUserRole('user-other', 'org1', 'HR_ADMIN', CTX)).rejects.toMatchObject({
			status: 409
		})
		expect(dbMock.user.update).not.toHaveBeenCalled()
	})

	// #248: the three roles no picker offered. The service always accepted them (it takes a Role);
	// what was missing was any route that would pass them. Pinned end-to-end at the writer.
	it.each(['CEO', 'VERIFIER', 'APPROVER'] as const)(
		'promotes a user to %s (#248)',
		async (role) => {
			dbMock.user.update.mockResolvedValue({ id: 'user-other', role })
			await expect(setUserRole('user-other', 'org1', role, CTX)).resolves.toBeDefined()
			expect(dbMock.user.update).toHaveBeenCalledWith({
				where: { id: 'user-other' },
				data: { role, roles: [role] }
			})
		}
	)

	it('blocks demoting the last active CEO (#248)', async () => {
		dbMock.user.findFirst.mockResolvedValue({ id: 'user-other', role: 'CEO', isActive: true })
		dbMock.user.count.mockResolvedValue(0)

		await expect(setUserRole('user-other', 'org1', 'HR_ADMIN', CTX)).rejects.toMatchObject({
			status: 409,
			body: { message: 'Cannot remove the last active CEO from the organization.' }
		})
		expect(dbMock.user.update).not.toHaveBeenCalled()
	})

	it('demotes a CEO while another active CEO remains', async () => {
		dbMock.user.findFirst.mockResolvedValue({ id: 'user-other', role: 'CEO', isActive: true })
		dbMock.user.count.mockResolvedValue(1)

		await expect(setUserRole('user-other', 'org1', 'HR_ADMIN', CTX)).resolves.toBeDefined()
	})

	// The seeded CEO belongs to all three tenants via userOrganization while User.organizationId
	// names only one. Counting the org column alone would report "no other CEO" in the other two
	// and trap a promotion the same actor had just made (#248).
	it('counts holders who reach the org through a membership', async () => {
		dbMock.user.findFirst.mockResolvedValue({ id: 'user-other', role: 'CEO', isActive: true })
		await setUserRole('user-other', 'org1', 'HR_ADMIN', CTX)

		expect(dbMock.user.count).toHaveBeenCalledWith({
			where: {
				role: 'CEO',
				isActive: true,
				id: { not: 'user-other' },
				OR: [{ organizationId: 'org1' }, { memberships: { some: { organizationId: 'org1' } } }]
			}
		})
	})

	// The guard keys on the role being LOST, so re-saving a user's current role — one click, since
	// the select is prefilled — is never mistaken for a demotion.
	it('does not block re-saving the last super admin’s existing role', async () => {
		dbMock.user.findFirst.mockResolvedValue({
			id: 'user-other',
			role: 'SUPER_ADMIN',
			isActive: true
		})
		dbMock.user.count.mockResolvedValue(0)

		await expect(setUserRole('user-other', 'org1', 'SUPER_ADMIN', CTX)).resolves.toBeDefined()
		expect(dbMock.user.count).not.toHaveBeenCalled()
	})
})

describe('setUserActive', () => {
	it('refuses to deactivate the actor’s own account', async () => {
		await expect(setUserActive(ACTOR, 'org1', false, CTX)).rejects.toMatchObject({
			status: 403,
			body: { message: 'You cannot deactivate your own account.' }
		})
		expect(dbMock.user.update).not.toHaveBeenCalled()
		// As with setUserRole: refused before any round trip, so it is no existence probe either.
		expect(dbMock.user.findFirst).not.toHaveBeenCalled()
	})

	// Both directions, as the route check it replaces did — reactivating yourself is unreachable
	// anyway (an inactive user holds no session), so there is no case to carve out.
	it('refuses to reactivate the actor’s own account too', async () => {
		await expect(setUserActive(ACTOR, 'org1', true, CTX)).rejects.toMatchObject({ status: 403 })
		expect(dbMock.user.findFirst).not.toHaveBeenCalled()
	})

	it('still deactivates somebody else', async () => {
		dbMock.user.update.mockResolvedValue({ id: 'user-other', isActive: false })
		await expect(setUserActive('user-other', 'org1', false, CTX)).resolves.toBeDefined()
		expect(dbMock.user.update).toHaveBeenCalledWith({
			where: { id: 'user-other' },
			data: { isActive: false }
		})
	})

	it('still blocks deactivating the last active super admin', async () => {
		dbMock.user.findFirst.mockResolvedValue({
			id: 'user-other',
			role: 'SUPER_ADMIN',
			isActive: true
		})
		dbMock.user.count.mockResolvedValue(0)

		await expect(setUserActive('user-other', 'org1', false, CTX)).rejects.toMatchObject({
			status: 409
		})
		expect(dbMock.user.update).not.toHaveBeenCalled()
	})

	// The guard's real bite: only a CEO can change roles and never their own, so a role change always
	// leaves one CEO standing — but a SUPER_ADMIN holds ADMINISTER_SYSTEM and could deactivate the
	// org's only CEO, freezing role management entirely (#248).
	it('blocks deactivating the last active CEO (#248)', async () => {
		dbMock.user.findFirst.mockResolvedValue({ id: 'user-other', role: 'CEO', isActive: true })
		dbMock.user.count.mockResolvedValue(0)

		await expect(setUserActive('user-other', 'org1', false, CTX)).rejects.toMatchObject({
			status: 409
		})
		expect(dbMock.user.update).not.toHaveBeenCalled()
	})
})
