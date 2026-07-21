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
})
