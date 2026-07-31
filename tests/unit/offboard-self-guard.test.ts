import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuditContext } from '$lib/server/services/types'

/**
 * #158 — an admin must not be able to offboard their own employee record. The
 * offboard transaction sets User.isActive = false, so self-offboarding locks the
 * actor out on their next request. The guard lives in offboardEmployee so both
 * the form action and the v1 API are covered. DB and audit are mocked to keep
 * this in the fast unit suite.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		employee: { findFirst: vi.fn(), update: vi.fn() },
		// getEmployee's heal-on-read (#170 Stage 1.5, #222) queries the comp + employment-type history.
		employeeCompensation: { findMany: vi.fn().mockResolvedValue([]) },
		employeeEmploymentType: { findMany: vi.fn().mockResolvedValue([]) },
		user: { updateMany: vi.fn() },
		$transaction: vi.fn()
	}
}))

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

const { offboardEmployee } = await import('$lib/server/services/employees')

const CTX: AuditContext = {
	organizationId: 'org1',
	actorId: 'user-self',
	actorRole: 'HR_ADMIN',
	ipAddress: 'test'
}
const endDate = new Date('2026-08-01')

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.$transaction.mockImplementation(async (ops: unknown[]) => ops)
})

describe('offboardEmployee self-guard (#158)', () => {
	it('refuses when the target is the actor’s own record', async () => {
		dbMock.employee.findFirst.mockResolvedValue({ id: 'emp1', userId: 'user-self' })

		await expect(offboardEmployee('emp1', 'org1', endDate, CTX)).rejects.toMatchObject({
			status: 400
		})
		// Nothing was mutated.
		expect(dbMock.$transaction).not.toHaveBeenCalled()
	})

	it('proceeds when offboarding a different employee', async () => {
		dbMock.employee.findFirst.mockResolvedValue({ id: 'emp2', userId: 'user-other' })
		dbMock.employee.update.mockReturnValue({ id: 'emp2' })
		dbMock.user.updateMany.mockReturnValue({ count: 1 })

		await expect(offboardEmployee('emp2', 'org1', endDate, CTX)).resolves.toBeDefined()
		expect(dbMock.$transaction).toHaveBeenCalledTimes(1)
	})
})
