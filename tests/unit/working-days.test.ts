import { describe, it, expect } from 'vitest'
import { computeWorkingDays } from '../../src/lib/utils/dates'

// #104: computePayroll passed `[]` for holidays, so a period containing public
// holidays counted them as ordinary working days. That feeds `scheduledHours`, and
// BASIC = regularHours * hourlyRate, so it inflated basic pay for anyone falling back
// to the schedule (no approved timesheet hours). These pin the holiday arithmetic the
// caller now depends on.
describe('computeWorkingDays', () => {
	// Mon 2026-01-05 .. Fri 2026-01-09 — a clean five-day working week.
	const start = new Date('2026-01-05T00:00:00')
	const end = new Date('2026-01-09T00:00:00')

	it('counts weekdays in the range', () => {
		expect(computeWorkingDays(start, end, [])).toBe(5)
	})

	it('excludes a holiday that falls on a weekday', () => {
		expect(computeWorkingDays(start, end, [new Date('2026-01-07T00:00:00')])).toBe(4)
	})

	it('excludes every holiday in the range, not just the first', () => {
		const holidays = [new Date('2026-01-06T00:00:00'), new Date('2026-01-08T00:00:00')]
		expect(computeWorkingDays(start, end, holidays)).toBe(3)
	})

	// The regression the bug produced: passing no holidays must be strictly greater
	// than passing them, i.e. the parameter genuinely changes the result.
	it('returns more days when holidays are omitted', () => {
		const withHoliday = computeWorkingDays(start, end, [new Date('2026-01-07T00:00:00')])
		expect(computeWorkingDays(start, end, [])).toBeGreaterThan(withHoliday)
	})

	it('ignores holidays that land on a weekend (already not working days)', () => {
		// Sat 2026-01-10 sits outside the Mon–Fri window entirely.
		const weekendStart = new Date('2026-01-05T00:00:00')
		const weekendEnd = new Date('2026-01-11T00:00:00')
		const saturday = [new Date('2026-01-10T00:00:00')]
		expect(computeWorkingDays(weekendStart, weekendEnd, saturday)).toBe(5)
	})

	it('never returns negative days for an inverted range', () => {
		expect(computeWorkingDays(end, start, [])).toBe(0)
	})

	// #105: weekday/day-key math must run in Philippine Standard Time, not the server's
	// local zone mixed with UTC slices. These pin instants whose PHT calendar day differs
	// from a naive UTC read, so a regression back to local-getDay + UTC-slice fails here
	// even on a UTC runner.
	describe('Philippine-time bucketing (#105)', () => {
		it('counts an evening-UTC instant on its PHT day, excluding the PHT-day holiday', () => {
			// 2026-07-20 20:00 UTC = 2026-07-21 04:00 PHT → Tuesday the 21st (a workday).
			const instant = new Date('2026-07-20T20:00:00.000Z')
			expect(computeWorkingDays(instant, instant, [])).toBe(1)
			// The holiday keyed to the PHT day (the 21st) must exclude it → 0. A naive UTC
			// read would look for the 20th, miss the match, and wrongly return 1.
			expect(computeWorkingDays(instant, instant, [new Date('2026-07-21T00:00:00.000Z')])).toBe(0)
		})

		it('treats a Friday-evening-UTC instant that is Saturday in PHT as a non-working day', () => {
			// 2026-07-24 18:00 UTC = 2026-07-25 02:00 PHT → Saturday. Naive UTC reads Friday
			// and counts it; PHT correctly counts zero.
			const instant = new Date('2026-07-24T18:00:00.000Z')
			expect(computeWorkingDays(instant, instant, [])).toBe(0)
		})
	})
})
