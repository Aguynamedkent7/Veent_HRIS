import { describe, it, expect, vi, beforeEach } from 'vitest'
import { periodOf } from '../../src/lib/utils/pay-periods'

/**
 * #163 (review round 2) — `assertCustomRangeClearOfCutoff`.
 *
 * A FIRST/SECOND statutory allocation loads the WHOLE month's employee share onto one standard
 * run and every other run in that month takes ZERO. That is only sound while the designated run
 * can still be created, and the overlap guard refuses it once a custom run covers those days.
 * Instead of tracking that ambiguity through the engine, the ambiguity is made impossible: a
 * custom range may not touch a designated cutoff window.
 *
 * `employeeStatutoryConfig.findMany` is mocked with a real predicate over an in-memory row set,
 * applying the exact `where` + `distinct` the guard builds — a canned array would prove nothing
 * about the org scoping, the ACTIVE filter or the EVEN exclusion.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: { employeeStatutoryConfig: { findMany: vi.fn() } }
}))
vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

const { assertCustomRangeClearOfCutoff } = await import('$lib/server/services/payroll/index')

const ORG = 'org1'
const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

type Row = {
	organizationId: string
	employmentStatus: string
	allocation: 'EVEN' | 'FIRST' | 'SECOND'
}
type Where = {
	employee: { organizationId: string; employmentStatus: string }
	allocation: { not: string }
}

let rows: Row[] = []

const config = (allocation: Row['allocation'], over: Partial<Row> = {}): Row => ({
	organizationId: ORG,
	employmentStatus: 'ACTIVE',
	allocation,
	...over
})

beforeEach(() => {
	vi.clearAllMocks()
	rows = []
	dbMock.employeeStatutoryConfig.findMany.mockImplementation(
		async ({ where, distinct }: { where: Where; distinct: string[] }) => {
			const hits = rows.filter(
				(r) =>
					r.organizationId === where.employee.organizationId &&
					r.employmentStatus === where.employee.employmentStatus &&
					r.allocation !== where.allocation.not
			)
			expect(distinct).toEqual(['allocation'])
			const seen = new Set<string>()
			return hits
				.filter((r) => !seen.has(r.allocation) && seen.add(r.allocation))
				.map((r) => ({ allocation: r.allocation }))
		}
	)
})

const check = (start: string, end: string) => assertCustomRangeClearOfCutoff(ORG, d(start), d(end))

const refusal = async (start: string, end: string) => {
	try {
		await check(start, end)
	} catch (e) {
		return e as { status: number; body: { message: string } }
	}
	return null
}

describe('an EVEN-only organization is unrestricted', () => {
	it('allows a custom range anywhere in the month', async () => {
		rows = [config('EVEN')] // the default; excluded by the `not: EVEN` filter
		await expect(check('2026-05-03', '2026-05-09')).resolves.toBeUndefined()
		await expect(check('2026-05-14', '2026-05-18')).resolves.toBeUndefined()
		await expect(check('2026-05-20', '2026-05-25')).resolves.toBeUndefined()
	})

	it('allows a custom range when the org has no config rows at all', async () => {
		await expect(check('2026-05-03', '2026-05-09')).resolves.toBeUndefined()
	})

	// Another org's FIRST employee must not restrict this org.
	it('ignores a FIRST employee in a different organization', async () => {
		rows = [config('FIRST', { organizationId: 'org2' })]
		await expect(check('2026-05-03', '2026-05-09')).resolves.toBeUndefined()
	})

	// A separated employee's stale config row must not lock the month either.
	it('ignores a FIRST employee who is no longer ACTIVE', async () => {
		rows = [config('FIRST', { employmentStatus: 'OFFBOARDED' })]
		await expect(check('2026-05-03', '2026-05-09')).resolves.toBeUndefined()
	})
})

describe('with a FIRST employee, the 1–15 window is protected', () => {
	beforeEach(() => {
		rows = [config('FIRST')]
	})

	it('refuses a custom range inside 1–15 with a 400 naming the window', async () => {
		const e = await refusal('2026-05-03', '2026-05-09')
		expect(e?.status).toBe(400)
		expect(e?.body.message).toContain('1–15')
		expect(e?.body.message).toContain('First half')
	})

	it('refuses a custom range that merely clips the window', async () => {
		expect((await refusal('2026-05-15', '2026-05-20'))?.status).toBe(400)
		expect((await refusal('2026-05-01', '2026-05-02'))?.status).toBe(400)
	})

	it('allows a custom range wholly inside 16–EOM', async () => {
		await expect(check('2026-05-16', '2026-05-20')).resolves.toBeUndefined()
		await expect(check('2026-05-25', '2026-05-31')).resolves.toBeUndefined()
	})
})

describe('with a SECOND employee, the 16–EOM window is protected', () => {
	beforeEach(() => {
		rows = [config('SECOND')]
	})

	it('refuses a custom range inside 16–EOM with a 400 naming the window', async () => {
		const e = await refusal('2026-05-20', '2026-05-25')
		expect(e?.status).toBe(400)
		expect(e?.body.message).toContain('16–31') // May has 31 days
		expect(e?.body.message).toContain('Second half')
	})

	it('allows a custom range wholly inside 1–15', async () => {
		await expect(check('2026-05-03', '2026-05-09')).resolves.toBeUndefined()
	})

	// The end-of-month day is dynamic, so the label must follow the month.
	it('names February’s real end of month', async () => {
		const e = await refusal('2026-02-20', '2026-02-25')
		expect(e?.body.message).toContain('16–28')
	})
})

describe('both allocations present', () => {
	it('leaves no custom range in the month', async () => {
		rows = [config('FIRST'), config('SECOND')]
		expect((await refusal('2026-05-03', '2026-05-09'))?.status).toBe(400)
		expect((await refusal('2026-05-20', '2026-05-25'))?.status).toBe(400)
	})
})

describe('a STANDARD period is never refused', () => {
	it('passes every standard shape regardless of allocation', async () => {
		rows = [config('FIRST'), config('SECOND')]
		for (const kind of ['FIRST_HALF', 'SECOND_HALF', 'WHOLE_MONTH'] as const) {
			const p = periodOf(kind, 2026, 4)
			await expect(
				assertCustomRangeClearOfCutoff(ORG, p.periodStart, p.periodEnd)
			).resolves.toBeUndefined()
		}
		// The allocation table is never even read for a standard period.
		expect(dbMock.employeeStatutoryConfig.findMany).not.toHaveBeenCalled()
	})
})
