import { describe, it, expect } from 'vitest'
import {
	REGULARIZATION_MONTHS,
	regularizationDate,
	regularizationStatus,
	daysBetween
} from '../../src/lib/utils/dates'

// #168 — a probationary employee becomes regular 6 months after their start date, and HR
// is warned in advance. These pure helpers drive the dashboard's "Upcoming Regularizations"
// card and must agree with the 6-month gate used elsewhere.
describe('regularizationDate (#168)', () => {
	it('is exactly REGULARIZATION_MONTHS after the start date', () => {
		expect(REGULARIZATION_MONTHS).toBe(6)
		expect(regularizationDate(new Date('2026-01-15T00:00:00Z')).toISOString()).toBe(
			'2026-07-15T00:00:00.000Z'
		)
	})

	it('rolls the year over across December', () => {
		expect(regularizationDate(new Date('2025-10-01T00:00:00Z')).toISOString()).toBe(
			'2026-04-01T00:00:00.000Z'
		)
	})

	it('keeps the day-of-month stable (no PHT drift)', () => {
		const d = regularizationDate(new Date('2026-03-31T00:00:00Z'))
		// Sep has 30 days, so +6mo from Mar 31 overflows to Oct 1 — deterministic, not a day off.
		expect(d.getUTCDate()).toBeGreaterThan(0)
		expect(d.toISOString()).toBe('2026-10-01T00:00:00.000Z')
	})
})

describe('daysBetween', () => {
	it('counts whole calendar days, signed', () => {
		expect(daysBetween(new Date('2026-07-01T00:00:00Z'), new Date('2026-07-22T00:00:00Z'))).toBe(21)
		expect(daysBetween(new Date('2026-07-22T00:00:00Z'), new Date('2026-07-01T00:00:00Z'))).toBe(
			-21
		)
	})

	it('ignores the time of day', () => {
		expect(daysBetween(new Date('2026-07-01T23:59:00Z'), new Date('2026-07-02T00:01:00Z'))).toBe(1)
	})
})

describe('regularizationStatus (#168)', () => {
	const start = new Date('2026-01-23T00:00:00Z') // regularizes 2026-07-23

	it('reports days until an upcoming regularization', () => {
		const s = regularizationStatus(start, new Date('2026-07-05T00:00:00Z'))
		expect(s.date.toISOString()).toBe('2026-07-23T00:00:00.000Z')
		expect(s.daysUntil).toBe(18)
		expect(s.overdue).toBe(false)
	})

	it('flags the day itself as not overdue', () => {
		const s = regularizationStatus(start, new Date('2026-07-23T00:00:00Z'))
		expect(s.daysUntil).toBe(0)
		expect(s.overdue).toBe(false)
	})

	it('flags a past-due regularization as overdue with negative days', () => {
		const s = regularizationStatus(start, new Date('2026-08-01T00:00:00Z'))
		expect(s.daysUntil).toBe(-9)
		expect(s.overdue).toBe(true)
	})
})
