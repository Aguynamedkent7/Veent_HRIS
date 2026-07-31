import { describe, it, expect } from 'vitest'
import { meetsLeaveTenure } from '$lib/server/services/requests/leave'
import { tenureRequirement } from '$lib/utils/dates'

// The SIL tenure gate (#137). The threshold is whole calendar months so it agrees exactly
// with the tenure shown on the 201 file — an employee reading "1 year" must be precisely
// the one allowed to file.
describe('meetsLeaveTenure', () => {
	const SIL = 12

	it('lets an ungated type through regardless of tenure', () => {
		const hiredToday = new Date('2026-07-21T00:00:00+08:00')
		expect(meetsLeaveTenure(hiredToday, 0, new Date('2026-07-21T00:00:00+08:00'))).toBe(true)
	})

	it('rejects the day before the first anniversary', () => {
		expect(
			meetsLeaveTenure(
				new Date('2025-07-21T00:00:00+08:00'),
				SIL,
				new Date('2026-07-20T00:00:00+08:00')
			)
		).toBe(false)
	})

	it('accepts exactly on the first anniversary', () => {
		expect(
			meetsLeaveTenure(
				new Date('2025-07-21T00:00:00+08:00'),
				SIL,
				new Date('2026-07-21T00:00:00+08:00')
			)
		).toBe(true)
	})

	it('accepts well past the threshold', () => {
		expect(
			meetsLeaveTenure(
				new Date('2020-01-15T00:00:00+08:00'),
				SIL,
				new Date('2026-07-21T00:00:00+08:00')
			)
		).toBe(true)
	})

	it('rejects at 11 months even on the eve of the anniversary month', () => {
		expect(
			meetsLeaveTenure(
				new Date('2025-08-31T00:00:00+08:00'),
				SIL,
				new Date('2026-08-30T00:00:00+08:00')
			)
		).toBe(false)
	})

	// The gate runs on the server, which may be UTC. A start date late in the PHT day is
	// the previous day in UTC, so a naive comparison would shift the anniversary by one and
	// hand out SIL a day early.
	it('buckets both ends in PHT, so a UTC-evening start date does not shift the anniversary', () => {
		// Start: 2025-07-21 07:00 PHT === 2025-07-20 23:00 UTC — the PHT and UTC calendar
		// days disagree, which is exactly what a naive UTC slice gets wrong.
		const start = new Date('2025-07-20T23:00:00Z')

		// 2026-07-20 22:00 PHT — still the 20th in PHT, so the anniversary has not landed.
		// Comparing UTC dates instead would see 20 vs 20 and grant SIL a day early.
		expect(meetsLeaveTenure(start, SIL, new Date('2026-07-20T14:00:00Z'))).toBe(false)

		// 2026-07-21 00:30 PHT — the anniversary day itself.
		expect(meetsLeaveTenure(start, SIL, new Date('2026-07-20T16:30:00Z'))).toBe(true)
	})

	it('treats a negative threshold as ungated rather than throwing', () => {
		expect(meetsLeaveTenure(new Date('2026-07-21T00:00:00+08:00'), -1)).toBe(true)
	})
})

describe('tenureRequirement', () => {
	it('renders the SIL threshold as the message the issue specifies', () => {
		expect(
			`Service Incentive Leave becomes available after ${tenureRequirement(12)} of employment.`
		).toBe('Service Incentive Leave becomes available after 1 year of employment.')
	})

	it('renders sub-year and mixed thresholds', () => {
		expect(tenureRequirement(6)).toBe('6 months')
		expect(tenureRequirement(1)).toBe('1 month')
		expect(tenureRequirement(18)).toBe('1 year, 6 months')
		expect(tenureRequirement(24)).toBe('2 years')
	})
})
