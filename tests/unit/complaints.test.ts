import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuditContext } from '$lib/server/services/types'

/**
 * HR complaints/inquiries (#112): the two-way thread. Opening notifies the employee; a reply
 * flips status by author (employee → RESPONDED and pings HR, HR → OPEN and pings the employee);
 * a resolved thread rejects further replies. DB + audit + notifications are mocked so this is a
 * fast unit test of the transition logic.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		employee: { findFirst: vi.fn() },
		hrComplaint: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
		hrComplaintMessage: { create: vi.fn() },
		$transaction: vi.fn().mockResolvedValue([])
	}
}))
const { notifyMock } = vi.hoisted(() => ({ notifyMock: vi.fn().mockResolvedValue(undefined) }))

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/services/notifications', () => ({ notify: notifyMock }))

const { openComplaint, postComplaintMessage, resolveComplaint } =
	await import('$lib/server/services/complaints')

const CTX: AuditContext = { organizationId: 'org1', actorId: 'u-hr', actorRole: 'HR_ADMIN' }

function mockComplaint(overrides: Record<string, unknown> = {}) {
	dbMock.hrComplaint.findFirst.mockResolvedValue({
		id: 'c1',
		organizationId: 'org1',
		employeeId: 'emp1',
		status: 'OPEN',
		subject: 'Confirm classification',
		employee: { id: 'emp1', firstName: 'Elena', lastName: 'Employee', user: { id: 'u-emp' } },
		openedBy: { id: 'u-hr' },
		...overrides
	})
}

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.$transaction.mockResolvedValue([])
	dbMock.hrComplaint.update.mockResolvedValue({})
	dbMock.hrComplaintMessage.create.mockResolvedValue({})
})

describe('complaints service (#112)', () => {
	it('openComplaint seeds the thread and notifies the employee', async () => {
		dbMock.employee.findFirst.mockResolvedValue({ id: 'emp1', user: { id: 'u-emp' } })
		dbMock.hrComplaint.create.mockResolvedValue({ id: 'c1' })

		await openComplaint(
			{
				employeeId: 'emp1',
				subject: 'Confirm classification',
				category: 'CLASSIFICATION',
				message: 'What is your rate type?'
			},
			CTX
		)

		const created = dbMock.hrComplaint.create.mock.calls[0][0]
		expect(created.data.status).toBe('OPEN')
		expect(created.data.messages.create.body).toBe('What is your rate type?')
		expect(notifyMock).toHaveBeenCalledWith(
			'u-emp',
			expect.stringContaining('HR opened'),
			'/complaints/c1'
		)
	})

	it('rejects opening an inquiry against an employee outside the org', async () => {
		dbMock.employee.findFirst.mockResolvedValue(null)
		await expect(
			openComplaint({ employeeId: 'ghost', subject: 's', category: 'OTHER', message: 'm' }, CTX)
		).rejects.toMatchObject({ status: 404 })
	})

	it('employee reply → RESPONDED and notifies the opener (HR)', async () => {
		mockComplaint()
		const res = await postComplaintMessage('c1', 'My rate is monthly.', CTX, 'emp1')

		expect(res.status).toBe('RESPONDED')
		expect(dbMock.hrComplaint.update.mock.calls[0][0].data.status).toBe('RESPONDED')
		expect(notifyMock).toHaveBeenCalledWith(
			'u-hr',
			expect.stringContaining('responded'),
			'/complaints/c1'
		)
	})

	it('HR reply → OPEN and notifies the employee', async () => {
		mockComplaint()
		const res = await postComplaintMessage('c1', 'Thanks, following up.', CTX, 'emp-hr')

		expect(res.status).toBe('OPEN')
		expect(notifyMock).toHaveBeenCalledWith(
			'u-emp',
			expect.stringContaining('HR replied'),
			'/complaints/c1'
		)
	})

	it('a resolved inquiry rejects further replies', async () => {
		mockComplaint({ status: 'RESOLVED' })
		await expect(postComplaintMessage('c1', 'late reply', CTX, 'emp1')).rejects.toMatchObject({
			status: 400
		})
	})

	it('resolveComplaint sets RESOLVED and notifies the employee', async () => {
		mockComplaint({ status: 'RESPONDED', employee: { user: { id: 'u-emp' } } })
		dbMock.hrComplaint.update.mockResolvedValue({ id: 'c1', status: 'RESOLVED' })

		await resolveComplaint('c1', CTX)

		expect(dbMock.hrComplaint.update.mock.calls[0][0].data.status).toBe('RESOLVED')
		expect(notifyMock).toHaveBeenCalledWith(
			'u-emp',
			expect.stringContaining('resolved'),
			'/complaints/c1'
		)
	})
})
