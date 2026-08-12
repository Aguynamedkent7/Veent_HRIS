import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'

/**
 * The queue and badge mirrors of the #283 separation-of-duties bar.
 *
 * DECISION-4's whole justification for putting the guard inside `canActOnStage` rather than inline
 * in `decide()` was that the queues and the sidebar badge would inherit it structurally. VALIDATE
 * found that mirror was untested repo-wide — nothing covered listPendingRequestsForApprover,
 * countPendingApprovals, countActionableTimesheets or countActionablePayrollRuns. The plan's
 * central architectural argument was unproven by construction. This file is what makes it true.
 *
 * Every case asserts contents or a count, never that the call resolved. A "did not throw"
 * assertion on a function returning a number proves nothing, and this repo has shipped that
 * mistake before.
 *
 * The failure mode these are really aimed at is silent: if a query forgets to select `actorId`,
 * decidedActorIds returns [] for every row and the bar stops existing — with the pure-function
 * tests in approval-self-guard.test.ts still green.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		request: { findMany: vi.fn() },
		timesheet: { findMany: vi.fn() },
		payrollRun: { findMany: vi.fn() },
		employee: { findUnique: vi.fn() },
		actionProposal: { findMany: vi.fn() }
	}
}))
vi.mock('$lib/server/db', () => ({ db: dbMock }))

const {
	listPendingRequestsForApprover,
	countActionableTimesheets,
	countActionablePayrollRuns,
	countPendingApprovals
} = await import('$lib/server/services/approvals')

/**
 * Emulates Prisma's projection for the nested `approvalSteps` select.
 *
 * A flat mockResolvedValue hands back the whole fixture row whatever the query asked for, which
 * makes "the guard reads this field" assertions VACUOUS: drop `actorId: true` from the real select
 * and every test here still passes while the bar silently stops existing in production. That is
 * the exact silent-failure mode DEC-2 is supposed to catch, and it slipped through the first
 * version of this file. Same trap as dashboard-org-scoping.test.ts and audit-log-reveal.test.ts
 * (#242) — reach for this helper whenever a test asserts what a query DOES or does not return.
 */
const projectSteps = <T extends { approvalSteps: Record<string, unknown>[] }>(
	rows: T[],
	args: { select?: { approvalSteps?: { select?: Record<string, true> } } }
) => {
	const fields = args?.select?.approvalSteps?.select
	if (!fields) return rows
	return rows.map((r) => ({
		...r,
		approvalSteps: r.approvalSteps.map((s) =>
			Object.fromEntries(Object.keys(fields).map((k) => [k, s[k]]))
		)
	}))
}

const VIEWER = 'user-viewer'
const TWO_HAT: Role[] = ['VERIFIER', 'APPROVER']

// A PENDING request sitting on its APPROVE stage, whose VERIFY was signed by `verifiedBy`.
const requestAt = (id: string, verifiedBy: string) => ({
	id,
	currentStage: 1,
	employeeId: `emp-${id}`,
	steps: [
		{ attempt: 1, stageIndex: 0, stage: 'VERIFY', decision: 'APPROVED', actorId: verifiedBy },
		{ attempt: 1, stageIndex: 1, stage: 'APPROVE', decision: null, actorId: null }
	],
	employee: { id: `emp-${id}`, firstName: 'A', lastName: 'B', reportsToId: null },
	documents: []
})

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.employee.findUnique.mockResolvedValue({ id: 'emp-viewer' })
	dbMock.actionProposal.findMany.mockResolvedValue([])
	dbMock.timesheet.findMany.mockResolvedValue([])
	dbMock.payrollRun.findMany.mockResolvedValue([])
})

describe('listPendingRequestsForApprover (#283/AC-15)', () => {
	it('excludes a request the viewer already decided a stage of', async () => {
		dbMock.request.findMany.mockResolvedValue([
			requestAt('own', VIEWER),
			requestAt('other', 'user-someone-else')
		])

		const rows = await listPendingRequestsForApprover('org1', TWO_HAT, 'emp-viewer', VIEWER)

		// The negative control is the point: a bar that excluded everything would pass a
		// "does not contain own" assertion just as well.
		expect(rows.map((r) => r.id)).toEqual(['other'])
	})

	it('still returns the same request for a different approver', async () => {
		dbMock.request.findMany.mockResolvedValue([requestAt('own', VIEWER)])

		const rows = await listPendingRequestsForApprover('org1', TWO_HAT, 'emp-x', 'user-other')
		expect(rows.map((r) => r.id)).toEqual(['own'])
	})
})

describe('countActionableTimesheets (#283/DEC-2)', () => {
	const timesheetAt = (verifiedBy: string) => ({
		employeeId: 'emp-someone',
		approvalSteps: [
			{ attempt: 1, stageIndex: 0, stage: 'VERIFY', decision: 'APPROVED', actorId: verifiedBy },
			{ attempt: 1, stageIndex: 1, stage: 'APPROVE', decision: null, actorId: null }
		]
	})

	it('excludes a timesheet the viewer already decided', async () => {
		const rows = [timesheetAt(VIEWER), timesheetAt('user-else')]
		dbMock.timesheet.findMany.mockImplementation(async (args: never) => projectSteps(rows, args))

		expect(await countActionableTimesheets('org1', TWO_HAT, 'emp-viewer', VIEWER)).toBe(1)
	})
})

describe('countActionablePayrollRuns (#283/AC-27 count half)', () => {
	const runAt = (verifiedBy: string, madeBy = 'user-maker') => ({
		approvalSteps: [
			{ id: 'm', attempt: 1, stageIndex: 0, stage: 'MAKE', decision: 'APPROVED', actorId: madeBy },
			{
				id: 'v',
				attempt: 1,
				stageIndex: 1,
				stage: 'VERIFY',
				decision: 'APPROVED',
				actorId: verifiedBy
			},
			{ id: 'a', attempt: 1, stageIndex: 2, stage: 'APPROVE', decision: null, actorId: null }
		]
	})

	it('excludes a run the viewer verified', async () => {
		const rows = [runAt(VIEWER), runAt('user-else')]
		dbMock.payrollRun.findMany.mockImplementation(async (args: never) => projectSteps(rows, args))

		expect(await countActionablePayrollRuns('org1', ['VERIFIER', 'CEO'], VIEWER)).toBe(1)
	})

	// The clause `&& makeActorId !== userId` was deleted as subsumed. This proves the subsumption
	// rather than assuming it: the maker must still be excluded, now via decidedActorIds.
	it('still excludes the run the viewer prepared, with no maker clause left', async () => {
		const rows = [runAt('user-else', VIEWER)]
		dbMock.payrollRun.findMany.mockImplementation(async (args: never) => projectSteps(rows, args))

		expect(await countActionablePayrollRuns('org1', ['VERIFIER', 'CEO'], VIEWER)).toBe(0)
	})
})

describe('countPendingApprovals — the sidebar badge (#283/US-8)', () => {
	// US-8: "my to-do count tells the truth." The badge must agree with the queue, or the user is
	// sent looking for work that is not there.
	it('counts only the requests the queue would show', async () => {
		dbMock.request.findMany.mockResolvedValue([
			requestAt('own', VIEWER),
			requestAt('other', 'user-else')
		])

		const counts = await countPendingApprovals({
			id: VIEWER,
			roles: TWO_HAT,
			organizationId: 'org1'
		})

		expect(counts.requests).toBe(1)
		expect(counts.total).toBe(1)
	})
})
