import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #299/D-6a + AC-10 — CANCELLED is a terminal status, so it evicts too.
 *
 * `cancelRequest` had no test of any kind in this repo before this file, so the new trigger could
 * not ride on an existing case. That is exactly why it needed one: `decide()` was assumed to be the
 * only route to a terminal status while this function has been writing CANCELLED all along, and a
 * request cancelled with tombstoned documents would have held their bytes forever.
 *
 * CANCELLED is genuinely terminal — there is no path back out of it: `resubmitRequest` requires
 * RETURNED and `decide()` requires PENDING.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		request: { findFirst: vi.fn(), update: vi.fn() }
	}
}))
vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

// Owning the module cancelRequest calls into is the only way to gate a call. The alias resolves to
// the same module the caller imports relatively as './documents'.
const { evictMock } = vi.hoisted(() => ({ evictMock: vi.fn() }))
vi.mock('$lib/server/services/requests/documents', () => ({ evictTombstonedBytes: evictMock }))

const { cancelRequest } = await import('$lib/server/services/requests')

const CTX = {
	organizationId: 'org1',
	actorId: 'user-owner',
	actorRoles: ['EMPLOYEE' as const],
	ipAddress: 'test'
}

beforeEach(() => {
	vi.clearAllMocks()
	// cancelRequest calls `.catch()` on the result, so this must be a promise, not undefined.
	evictMock.mockResolvedValue(undefined)
	dbMock.request.update.mockResolvedValue({ id: 'req1', status: 'CANCELLED' })
})

describe('cancelRequest — the CANCELLED terminal eviction (#299/D-6a)', () => {
	// Arguments asserted, not just the call: a `3` here would silently keep three files forever on a
	// request nobody will ever reopen, and no other test in the repo would notice.
	it('evicts every tombstoned byte after cancelling a pending request', async () => {
		dbMock.request.findFirst.mockResolvedValue({ id: 'req1', status: 'PENDING' })

		await cancelRequest('req1', 'emp-owner', CTX)

		expect(dbMock.request.update).toHaveBeenCalledWith({
			where: { id: 'req1' },
			data: { status: 'CANCELLED' }
		})
		expect(evictMock).toHaveBeenCalledTimes(1)
		expect(evictMock).toHaveBeenCalledWith('req1', 0)
	})

	it('evicts on a RETURNED request too — that path also ends in CANCELLED', async () => {
		dbMock.request.findFirst.mockResolvedValue({ id: 'req1', status: 'RETURNED' })

		await cancelRequest('req1', 'emp-owner', CTX)

		expect(evictMock).toHaveBeenCalledWith('req1', 0)
	})

	// The negative control. Nothing was cancelled, so nothing may be unlinked — an eviction that
	// fired on a refusal would destroy the bytes of a request that is still open.
	it('does not evict when the cancellation is refused', async () => {
		dbMock.request.findFirst.mockResolvedValue({ id: 'req1', status: 'APPROVED' })

		await expect(cancelRequest('req1', 'emp-owner', CTX)).rejects.toMatchObject({ status: 400 })

		expect(dbMock.request.update).not.toHaveBeenCalled()
		expect(evictMock).not.toHaveBeenCalled()
	})
})
