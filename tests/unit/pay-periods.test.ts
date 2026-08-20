import { describe, it, expect } from 'vitest'
import {
	periodOf,
	describePeriod,
	isValidStandardPeriod,
	periodShareOf,
	isSameMonthRange,
	periodDays,
	daysInMonth,
	formatPeriodPreview,
	toPeriodInputValue
} from '../../src/lib/utils/pay-periods'

// Dates are UTC-midnight calendar days (see pay-periods.ts). Build expectations the same way.
const utc = (y: number, m1: number, d: number) => new Date(Date.UTC(y, m1 - 1, d))

describe('daysInMonth', () => {
	it('handles 30- and 31-day months', () => {
		expect(daysInMonth(2026, 0)).toBe(31) // January
		expect(daysInMonth(2026, 3)).toBe(30) // April
	})
	it('handles February leap vs non-leap years', () => {
		expect(daysInMonth(2024, 1)).toBe(29) // 2024 is a leap year
		expect(daysInMonth(2026, 1)).toBe(28) // 2026 is not
		expect(daysInMonth(2000, 1)).toBe(29) // century leap year
		expect(daysInMonth(1900, 1)).toBe(28) // century non-leap
	})
})

describe('periodOf', () => {
	it('FIRST_HALF is always the 1st–15th', () => {
		const { periodStart, periodEnd } = periodOf('FIRST_HALF', 2026, 4) // May
		expect(periodStart).toEqual(utc(2026, 5, 1))
		expect(periodEnd).toEqual(utc(2026, 5, 15))
	})
	it('SECOND_HALF runs 16th to a dynamic month end', () => {
		expect(periodOf('SECOND_HALF', 2026, 4).periodEnd).toEqual(utc(2026, 5, 31)) // May → 31
		expect(periodOf('SECOND_HALF', 2026, 1).periodEnd).toEqual(utc(2026, 2, 28)) // Feb non-leap
		expect(periodOf('SECOND_HALF', 2024, 1).periodEnd).toEqual(utc(2024, 2, 29)) // Feb leap
		expect(periodOf('SECOND_HALF', 2026, 3).periodEnd).toEqual(utc(2026, 4, 30)) // Apr → 30
	})
	it('WHOLE_MONTH spans the 1st to the month end', () => {
		const { periodStart, periodEnd } = periodOf('WHOLE_MONTH', 2024, 1) // leap Feb
		expect(periodStart).toEqual(utc(2024, 2, 1))
		expect(periodEnd).toEqual(utc(2024, 2, 29))
	})
})

describe('describePeriod round-trips periodOf', () => {
	for (const kind of ['FIRST_HALF', 'SECOND_HALF', 'WHOLE_MONTH'] as const) {
		it(`${kind} for a sampling of months`, () => {
			for (const month0 of [0, 1, 3, 4, 11]) {
				const { periodStart, periodEnd } = periodOf(kind, 2026, month0)
				const d = describePeriod(periodStart, periodEnd)
				expect(d.kind).toBe(kind)
				expect(d.year).toBe(2026)
				expect(d.month0).toBe(month0)
			}
		})
	}
	it('produces readable labels', () => {
		expect(describePeriod(...halves('FIRST_HALF')).label).toBe('May 2026 · 1–15')
		expect(describePeriod(...halves('SECOND_HALF')).label).toBe('May 2026 · 16–31')
		expect(describePeriod(...halves('WHOLE_MONTH')).label).toBe('May 2026 · Whole month')
	})
	it('labels Feb second-half with the correct dynamic end', () => {
		const [s, e] = [
			periodOf('SECOND_HALF', 2026, 1).periodStart,
			periodOf('SECOND_HALF', 2026, 1).periodEnd
		]
		expect(describePeriod(s, e).label).toBe('February 2026 · 16–28')
	})
})

function halves(kind: 'FIRST_HALF' | 'SECOND_HALF' | 'WHOLE_MONTH'): [Date, Date] {
	const p = periodOf(kind, 2026, 4) // May 2026
	return [p.periodStart, p.periodEnd]
}

describe('isValidStandardPeriod', () => {
	it('accepts the three standard shapes', () => {
		for (const kind of ['FIRST_HALF', 'SECOND_HALF', 'WHOLE_MONTH'] as const) {
			const { periodStart, periodEnd } = periodOf(kind, 2026, 6) // July
			expect(isValidStandardPeriod(periodStart, periodEnd)).toBe(true)
		}
	})
	// #163: these ranges are no longer *rejected* — a custom same-month range is now a legal
	// period. `isValidStandardPeriod` keeps its old answer because it only ever CLASSIFIES the
	// three standard shapes; the accept/reject decision moved to `isSameMonthRange`.
	it('classifies arbitrary / off-cycle ranges as non-standard', () => {
		expect(isValidStandardPeriod(utc(2026, 5, 13), utc(2026, 5, 21))).toBe(false) // mid-month week
		expect(isValidStandardPeriod(utc(2026, 5, 1), utc(2026, 5, 14))).toBe(false) // 1–14
		expect(isValidStandardPeriod(utc(2026, 5, 16), utc(2026, 5, 30))).toBe(false) // 16–30 in a 31-day month
		expect(isValidStandardPeriod(utc(2026, 5, 1), utc(2026, 6, 15))).toBe(false) // spans two months
	})
	it('rejects 16–30 but accepts 16–28 for February', () => {
		expect(isValidStandardPeriod(utc(2026, 2, 16), utc(2026, 2, 28))).toBe(true)
		expect(isValidStandardPeriod(utc(2026, 2, 16), utc(2026, 2, 27))).toBe(false)
	})
})

describe('isSameMonthRange (#163 custom-period sanity gate)', () => {
	it('accepts a same-month range', () => {
		expect(isSameMonthRange(utc(2026, 5, 13), utc(2026, 5, 21))).toBe(true)
	})
	it('accepts a single day', () => {
		expect(isSameMonthRange(utc(2026, 5, 13), utc(2026, 5, 13))).toBe(true)
	})
	it('rejects a reversed range', () => {
		expect(isSameMonthRange(utc(2026, 5, 21), utc(2026, 5, 13))).toBe(false)
	})
	it('rejects a cross-month range', () => {
		expect(isSameMonthRange(utc(2026, 5, 1), utc(2026, 6, 15))).toBe(false)
	})
	it('rejects the same day-of-month in a different year', () => {
		expect(isSameMonthRange(utc(2026, 5, 1), utc(2027, 5, 1))).toBe(false)
	})
	it('accepts the three standard shapes', () => {
		for (const kind of ['FIRST_HALF', 'SECOND_HALF', 'WHOLE_MONTH'] as const) {
			const { periodStart, periodEnd } = periodOf(kind, 2026, 4)
			expect(isSameMonthRange(periodStart, periodEnd)).toBe(true)
		}
	})
})

describe('periodShareOf', () => {
	// The frozen contract: the three standard shapes are EXACTLY 0.5 / 0.5 / 1 in every month
	// length. There is no single-formula simplification — May 1–15 is 15/31 = 0.4839 by day
	// count, and paying it that way would be the #163 regression this table exists to catch.
	it('is exactly 0.5 / 0.5 / 1 for the standard shapes in 28-, 29-, 30- and 31-day months', () => {
		const months: [string, number, number][] = [
			['January (31)', 2026, 0],
			['February 2026 (28)', 2026, 1],
			['February 2024 (29)', 2024, 1],
			['April (30)', 2026, 3]
		]
		for (const [, year, month0] of months) {
			const first = periodOf('FIRST_HALF', year, month0)
			const second = periodOf('SECOND_HALF', year, month0)
			const whole = periodOf('WHOLE_MONTH', year, month0)
			expect(periodShareOf(first.periodStart, first.periodEnd)).toBe(0.5)
			expect(periodShareOf(second.periodStart, second.periodEnd)).toBe(0.5)
			expect(periodShareOf(whole.periodStart, whole.periodEnd)).toBe(1)
		}
	})

	it('prorates a custom same-month range by inclusive day count', () => {
		expect(periodShareOf(utc(2026, 5, 13), utc(2026, 5, 21))).toBe(9 / 31) // 9 days of May
		expect(periodShareOf(utc(2026, 5, 3), utc(2026, 5, 9))).toBe(7 / 31) // 7 days of May
		expect(periodShareOf(utc(2026, 5, 13), utc(2026, 5, 13))).toBe(1 / 31) // single day
	})

	it('Feb 1–14 lands on 0.5 by day count, which is a coincidence of a 28-day month', () => {
		expect(periodShareOf(utc(2026, 2, 1), utc(2026, 2, 14))).toBe(14 / 28)
		expect(periodShareOf(utc(2026, 2, 1), utc(2026, 2, 14))).toBe(0.5)
	})

	it('every custom same-month share is > 0 and <= 1', () => {
		for (let end = 1; end <= 31; end++) {
			const share = periodShareOf(utc(2026, 5, 1), utc(2026, 5, end))
			expect(share).toBeGreaterThan(0)
			expect(share).toBeLessThanOrEqual(1)
		}
	})

	it('is monotonic — extending the end date never lowers the share', () => {
		let prev = 0
		for (let end = 3; end <= 31; end++) {
			const share = periodShareOf(utc(2026, 5, 3), utc(2026, 5, end))
			expect(share).toBeGreaterThanOrEqual(prev)
			prev = share
		}
	})

	// S3: `computePayroll` gates on run STATUS only, never on period shape, so any legacy stored
	// pair still reaches this function on Recompute. Day counting one would yield >100% of a
	// month's statutory, or a negative share (negative deductions). Both keep the historical 0.5.
	it('falls back to a flat 0.5 for adversarial legacy pairs, never > 1 or negative', () => {
		const adversarial: [Date, Date][] = [
			[utc(2026, 5, 1), utc(2026, 6, 15)], // cross-month, 46 days
			[utc(2026, 5, 1), utc(2026, 7, 31)], // cross-month, 92 days
			[utc(2026, 5, 21), utc(2026, 5, 13)], // reversed inside one month
			[utc(2026, 6, 1), utc(2026, 5, 1)], // reversed across months
			[utc(2026, 5, 1), utc(2027, 5, 1)] // same month number, different year
		]
		for (const [start, end] of adversarial) {
			const share = periodShareOf(start, end)
			expect(share).toBe(0.5)
			expect(share).toBeGreaterThan(0)
			expect(share).toBeLessThanOrEqual(1)
		}
	})
})

describe('periodDays', () => {
	it('counts inclusive days', () => {
		expect(periodDays(...halves('FIRST_HALF'))).toBe(15)
		expect(periodDays(...halves('SECOND_HALF'))).toBe(16) // May 16–31
		expect(periodDays(...halves('WHOLE_MONTH'))).toBe(31)
	})
})

describe('formatting helpers', () => {
	it('formatPeriodPreview reads as a human range', () => {
		expect(formatPeriodPreview(...halves('FIRST_HALF'))).toBe('May 1 – May 15, 2026 (15 days)')
	})
	it('toPeriodInputValue yields YYYY-MM-DD', () => {
		expect(toPeriodInputValue(utc(2026, 5, 1))).toBe('2026-05-01')
		expect(toPeriodInputValue(utc(2026, 2, 28))).toBe('2026-02-28')
	})
})
