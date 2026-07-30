import { describe, it, expect } from 'vitest'
import {
	compensationForPeriod,
	currentCompensation,
	type CompRow
} from '$lib/server/services/payroll/compensation'
import { periodDays } from '$lib/utils/pay-periods'
import { D } from '$lib/server/services/payroll/money'

// #170/#171 Stage 0: the pure mid-period compensation resolver. Dates are UTC-midnight (month is
// 1-based here for readability). `calDays` stands in for the injected working-day counter unless a
// test needs a bespoke working-day shape.
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day))
const calDays = (s: Date, e: Date) => periodDays(s, e)
const str = (m: { toString(): string }) => m.toString()

const row = (
	effYMD: [number, number, number],
	salary: number,
	rateType: CompRow['rateType'] = 'MONTHLY',
	changedAt = d(2000, 1, 1)
): CompRow => ({
	basicMonthlySalary: salary,
	rateType,
	effectiveDate: d(...effYMD),
	changedAt
})

// May 2026 halves.
const MAY = 5
const first = { start: d(2026, MAY, 1), end: d(2026, MAY, 15) } // FIRST_HALF
const second = { start: d(2026, MAY, 16), end: d(2026, MAY, 31) } // SECOND_HALF
const FALLBACK = { basicMonthlySalary: 30000, rateType: 'MONTHLY' as const }

describe('compensationForPeriod — parity (no in-period change)', () => {
	it('empty history → one full-period segment, weight == periodShare, all comps = fallback', () => {
		const r = compensationForPeriod([], first.start, first.end, 0.5, FALLBACK, calDays)
		expect(r.segments).toHaveLength(1)
		expect(str(r.segments[0].weight)).toBe('0.5')
		expect(str(r.segments[0].salary)).toBe('30000')
		expect(str(r.statutoryBasis.salary)).toBe('30000')
		expect(str(r.periodEnd.salary)).toBe('30000')
		expect(r.segments[0].start).toEqual(first.start)
		expect(r.segments[0].end).toEqual(first.end)
	})

	it('hire baseline effective before the period → still one segment; statutoryBasis == periodEnd', () => {
		// Distinct from FALLBACK (30000) so the assertions prove the pre-period history row is used, not the fallback.
		const hist = [row([2024, 1, 1], 28000)]
		const r = compensationForPeriod(hist, second.start, second.end, 0.5, FALLBACK, calDays)
		expect(r.segments).toHaveLength(1)
		expect(str(r.segments[0].weight)).toBe('0.5')
		expect(str(r.statutoryBasis.salary)).toBe('28000')
		expect(str(r.periodEnd.salary)).toBe('28000')
	})

	it('WHOLE_MONTH share of 1 with no change → single segment weight 1', () => {
		const r = compensationForPeriod([], d(2026, MAY, 1), second.end, 1, FALLBACK, calDays)
		expect(r.segments).toHaveLength(1)
		expect(str(r.segments[0].weight)).toBe('1')
	})
})

describe('compensationForPeriod — mid-period split (#170)', () => {
	it('a raise on day 5 of a FIRST_HALF period splits into two segments; statutory lags (decision B)', () => {
		const hist = [row([2024, 1, 1], 30000), row([2026, MAY, 5], 40000)]
		const r = compensationForPeriod(hist, first.start, first.end, 0.5, FALLBACK, calDays)

		expect(r.segments).toHaveLength(2)
		// Segment 1: May 1–4 @ old; Segment 2: May 5–15 @ new.
		expect([r.segments[0].start, r.segments[0].end]).toEqual([d(2026, MAY, 1), d(2026, MAY, 4)])
		expect([r.segments[1].start, r.segments[1].end]).toEqual([d(2026, MAY, 5), d(2026, MAY, 15)])
		expect(str(r.segments[0].salary)).toBe('30000')
		expect(str(r.segments[1].salary)).toBe('40000')

		// Decision B: statutory uses the day-1-of-month comp (old); basic pay recognizes the raise
		// in-period so periodEnd is the new salary.
		expect(str(r.statutoryBasis.salary)).toBe('30000')
		expect(str(r.periodEnd.salary)).toBe('40000')

		// Weights (calendar-day here): 4/15 and 11/15 of periodShare 0.5, summing to 0.5.
		const sum = r.segments.reduce((a, s) => a.plus(s.weight), D(0))
		expect(str(sum)).toBe('0.5')
	})

	it('SECOND_HALF period whose month had a day-5 raise: basic uses new, statutory still lags to old', () => {
		const hist = [row([2024, 1, 1], 30000), row([2026, MAY, 5], 40000)]
		const r = compensationForPeriod(hist, second.start, second.end, 0.5, FALLBACK, calDays)
		// The change is before this period, so no in-period boundary → one segment at the new salary.
		expect(r.segments).toHaveLength(1)
		expect(str(r.segments[0].salary)).toBe('40000')
		// But statutory for the whole month stays on the day-1 (old) salary.
		expect(str(r.statutoryBasis.salary)).toBe('30000')
		expect(str(r.periodEnd.salary)).toBe('40000')
	})

	it('a change effective on day 1 counts that month (single segment, new salary, statutory new)', () => {
		const hist = [row([2024, 1, 1], 30000), row([2026, MAY, 1], 40000)]
		const r = compensationForPeriod(hist, first.start, first.end, 0.5, FALLBACK, calDays)
		expect(r.segments).toHaveLength(1)
		expect(str(r.segments[0].salary)).toBe('40000')
		expect(str(r.statutoryBasis.salary)).toBe('40000')
	})

	it('two in-period changes → three segments in order', () => {
		const hist = [row([2024, 1, 1], 30000), row([2026, MAY, 6], 35000), row([2026, MAY, 11], 40000)]
		const r = compensationForPeriod(hist, first.start, first.end, 0.5, FALLBACK, calDays)
		expect(r.segments.map((s) => str(s.salary))).toEqual(['30000', '35000', '40000'])
		expect(r.segments.map((s) => [s.start.getUTCDate(), s.end.getUTCDate()])).toEqual([
			[1, 5],
			[6, 10],
			[11, 15]
		])
	})
})

describe('compensationForPeriod — ordering, tiebreaks, backdating', () => {
	it('unsorted input is sorted; same-day changes tiebreak by changedAt (last wins)', () => {
		const hist = [
			row([2026, MAY, 5], 40000, 'MONTHLY', d(2026, MAY, 5)),
			row([2024, 1, 1], 30000),
			row([2026, MAY, 5], 45000, 'MONTHLY', d(2026, MAY, 6)) // later changedAt, same effectiveDate
		]
		const r = compensationForPeriod(hist, first.start, first.end, 0.5, FALLBACK, calDays)
		expect(r.segments).toHaveLength(2)
		expect(str(r.segments[1].salary)).toBe('45000') // the later same-day row wins
	})

	it('a rateType change carries through (pay-type, #171)', () => {
		const hist = [row([2024, 1, 1], 30000, 'MONTHLY'), row([2026, MAY, 8], 250, 'HOURLY')]
		const r = compensationForPeriod(hist, first.start, first.end, 0.5, FALLBACK, calDays)
		expect(r.segments.map((s) => s.rateType)).toEqual(['MONTHLY', 'HOURLY'])
		expect(r.periodEnd.rateType).toBe('HOURLY')
		expect(r.statutoryBasis.rateType).toBe('MONTHLY') // day-1 basis, pre-flip
	})
})

describe('compensationForPeriod — working-day weighting', () => {
	it('weights follow the injected working-day counter, summing to periodShare', () => {
		// Bespoke counter: May 1–4 = 3 working days, May 5–15 = 9 working days (total 12).
		const wd = (s: Date, _e: Date) => (s.getUTCDate() === 1 ? 3 : 9)
		const hist = [row([2024, 1, 1], 30000), row([2026, MAY, 5], 40000)]
		const r = compensationForPeriod(hist, first.start, first.end, 0.5, FALLBACK, wd)
		// 0.5 · 3/12 = 0.125 ; 0.5 · 9/12 = 0.375
		expect(str(r.segments[0].weight)).toBe('0.125')
		expect(str(r.segments[1].weight)).toBe('0.375')
		expect(str(r.segments[0].weight.plus(r.segments[1].weight))).toBe('0.5')
	})

	it('a period with zero working days falls back to calendar-day weighting', () => {
		const zero = () => 0
		const hist = [row([2024, 1, 1], 30000), row([2026, MAY, 5], 40000)]
		const r = compensationForPeriod(hist, first.start, first.end, 0.5, FALLBACK, zero)
		// Falls back to calendar days: 4/15 and 11/15 of 0.5.
		expect(str(r.segments[0].weight.plus(r.segments[1].weight))).toBe('0.5')
		expect(str(r.segments[0].weight)).toBe(str(D(0.5).times(4).dividedBy(15)))
		expect(str(r.segments[1].weight)).toBe(str(D(0.5).times(11).dividedBy(15)))
	})
})

describe('currentCompensation — as-of cache resolution (#170 Stage 1.5)', () => {
	const asOf = d(2026, MAY, 20)

	it('empty history → fallback', () => {
		const c = currentCompensation([], asOf, FALLBACK)
		expect(str(c.salary)).toBe('30000')
		expect(c.rateType).toBe('MONTHLY')
	})

	it('picks the latest snapshot with effectiveDate ≤ asOf', () => {
		const hist = [
			row([2024, 1, 1], 30000),
			row([2026, MAY, 10], 40000),
			row([2026, MAY, 25], 50000)
		]
		// May 20 sits between the May 10 and May 25 changes → the May 10 (40000) is current.
		expect(str(currentCompensation(hist, asOf, FALLBACK).salary)).toBe('40000')
	})

	it('ignores a future-dated snapshot until its date arrives', () => {
		const hist = [row([2024, 1, 1], 30000), row([2026, MAY, 25], 50000)]
		expect(str(currentCompensation(hist, d(2026, MAY, 20), FALLBACK).salary)).toBe('30000') // before
		expect(str(currentCompensation(hist, d(2026, MAY, 25), FALLBACK).salary)).toBe('50000') // on
		expect(str(currentCompensation(hist, d(2026, MAY, 26), FALLBACK).salary)).toBe('50000') // after
	})

	it('same-day changes tiebreak by changedAt (last wins)', () => {
		const hist = [
			row([2026, MAY, 10], 40000, 'MONTHLY', d(2026, MAY, 10)),
			row([2026, MAY, 10], 45000, 'MONTHLY', d(2026, MAY, 11))
		]
		expect(str(currentCompensation(hist, asOf, FALLBACK).salary)).toBe('45000')
	})

	it('carries a rateType change through', () => {
		const hist = [row([2024, 1, 1], 30000, 'MONTHLY'), row([2026, MAY, 10], 250, 'HOURLY')]
		const c = currentCompensation(hist, asOf, FALLBACK)
		expect(c.rateType).toBe('HOURLY')
		expect(str(c.salary)).toBe('250')
	})
})
