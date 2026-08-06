import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'

/**
 * #275, the requests half — `GET /api/v1/requests`.
 *
 * The route asked `hasAnyMinRole(user.roles, 'MANAGER')` and then handed the caller's `employeeId`
 * straight to `listRequests`, so any MANAGER read any employee's leave and OT history. With no
 * `employeeId` at all the filter was simply absent and the response was the whole organization.
 *
 * Second leak on the same line: a caller with NO employee record yielded `employeeId: undefined`,
 * which the where-builder drops — so the self-only path also returned the entire org. `[]` closes
 * it.
 *
 * Scoped with `listVisibleEmployeeIds`, the roster helper, not `listVisiblePayEmployeeIds`. The pay
 * helper's only difference is that it opens up for VIEW_PAY_ORGWIDE, which here would WIDEN the
 * route for PAYROLL_OFFICER and FINANCE — self-only today. Widening is a regression, not a fix.
 */

const { dbMock, listReportIdsFor, listRequests } = vi.hoisted(() => ({
	listReportIdsFor: vi.fn(),
	listRequests: vi.fn(),
	dbMock: {
		employee: { findUnique: vi.fn(), findMany: vi.fn() },
		branch: { findMany: vi.fn() }
	}
}))

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/services/supervisors', () => ({ listReportIdsFor }))
vi.mock('$lib/server/services/requests', () => ({ listRequests, createRequest: vi.fn() }))

const { GET } = await import('../../src/routes/api/v1/requests/+server')

const ACTOR_USER = 'user-actor'
const ORG = 'org1'
const SELF = 'self-emp'
const REPORT = 'report-emp'
const STRANGER = 'stranger-emp'

const event = (roles: Role[], employeeId?: string) =>
	({
		locals: { user: { id: ACTOR_USER, organizationId: ORG, role: roles[0], roles } },
		url: { searchParams: new URLSearchParams(employeeId ? { employeeId } : {}) }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any

/** What the route actually asked the service for. */
const params = () => listRequests.mock.calls[0][0]

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.employee.findUnique.mockResolvedValue({ id: SELF })
	listReportIdsFor.mockResolvedValue([REPORT])
	dbMock.branch.findMany.mockResolvedValue([])
	dbMock.employee.findMany.mockImplementation(({ where }) =>
		Promise.resolve((where.id?.in ?? []).map((id: string) => ({ id })))
	)
	listRequests.mockResolvedValue([])
})

describe('GET /api/v1/requests', () => {
	// This route throws `error(403)` rather than returning an `apiError` response — matching the file.
	it('refuses a MANAGER asking for an employee outside their line', async () => {
		await expect(GET(event(['MANAGER'], STRANGER))).rejects.toMatchObject({ status: 403 })
		expect(listRequests).not.toHaveBeenCalled()
	})

	it('lets a MANAGER ask for their own direct report', async () => {
		await GET(event(['MANAGER'], REPORT))
		expect(params().employeeIds).toEqual([REPORT])
	})

	// The default case, and the wider of the two leaks: no employeeId used to mean no filter.
	it('scopes an unfiltered MANAGER listing to their team', async () => {
		await GET(event(['MANAGER']))
		expect(params().employeeIds).toEqual(expect.arrayContaining([SELF, REPORT]))
		expect(params().employeeIds).not.toContain(STRANGER)
	})

	it('leaves an HR_ADMIN unrestricted', async () => {
		await GET(event(['HR_ADMIN']))
		expect(params().employeeIds).toBeUndefined()
	})

	it('lets an HR_ADMIN filter to any employee', async () => {
		await GET(event(['HR_ADMIN'], STRANGER))
		expect(params().employeeIds).toEqual([STRANGER])
	})

	/**
	 * The regression guard for the helper choice. FINANCE holds VIEW_PAY_ORGWIDE but not
	 * ADMINISTER_HR_ORGWIDE and does not clear the MANAGER rank, so it stays self-only here — using
	 * the pay helper would have opened the whole org's leave history to it.
	 */
	it('keeps FINANCE self-only', async () => {
		await GET(event(['FINANCE'], STRANGER))
		expect(params().employeeIds).toEqual([SELF])
	})

	it('keeps a PAYROLL_OFFICER self-only', async () => {
		await GET(event(['PAYROLL_OFFICER']))
		expect(params().employeeIds).toEqual([SELF])
	})

	it('keeps an EMPLOYEE to their own requests', async () => {
		await GET(event(['EMPLOYEE'], STRANGER))
		expect(params().employeeIds).toEqual([SELF])
	})

	// The second leak: no employee record must mean no rows, not every row.
	it('returns nothing for a non-manager with no employee record', async () => {
		dbMock.employee.findUnique.mockResolvedValue(null)
		await GET(event(['EMPLOYEE']))
		expect(params().employeeIds).toEqual([])
	})

	it('returns nothing for a MANAGER with no employee record', async () => {
		dbMock.employee.findUnique.mockResolvedValue(null)
		await GET(event(['MANAGER']))
		expect(params().employeeIds).toEqual([])
	})

	it('honours a secondary role carrying org-wide HR reach (#133)', async () => {
		await GET(event(['MANAGER', 'HR_ADMIN'], STRANGER))
		expect(params().employeeIds).toEqual([STRANGER])
	})
})
