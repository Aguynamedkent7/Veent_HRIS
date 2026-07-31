import { describe, it, expect } from 'vitest'
import { monthsOfService, tenureLabel } from '../../src/lib/utils/dates'

// #136 — tenure math. monthsOfService is the shared primitive: the label shown on the 201
// file and the 6-month regularization gate must never disagree, or an employee reading
// "5 months" could be promoted.
const d = (iso: string) => new Date(`${iso}T00:00:00+08:00`) // a PHT calendar day

describe('monthsOfService', () => {
	it('counts whole calendar months', () => {
		expect(monthsOfService(d('2026-01-15'), d('2026-07-15'))).toBe(6)
		expect(monthsOfService(d('2025-01-15'), d('2026-07-15'))).toBe(18)
	})

	// The boundary the regularization gate turns on.
	it('does not count the month until the anniversary day is reached', () => {
		expect(monthsOfService(d('2026-01-15'), d('2026-07-14'))).toBe(5)
		expect(monthsOfService(d('2026-01-15'), d('2026-07-15'))).toBe(6)
	})

	it('is 0 below a month, and never negative for a future start', () => {
		expect(monthsOfService(d('2026-07-01'), d('2026-07-28'))).toBe(0)
		expect(monthsOfService(d('2026-12-01'), d('2026-07-15'))).toBe(0)
	})

	it('handles a month-end start rolling into a shorter month', () => {
		// Jan 31 → Feb 28: the 31st never arrives in February, so it is not yet a month.
		expect(monthsOfService(d('2026-01-31'), d('2026-02-28'))).toBe(0)
		expect(monthsOfService(d('2026-01-31'), d('2026-03-31'))).toBe(2)
	})

	// Both ends go through manilaDayKey, so an instant late in the UTC day (already the
	// next day in PHT) must be bucketed as PHT — not shifted a month by a raw UTC read.
	it('buckets both ends in Philippine time', () => {
		// 2026-01-14 17:00Z is 2026-01-15 01:00 PHT — the anniversary day in PHT.
		const startLateUtc = new Date('2026-01-14T17:00:00.000Z')
		expect(monthsOfService(startLateUtc, d('2026-07-15'))).toBe(6)
	})
})

describe('tenureLabel', () => {
	it('reads naturally for years and months', () => {
		expect(tenureLabel(d('2024-01-15'), d('2026-04-15'))).toBe('2 years, 3 months')
		expect(tenureLabel(d('2025-07-15'), d('2026-07-15'))).toBe('1 year')
		expect(tenureLabel(d('2026-02-15'), d('2026-07-15'))).toBe('5 months')
		expect(tenureLabel(d('2026-06-15'), d('2026-07-15'))).toBe('1 month')
	})

	it('says "less than a month" instead of "0 months"', () => {
		expect(tenureLabel(d('2026-07-01'), d('2026-07-28'))).toBe('less than a month')
	})

	// Offboarded staff freeze at their last day rather than accruing forever.
	it('freezes at endDate when one is given', () => {
		const frozen = tenureLabel(d('2024-01-15'), d('2025-01-15'))
		expect(frozen).toBe('1 year')
	})
})
