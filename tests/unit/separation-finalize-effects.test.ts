import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuditContext } from '$lib/server/services/types'

/**
 * #305 — the two finalize effects nothing pins today: the lost-race 409 (the guarded
 * `updateMany` comes back with `count: 0`), and the exact `where` clauses of the
 * in-transaction cascade plus `endDate === effectiveDate`.
 *
 * KNOWN GAP (plan §Known Gaps): the mocked `$transaction` is a passthrough, so this file
 * proves the writes are ISSUED, not that they are atomic. Rollback needs a real DB.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		separationRecord: { findFirst: vi.fn(), updateMany: vi.fn() },
		clearanceItem: { findMany: vi.fn() },
		employee: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
		employeeCompensation: { findMany: vi.fn() },
		leaveBalance: { findMany: vi.fn() },
		loan: { findMany: vi.fn(), updateMany: vi.fn() },
		cashAdvance: { findMany: vi.fn(), updateMany: vi.fn() },
		user: { updateMany: vi.fn() },
		$transaction: vi.fn()
	}
}))

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/notifications', () => ({
	sendOffboardingNoticeEmail: vi.fn(),
	sendRequestStatusEmail: vi.fn()
}))

const { finalizeSeparation } = await import('$lib/server/services/separation')

const CTX: AuditContext = {
	organizationId: 'org1',
	actorId: 'user-b',
	actorRoles: ['HR_ADMIN'],
	ipAddress: 'test'
}

const EFFECTIVE_DATE = new Date('2026-08-01')

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.$transaction.mockImplementation(async (fn: (tx: typeof dbMock) => unknown) => fn(dbMock))
	dbMock.separationRecord.findFirst.mockResolvedValue({
		id: 'sep1',
		organizationId: 'org1',
		employeeId: 'emp1',
		status: 'CLEARED',
		type: 'RESIGNATION',
		effectiveDate: EFFECTIVE_DATE,
		finalPayAmount: null,
		finalPayBreakdown: null,
		employee: { id: 'emp1', firstName: 'Ann', lastName: 'Cruz' },
		clearanceItems: [{ id: 'ci1', status: 'CLEARED', clearedById: 'user-a' }]
	})
	dbMock.separationRecord.updateMany.mockResolvedValue({ count: 1 })
	// The in-transaction re-read: nobody the actor cleared, so the D3 bar stays down.
	dbMock.clearanceItem.findMany.mockResolvedValue([])
	dbMock.employee.findUnique.mockResolvedValue({ userId: 'user-subject' })
	dbMock.employee.findUniqueOrThrow.mockResolvedValue({
		basicMonthlySalary: 22000,
		rateType: 'MONTHLY'
	})
	dbMock.employeeCompensation.findMany.mockResolvedValue([])
	dbMock.leaveBalance.findMany.mockResolvedValue([])
	dbMock.loan.findMany.mockResolvedValue([])
	dbMock.cashAdvance.findMany.mockResolvedValue([])
})

describe('finalizeSeparation — in-transaction effects', () => {
	it('refuses a finalize that lost the race', async () => {
		// A concurrent finalize already flipped the row, so the status-floored update matches
		// nothing. Everything after it must not run.
		dbMock.separationRecord.updateMany.mockResolvedValue({ count: 0 })

		await expect(finalizeSeparation('sep1', 'org1', CTX)).rejects.toMatchObject({
			status: 409,
			body: { message: 'Separation is already finalized' }
		})

		expect(dbMock.loan.updateMany).not.toHaveBeenCalled()
		expect(dbMock.cashAdvance.updateMany).not.toHaveBeenCalled()
		expect(dbMock.employee.update).not.toHaveBeenCalled()
		expect(dbMock.user.updateMany).not.toHaveBeenCalled()
	})

	it('zeroes loans and advances, offboards the employee, deactivates the user', async () => {
		await finalizeSeparation('sep1', 'org1', CTX)

		expect(dbMock.loan.updateMany).toHaveBeenCalledWith({
			where: { employeeId: 'emp1', status: 'ACTIVE' },
			data: { balance: 0, status: 'PAID' }
		})
		expect(dbMock.cashAdvance.updateMany).toHaveBeenCalledWith({
			where: { employeeId: 'emp1', status: 'ACTIVE' },
			data: { balance: 0, status: 'PAID' }
		})
		// The end date is the separation's effective date, not "now" and not any other date.
		expect(dbMock.employee.update.mock.calls[0][0]).toMatchObject({
			data: { endDate: EFFECTIVE_DATE }
		})
		expect(dbMock.user.updateMany).toHaveBeenCalledWith({
			where: { employee: { id: 'emp1' } },
			data: { isActive: false }
		})
	})
})
