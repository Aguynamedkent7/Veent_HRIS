import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #259 — `getManagerMetrics` resolved direct reports off `reportsToId` alone, with no organization
 * filter, so a row in another tenant naming this actor as its manager was counted as one of their
 * reports. That leaks aggregate counts of another org's pending timesheets and leave across the
 * tenant boundary, and inflates `teamHeadcount`.
 *
 * The read-side half of #235 (which closed the write side). #235 stops NEW cross-tenant
 * `reportsToId` values being planted; it does not clean rows written before it, so the read has to
 * defend itself.
 *
 * The mocked client applies the `where` clauses it is given to the fixtures below, rather than
 * asserting on the query shape — an org filter that is present but wrong still fails here.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		employee: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
		timesheet: { count: vi.fn() },
		request: { count: vi.fn() },
		auditLog: { findMany: vi.fn() }
	}
}))

vi.mock('$lib/server/db', () => ({ db: dbMock }))

const { getManagerMetrics } = await import('../../src/lib/server/services/dashboard')

const ORG_A = 'orgA'
const ORG_B = 'orgB'

// The actor: a PAYROLL_OFFICER/FINANCE user in org A (the only roles the dashboard route sends to
// getManagerMetrics — MANAGE_HR holders, MANAGER included, get getAdminMetrics instead).
const ACTOR = { id: 'empA', userId: 'uA', user: { organizationId: ORG_A } }

const EMPLOYEES = [
	ACTOR,
	// A genuine report, same org.
	{ id: 'empA1', reportsToId: 'empA', employmentStatus: 'ACTIVE', user: { organizationId: ORG_A } },
	// The planted row: another tenant's employee naming our actor as their manager.
	{ id: 'empB1', reportsToId: 'empA', employmentStatus: 'ACTIVE', user: { organizationId: ORG_B } }
]

const TIMESHEETS = [
	{ employeeId: 'empA1', status: 'SUBMITTED' },
	{ employeeId: 'empB1', status: 'SUBMITTED' }
]

const REQUESTS = [
	{ employeeId: 'empA1', type: 'LEAVE', status: 'PENDING' },
	{ employeeId: 'empB1', type: 'LEAVE', status: 'PENDING' }
]

// Only the operators getManagerMetrics actually uses.
type Where = Record<string, unknown>
const matches = (row: Record<string, unknown>, where: Where): boolean =>
	Object.entries(where).every(([key, cond]) => {
		if (key === 'user') {
			const org = (cond as { organizationId?: string }).organizationId
			return org === undefined || (row.user as { organizationId: string }).organizationId === org
		}
		if (cond && typeof cond === 'object' && 'in' in cond) {
			return (cond.in as unknown[]).includes(row[key])
		}
		return row[key] === cond
	})

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.employee.findFirst.mockImplementation(async ({ where }: { where: Where }) =>
		EMPLOYEES.find((e) => matches(e, where))
	)
	dbMock.employee.findMany.mockImplementation(async ({ where }: { where: Where }) =>
		EMPLOYEES.filter((e) => matches(e, where))
	)
	dbMock.employee.count.mockImplementation(
		async ({ where }: { where: Where }) => EMPLOYEES.filter((e) => matches(e, where)).length
	)
	dbMock.timesheet.count.mockImplementation(
		async ({ where }: { where: Where }) => TIMESHEETS.filter((t) => matches(t, where)).length
	)
	dbMock.request.count.mockImplementation(
		async ({ where }: { where: Where }) => REQUESTS.filter((r) => matches(r, where)).length
	)
	dbMock.auditLog.findMany.mockResolvedValue([])
})

describe('getManagerMetrics — a cross-tenant reportsToId must not leak counts (#259)', () => {
	it('counts only the reports inside the actor’s own organization', async () => {
		const metrics = await getManagerMetrics('uA', ORG_A)

		expect(metrics.teamHeadcount).toBe(1)
	})

	it('does not count another tenant’s pending timesheets or leave', async () => {
		const metrics = await getManagerMetrics('uA', ORG_A)

		expect(metrics.pendingApprovals).toEqual({ timesheets: 1, leave: 1 })
	})

	it('scopes the direct-reports lookup itself, not just the headcount', async () => {
		await getManagerMetrics('uA', ORG_A)

		const { where } = dbMock.employee.findMany.mock.calls[0][0]
		expect(where).toMatchObject({ reportsToId: 'empA', user: { organizationId: ORG_A } })
	})
})
