import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuditContext } from '$lib/server/services/types'

/**
 * #305 — `setClearanceItem`'s three untested branches: the 404 (which is also the org
 * scope), the finalized-parent 409, and the roll-BACK to OPEN while items are still
 * pending. The D8 re-clear bar is covered by separation-clearance-reclear.test.ts and is
 * deliberately not repeated here.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		separationRecord: { updateMany: vi.fn() },
		clearanceItem: { findFirst: vi.fn(), update: vi.fn(), count: vi.fn() }
	}
}))

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/notifications', () => ({
	sendOffboardingNoticeEmail: vi.fn(),
	sendRequestStatusEmail: vi.fn()
}))

const { setClearanceItem } = await import('$lib/server/services/separation')

const CTX: AuditContext = {
	organizationId: 'org1',
	actorId: 'user-b',
	actorRoles: ['HR_ADMIN'],
	ipAddress: 'test'
}

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.clearanceItem.findFirst.mockResolvedValue({
		id: 'ci1',
		status: 'PENDING',
		clearedById: null,
		separation: { id: 'sep1', status: 'OPEN' }
	})
	dbMock.clearanceItem.count.mockResolvedValue(0)
	dbMock.separationRecord.updateMany.mockResolvedValue({ count: 1 })
})

describe('setClearanceItem — untested branches', () => {
	it('rejects an unknown clearance item', async () => {
		// An item belonging to another org is indistinguishable from one that does not exist:
		// the lookup is scoped by `separation: { organizationId }`, so it simply misses.
		dbMock.clearanceItem.findFirst.mockResolvedValue(null)

		await expect(setClearanceItem('ci1', 'org1', true, CTX)).rejects.toMatchObject({
			status: 404,
			body: { message: 'Clearance item not found' }
		})

		expect(dbMock.clearanceItem.findFirst.mock.calls[0][0]).toMatchObject({
			where: { id: 'ci1', separation: { organizationId: 'org1' } }
		})
		expect(dbMock.clearanceItem.update).not.toHaveBeenCalled()
	})

	it('refuses to touch an item on a finalized case', async () => {
		dbMock.clearanceItem.findFirst.mockResolvedValue({
			id: 'ci1',
			status: 'PENDING',
			clearedById: null,
			separation: { id: 'sep1', status: 'FINALIZED' }
		})

		await expect(setClearanceItem('ci1', 'org1', true, CTX)).rejects.toMatchObject({
			status: 409,
			body: { message: 'Separation is already finalized' }
		})
		expect(dbMock.clearanceItem.update).not.toHaveBeenCalled()
		expect(dbMock.separationRecord.updateMany).not.toHaveBeenCalled()
	})

	it('rolls the parent back to OPEN while items remain pending', async () => {
		// Two items still PENDING after this write, so the parent must go back to OPEN —
		// and the write keeps its `status: { not: 'FINALIZED' }` floor, which is what stops a
		// finalize that landed after the read from being silently reopened.
		dbMock.clearanceItem.count.mockResolvedValue(2)

		await setClearanceItem('ci1', 'org1', true, CTX)

		expect(dbMock.separationRecord.updateMany).toHaveBeenCalledWith({
			where: { id: 'sep1', status: { not: 'FINALIZED' } },
			data: { status: 'OPEN' }
		})
	})
})
