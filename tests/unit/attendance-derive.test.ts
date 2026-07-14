import { describe, it, expect } from 'vitest'
import {
	deriveAttendanceDay,
	type AttPunchType,
	type ScheduleDay,
	type DayType
} from '$lib/server/services/attendance/derive'

const T = (hhmm: string) => `2026-07-13T${hhmm}:00+08:00` // Mon, PHT
const T2 = (hhmm: string) => `2026-07-14T${hhmm}:00+08:00`
const p = (punchType: AttPunchType, iso: string) => ({ punchType, timestamp: new Date(iso) })
const SCHED: ScheduleDay = { startMinutes: 540, endMinutes: 1080, breakMinutes: 60 } // 09:00–18:00, 1h break → 8h

function derive(
	punches: ReturnType<typeof p>[],
	opts: {
		schedule?: ScheduleDay | null
		dayType?: DayType
		approvedOtHours?: number
		onLeave?: boolean
	} = {}
) {
	return deriveAttendanceDay({
		punches,
		schedule: opts.schedule === undefined ? SCHED : opts.schedule,
		dayType: opts.dayType ?? 'REGULAR',
		approvedOtHours: opts.approvedOtHours,
		onLeave: opts.onLeave
	})
}

describe('deriveAttendanceDay — regular day', () => {
	it('a full 9–18 day with a 1h break = 8 regular hours, no OT/late', () => {
		const r = derive([
			p('IN', T('09:00')),
			p('BREAK_START', T('12:00')),
			p('BREAK_END', T('13:00')),
			p('OUT', T('18:00'))
		])
		expect(r.workedHours).toBeCloseTo(8, 2)
		expect(r.regularHours).toBeCloseTo(8, 2)
		expect(r.overtimeHours).toBe(0)
		expect(r.breakMinutes).toBe(60)
		expect(r.lateMinutes).toBe(0)
		expect(r.undertimeMinutes).toBe(0)
		expect(r.nightDiffHours).toBe(0)
		expect(r.status).toBe('PRESENT')
	})

	it('flags late arrival and marks status LATE', () => {
		const r = derive([
			p('IN', T('09:30')),
			p('BREAK_START', T('12:00')),
			p('BREAK_END', T('13:00')),
			p('OUT', T('18:00'))
		])
		expect(r.lateMinutes).toBe(30)
		expect(r.workedHours).toBeCloseTo(7.5, 2)
		expect(r.status).toBe('LATE')
	})

	it('flags undertime when leaving early', () => {
		const r = derive([p('IN', T('09:00')), p('OUT', T('16:00'))]) // no break, left 2h early
		expect(r.undertimeMinutes).toBe(120)
		expect(r.workedHours).toBeCloseTo(7, 2)
	})
})

describe('deriveAttendanceDay — overtime is gated on approval', () => {
	it('reports rawOvertime but pays 0 without approval', () => {
		const r = derive([
			p('IN', T('09:00')),
			p('BREAK_START', T('12:00')),
			p('BREAK_END', T('13:00')),
			p('OUT', T('20:00'))
		])
		expect(r.workedHours).toBeCloseTo(10, 2)
		expect(r.regularHours).toBeCloseTo(8, 2)
		expect(r.rawOvertimeHours).toBeCloseTo(2, 2)
		expect(r.overtimeHours).toBe(0) // gated
	})

	it('pays approved overtime up to the approved amount', () => {
		const r = derive(
			[
				p('IN', T('09:00')),
				p('BREAK_START', T('12:00')),
				p('BREAK_END', T('13:00')),
				p('OUT', T('20:00'))
			],
			{
				approvedOtHours: 2
			}
		)
		expect(r.overtimeHours).toBeCloseTo(2, 2)
	})
})

describe('deriveAttendanceDay — night differential', () => {
	it('counts hours inside the 22:00–06:00 window (overnight rest-day shift)', () => {
		const r = derive([p('IN', T('22:00')), p('OUT', T2('02:00'))], {
			schedule: null,
			dayType: 'REST_DAY'
		})
		expect(r.workedHours).toBeCloseTo(4, 2)
		expect(r.nightDiffHours).toBeCloseTo(4, 2) // all within night window
		expect(r.restDayHours).toBeCloseTo(4, 2)
		expect(r.status).toBe('PRESENT')
	})

	it('counts only the portion inside the window', () => {
		const r = derive([p('IN', T('04:00')), p('OUT', T('10:00'))], { schedule: null })
		expect(r.workedHours).toBeCloseTo(6, 2)
		expect(r.nightDiffHours).toBeCloseTo(2, 2) // 04:00–06:00
	})
})

describe('deriveAttendanceDay — day types & holidays', () => {
	it('routes worked hours to the regular-holiday bucket', () => {
		const r = derive([p('IN', T('09:00')), p('OUT', T('17:00'))], {
			schedule: null,
			dayType: 'REGULAR_HOLIDAY'
		})
		expect(r.regularHolidayHours).toBeCloseTo(8, 2)
		expect(r.regularHours).toBe(0)
		expect(r.status).toBe('PRESENT')
	})
})

describe('deriveAttendanceDay — empty / edge states', () => {
	it('no punches on a rest day → REST_DAY, zero hours', () => {
		const r = derive([], { schedule: null, dayType: 'REST_DAY' })
		expect(r.status).toBe('REST_DAY')
		expect(r.workedHours).toBe(0)
	})

	it('no punches on a scheduled day → ABSENT', () => {
		expect(derive([]).status).toBe('ABSENT')
	})

	it('IN without OUT → INCOMPLETE with timeIn set', () => {
		const r = derive([p('IN', T('09:00'))])
		expect(r.status).toBe('INCOMPLETE')
		expect(r.timeIn).not.toBeNull()
		expect(r.workedHours).toBe(0)
	})

	it('an approved leave day → ON_LEAVE with zero hours', () => {
		const r = derive([p('IN', T('09:00')), p('OUT', T('18:00'))], { onLeave: true })
		expect(r.status).toBe('ON_LEAVE')
		expect(r.workedHours).toBe(0)
	})
})
