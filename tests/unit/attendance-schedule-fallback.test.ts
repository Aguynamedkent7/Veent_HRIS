import { describe, it, expect } from 'vitest'
import { scheduleDayFor, FALLBACK_WEEKDAY_SHIFT } from '$lib/server/services/attendance/index'
import { deriveAttendanceDay, type AttPunchType } from '$lib/server/services/attendance/derive'

/**
 * The org's `isDefault` schedule was written, badged in settings and preselected on the create
 * form, but never read by the attendance engine — which fell back to a hardcoded 09:00–18:00 that
 * matched no configuration row anywhere. Employees with no explicit assignment were derived
 * against that phantom shift, so an 8–5 worker booked 60 minutes of undertime every day and it
 * reached payroll through the TARDINESS line.
 */

const days = (startMinutes: number, endMinutes: number, weekdays = [1, 2, 3, 4, 5]) =>
	weekdays.map((weekday) => ({ weekday, startMinutes, endMinutes, breakMinutes: 60 }))

const MONDAY = 1
const SUNDAY = 0

describe('scheduleDayFor — resolution order', () => {
	it('uses the employee assigned schedule when there is one', () => {
		const assigned = days(600, 1140) // 10:00-19:00
		expect(scheduleDayFor(assigned, MONDAY)).toEqual({
			startMinutes: 600,
			endMinutes: 1140,
			breakMinutes: 60
		})
	})

	it('treats a weekday absent from the assigned schedule as a rest day', () => {
		expect(scheduleDayFor(days(480, 1020, [1, 2, 3]), 5)).toBeNull()
	})

	it('uses the org default days when the employee has no assignment', () => {
		// deriveRange passes the org's isDefault schedule days in place of null.
		const orgDefault = days(480, 1020) // the seeded 08:00-17:00 default
		expect(scheduleDayFor(orgDefault, MONDAY)).toEqual({
			startMinutes: 480,
			endMinutes: 1020,
			breakMinutes: 60
		})
	})

	it('falls back to Mon-Fri 08:00-17:00 when the org has configured nothing', () => {
		expect(scheduleDayFor(null, MONDAY)).toEqual(FALLBACK_WEEKDAY_SHIFT)
		expect(FALLBACK_WEEKDAY_SHIFT.startMinutes).toBe(480) // 08:00, never 540/09:00
		expect(FALLBACK_WEEKDAY_SHIFT.endMinutes).toBe(1020) // 17:00, never 1080/18:00
	})

	it('still treats weekends as rest days under the last-resort fallback', () => {
		expect(scheduleDayFor(null, SUNDAY)).toBeNull()
		expect(scheduleDayFor(null, 6)).toBeNull()
	})
})

describe('an unassigned 8-5 employee is no longer charged phantom undertime', () => {
	const p = (punchType: AttPunchType, hhmm: string) => ({
		punchType,
		timestamp: new Date(`2026-07-13T${hhmm}:00+08:00`) // a Monday, PHT
	})
	const punches = [p('IN', '08:00'), p('OUT', '17:00')] // a full 8-5 day

	it('books zero late and zero undertime against the resolved default', () => {
		const shift = scheduleDayFor(null, MONDAY)
		const r = deriveAttendanceDay({ punches, schedule: shift, dayType: 'REGULAR' })

		expect(r.lateMinutes).toBe(0)
		expect(r.undertimeMinutes).toBe(0)
		expect(Number(r.regularHours)).toBeCloseTo(8, 2)
	})

	it('booked an hour of undertime under the old 9-6 shift (the regression)', () => {
		const phantom = { startMinutes: 540, endMinutes: 1080, breakMinutes: 60 }
		const r = deriveAttendanceDay({ punches, schedule: phantom, dayType: 'REGULAR' })

		// Same full day's work, charged 60 minutes of undertime purely by shift mismatch.
		expect(r.undertimeMinutes).toBe(60)
	})
})
