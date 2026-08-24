import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * HR complaints/inquiries (#112) — scoping guards. The complaints service is deliberately NOT
 * mocked here: these tests assert on the arguments the Prisma queries were BUILT with
 * (`mock.calls[0][0]`), which proves the filter reached the query rather than merely proving the
 * route handed an object to a function.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		employee: { findFirst: vi.fn(), findMany: vi.fn() },
		hrComplaint: {
			create: vi.fn(),
			findFirst: vi.fn(),
			findMany: vi.fn(),
			count: vi.fn(),
			update: vi.fn()
		},
		hrComplaintMessage: { create: vi.fn() },
		$transaction: vi.fn().mockResolvedValue([])
	}
}))
const { writeAuditLogMock } = vi.hoisted(() => ({
	writeAuditLogMock: vi.fn().mockResolvedValue(undefined)
}))
const { notifyMock } = vi.hoisted(() => ({ notifyMock: vi.fn().mockResolvedValue(undefined) }))

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: writeAuditLogMock }))
vi.mock('$lib/server/services/notifications', () => ({ notify: notifyMock }))

const { listComplaintsForEmployee } = await import('$lib/server/services/complaints')

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.hrComplaint.findMany.mockResolvedValue([])
	dbMock.hrComplaint.count.mockResolvedValue(0)
})

describe('complaints org scoping (#112)', () => {
	it('N1 — listComplaintsForEmployee carries an organizationId predicate', async () => {
		await listComplaintsForEmployee('emp1', 'org1')

		expect(dbMock.hrComplaint.findMany.mock.calls[0][0].where).toEqual({
			employeeId: 'emp1',
			organizationId: 'org1'
		})
	})
})
