import { describe, it, expect } from 'vitest'
import {
	suggestNextReviewCycle,
	REVIEW_CADENCE_MONTHS
} from '../../src/lib/server/services/performance'

// #178 — evaluations run every 2 months, anchored to calendar bi-months. The suggestion
// prefills HR's create-cycle form and flags when the current period is overdue for a cycle.
describe('suggestNextReviewCycle (#178)', () => {
	it('runs on a 2-month cadence', () => {
		expect(REVIEW_CADENCE_MONTHS).toBe(2)
	})

	it('suggests the current bi-month period, marked due, when none exist', () => {
		const s = suggestNextReviewCycle(null, new Date('2026-07-23T00:00:00Z'))
		expect(s.name).toBe('Jul–Aug 2026')
		expect(s.startDate.toISOString().slice(0, 10)).toBe('2026-07-01')
		expect(s.endDate.toISOString().slice(0, 10)).toBe('2026-08-31')
		expect(s.due).toBe(true)
	})

	it('is due when the latest cycle is in an earlier period', () => {
		// Latest cycle was May–Jun; as of late July the Jul–Aug period is uncovered.
		const s = suggestNextReviewCycle(new Date('2026-05-01T00:00:00Z'), new Date('2026-07-23T00:00:00Z'))
		expect(s.name).toBe('Jul–Aug 2026')
		expect(s.due).toBe(true)
	})

	it('advances to the next period, not due, when the current one is already covered', () => {
		// A Jul–Aug cycle already exists; the next suggestion is Sep–Oct and not overdue.
		const s = suggestNextReviewCycle(new Date('2026-07-15T00:00:00Z'), new Date('2026-07-23T00:00:00Z'))
		expect(s.name).toBe('Sep–Oct 2026')
		expect(s.startDate.toISOString().slice(0, 10)).toBe('2026-09-01')
		expect(s.endDate.toISOString().slice(0, 10)).toBe('2026-10-31')
		expect(s.due).toBe(false)
	})

	it('rolls over the year after a Nov–Dec cycle', () => {
		const s = suggestNextReviewCycle(new Date('2026-11-10T00:00:00Z'), new Date('2026-12-05T00:00:00Z'))
		expect(s.name).toBe('Jan–Feb 2027')
		expect(s.startDate.toISOString().slice(0, 10)).toBe('2027-01-01')
		expect(s.due).toBe(false)
	})
})
