import { describe, it, expect } from 'vitest'
import {
	deriveAttendanceDay,
	type AttPunchType,
	type ScheduleDay
} from '$lib/server/services/attendance/derive'
import { pairPunchesToDailyHours } from '$lib/server/services/timelog'

/**
 * #162 criterion 4 — engine A (`deriveAttendanceDay`, the attendance page and payroll seam) and
 * engine B (`pairPunchesToDailyHours`, the timesheet aggregation) both reduce the same punches to
 * hours. This pins their relationship on the AM/PM split shift ONLY. Full engine unification is
 * out of scope per the SPEC; the point here is that #162 does not move either engine.
 *
 * They do NOT agree on a split shift, and the reason is structural, not a #162 regression:
 *   - engine B has a fixed unpaid 12:00–13:00 lunch. A shift punched OUT at 12:00 and back IN at
 *     13:00 has no worked time inside that window, so B deducts nothing and pays 8h.
 *   - engine A deducts the SCHEDULE's break duration whenever the day is a scheduled regular day
 *     worked past five hours, regardless of where the gap falls (`derive.ts` — a schedule stores a
 *     duration, never a position). The unpunched inter-block gap is already excluded from the work
 *     segments, so the 60-minute break comes off a second time and A pays 7h.
 * That divergence predates #162 — it applies to any day with two work segments — and is recorded
 * here rather than fixed, because changing either engine moves real pesos.
 */

const T = (hhmm: string) => `2026-07-13T${hhmm}:00+08:00` // Mon, PHT
const p = (punchType: AttPunchType, iso: string) => ({ punchType, timestamp: new Date(iso) })
const SCHED_8_5: ScheduleDay = { startMinutes: 480, endMinutes: 1020, breakMinutes: 60 }
const DAY = '2026-07-13'

// The gap IS the 12:00–13:00 lunch, which is the only punch set where the two engines can be
// compared without engine B's fixed window being obviously wrong for the shift.
const SPLIT_SHIFT = [
	p('IN', T('08:00')),
	p('OUT', T('12:00')),
	p('IN', T('13:00')),
	p('OUT', T('17:00'))
]

describe('#162 — engine A / engine B on the AM/PM split shift (criterion 4)', () => {
	it('the two engines differ by exactly the schedule break, with or without the split flag', () => {
		const b = pairPunchesToDailyHours(SPLIT_SHIFT)
		expect(b.warnings).toEqual([])
		expect(b.hoursByDay[DAY]).toBeCloseTo(8, 2)
		expect(b.otByDay[DAY]).toBeCloseTo(0, 2)

		for (const splitAmPm of [true, false]) {
			const a = deriveAttendanceDay({
				punches: SPLIT_SHIFT,
				schedule: SCHED_8_5,
				dayType: 'REGULAR',
				splitAmPm
			})
			expect(a.workedHours).toBeCloseTo(7, 2)
			// The documented relationship: A = B − the schedule's break duration.
			expect(b.hoursByDay[DAY] - a.workedHours).toBeCloseTo(SCHED_8_5.breakMinutes / 60, 2)
			expect(a.overtimeHours).toBeCloseTo(0, 2)
		}
	})

	it('the split flag moves neither engine', () => {
		const on = deriveAttendanceDay({
			punches: SPLIT_SHIFT,
			schedule: SCHED_8_5,
			dayType: 'REGULAR',
			splitAmPm: true
		})
		const off = deriveAttendanceDay({
			punches: SPLIT_SHIFT,
			schedule: SCHED_8_5,
			dayType: 'REGULAR',
			splitAmPm: false
		})
		expect(on.workedHours).toBe(off.workedHours)
		expect(on.regularHours).toBe(off.regularHours)
		// Engine B has no AM/PM concept at all — it is punch-shape only, so it cannot see the flag.
		expect(pairPunchesToDailyHours(SPLIT_SHIFT).hoursByDay[DAY]).toBeCloseTo(8, 2)
		expect(on.amTimeOut).not.toBeNull()
	})
})
