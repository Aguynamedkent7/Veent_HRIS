import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'

/**
 * #282 §3-B — `/performance/reviews/[id]`.
 *
 * The comment on the guard says "a review is private to its two participants… HR may read any
 * review in the org", but the guard was `requireAnyMinRole(user.roles,'HR_ADMIN')`, which MANAGER
 * clears (#133) — so any manager read any employee's self-assessment, manager comments and rating.
 *
 * Fixed with `assertCanTouchEmployee` (decision B3), the object-level check. Note this both NARROWS
 * (a manager loses strangers) and WIDENS (an EMPLOYEE-role supervisor or branch manager gains their
 * own people, who are 403'd today) — accepted knowingly, because it matches how /employees/[id]
 * already scopes exactly those people.
 */

const { dbMock, listReportIdsFor, getReview, redactHrAuthored } = vi.hoisted(() => ({
	listReportIdsFor: vi.fn(),
	getReview: vi.fn(),
	redactHrAuthored: vi.fn((r) => r),
	dbMock: {
		employee: { findUnique: vi.fn(), findFirst: vi.fn() },
		branch: { findMany: vi.fn() }
	}
}))

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/services/supervisors', () => ({ listReportIdsFor }))
vi.mock('$lib/server/services/performance', () => ({
	getReview,
	redactHrAuthored,
	saveSelfAssessment: vi.fn(),
	submitManagerReview: vi.fn(),
	acknowledgeReview: vi.fn()
}))

const { load } = await import('../../src/routes/(app)/performance/reviews/[id]/+page.server')

const ORG = 'org1'
const ME = 'me-emp'
const SUBJECT = 'subject-emp'
const REVIEWER = 'reviewer-emp'

const event = (roles: Role[]) =>
	({
		locals: { user: { id: 'user-actor', organizationId: ORG, role: roles[0], roles } },
		params: { id: 'review1' }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any

/** `PageServerLoad` widens its return to `void | …`; every case here wants the object. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadData = (roles: Role[]) => load(event(roles)) as Promise<any>

beforeEach(() => {
	vi.clearAllMocks()
	getReview.mockResolvedValue({
		id: 'review1',
		employee: { id: SUBJECT },
		reviewer: { id: REVIEWER },
		managerComments: 'private',
		overallRating: 4
	})
	// The route's "who am I" lookup and `canTouchEmployee`'s both go through findUnique.
	dbMock.employee.findUnique.mockResolvedValue({ id: ME })
	dbMock.employee.findFirst.mockResolvedValue({ branchId: null })
	dbMock.branch.findMany.mockResolvedValue([])
	listReportIdsFor.mockResolvedValue([])
})

describe('review privacy is object-scoped, not rank-scoped (#282 §3-B)', () => {
	it('denies a MANAGER who is neither participant nor the subject’s manager', async () => {
		await expect(load(event(['MANAGER']))).rejects.toMatchObject({ status: 403 })
		// The leak was the review body coming back — pin that nothing is returned, not just a status.
		expect(redactHrAuthored).not.toHaveBeenCalled()
	})

	it('allows HR_ADMIN any review in the org', async () => {
		const res = await loadData(['HR_ADMIN'])
		expect(res.review).toMatchObject({ id: 'review1' })
		expect(res.isSubject).toBe(false)
	})

	it('allows a MANAGER the review of their own report (B3)', async () => {
		listReportIdsFor.mockResolvedValue([SUBJECT])
		const res = await loadData(['MANAGER'])
		expect(res.review).toMatchObject({ id: 'review1' })
	})

	it('still lets the subject read their own review, redacted (#179)', async () => {
		dbMock.employee.findUnique.mockResolvedValue({ id: SUBJECT })
		const res = await loadData(['EMPLOYEE'])
		expect(res.isSubject).toBe(true)
		// Pins that the fix did not over-narrow: a participant never reaches the object check.
		expect(redactHrAuthored).toHaveBeenCalled()
	})

	it('still lets the reviewer read it unredacted', async () => {
		dbMock.employee.findUnique.mockResolvedValue({ id: REVIEWER })
		const res = await loadData(['EMPLOYEE'])
		expect(res.isReviewer).toBe(true)
		expect(redactHrAuthored).not.toHaveBeenCalled()
	})
})
