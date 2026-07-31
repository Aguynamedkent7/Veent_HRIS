import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuditContext } from '$lib/server/services/types'

/**
 * Separation of duties on a user's own role and account status.
 *
 * The rule already existed, but only as two copies in the routes — the roles form action and the v1
 * PATCH twin each tested `userId === user.id` and `setUserRole` / `setUserActive` did not. A third
 * caller would have inherited neither copy. Moved into the writers; these pin it there so it cannot
 * drift back out, and cover the last-super-admin guardrail that sits beside it.
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

	it('still changes somebody else’s role', async () => {
		await expect(setUserRole('user-other', 'org1', 'MANAGER', CTX)).resolves.toBeDefined()
		expect(dbMock.user.update).toHaveBeenCalledWith({
			where: { id: 'user-other' },
			data: { role: 'MANAGER' }
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
})

describe('setUserActive', () => {
	it('refuses to deactivate the actor’s own account', async () => {
		await expect(setUserActive(ACTOR, 'org1', false, CTX)).rejects.toMatchObject({
			status: 403,
			body: { message: 'You cannot deactivate your own account.' }
		})
		expect(dbMock.user.update).not.toHaveBeenCalled()
	})

	// Both directions, as the route check it replaces did — reactivating yourself is unreachable
	// anyway (an inactive user holds no session), so there is no case to carve out.
	it('refuses to reactivate the actor’s own account too', async () => {
		await expect(setUserActive(ACTOR, 'org1', true, CTX)).rejects.toMatchObject({ status: 403 })
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
})
