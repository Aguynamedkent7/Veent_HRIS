/**
 * Pure attendance-day derivation (ATT-2) — no DB, no side effects.
 * Turns a single PHT day's TimeLog punches (+ the employee's schedule, day type, injected
 * approved-OT and on-leave flags) into the hour buckets the payroll engine consumes, plus
 * late/undertime, night differential, and a status. Overtime is GATED on approval: the engine
 * reports `rawOvertimeHours` (worked beyond the threshold) but only pays `min(raw, approvedOtHours)`.
 */

const DAY_MS = 86_400_000
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000

// Labor Code Art. 85 entitles an employee to the unpaid meal period only once they work
// more than 5 hours, so a short day is never docked for a break they never took.
const MEAL_BREAK_OWED_AFTER_MS = 5 * 60 * 60 * 1000

export type AttPunchType = 'IN' | 'OUT' | 'BREAK_START' | 'BREAK_END'
export type AttendanceStatus =
	'PRESENT' | 'LATE' | 'ABSENT' | 'INCOMPLETE' | 'ON_LEAVE' | 'HOLIDAY' | 'REST_DAY'
export type DayType = 'REGULAR' | 'REST_DAY' | 'REGULAR_HOLIDAY' | 'SPECIAL_HOLIDAY'

export interface PunchLite {
	punchType: AttPunchType
	timestamp: Date
}

export interface ScheduleDay {
	startMinutes: number
	endMinutes: number
	breakMinutes: number
}

export interface DeriveConfig {
	/** Night-differential window in PHT minutes-from-midnight (default 22:00–06:00). */
	nightStartMin: number
	nightEndMin: number
}

export const DEFAULT_NIGHT_WINDOW: DeriveConfig = { nightStartMin: 22 * 60, nightEndMin: 6 * 60 }

export interface DeriveInput {
	punches: PunchLite[]
	/** Scheduled shift for the weekday, or null for an unscheduled/rest day. */
	schedule: ScheduleDay | null
	dayType: DayType
	/** Approved OT hours for the day (from an approved OT request); 0 until Requests lands. */
	approvedOtHours?: number
	/** True when an approved leave covers this day. */
	onLeave?: boolean
	config?: DeriveConfig
}

export interface AttendanceDayResult {
	status: AttendanceStatus
	timeIn: Date | null
	timeOut: Date | null
	workedHours: number
	regularHours: number
	overtimeHours: number
	rawOvertimeHours: number
	nightDiffHours: number
	restDayHours: number
	restDayOtHours: number
	regularHolidayHours: number
	regularHolidayOtHours: number
	specialHolidayHours: number
	specialHolidayOtHours: number
	lateMinutes: number
	undertimeMinutes: number
	breakMinutes: number
}

function round2(n: number): number {
	return Math.round((n + Number.EPSILON) * 100) / 100
}

function phtMinuteOfDay(d: Date): number {
	return Math.floor(((d.getTime() + MANILA_OFFSET_MS) % DAY_MS) / 60_000)
}

/** Remove `cuts` (break intervals) from `base` (work intervals). All values in ms. */
function subtractIntervals(
	base: Array<[number, number]>,
	cuts: Array<[number, number]>
): Array<[number, number]> {
	let result = base
	for (const [cs, ce] of cuts) {
		const next: Array<[number, number]> = []
		for (const [s, e] of result) {
			if (ce <= s || cs >= e) {
				next.push([s, e])
				continue
			}
			if (cs > s) next.push([s, cs])
			if (ce < e) next.push([ce, e])
		}
		result = next
	}
	return result
}

/** Milliseconds of [a,b) that fall inside the recurring daily `ranges` (ms-of-day). */
function dailyOverlapMs(a: number, b: number, ranges: Array<[number, number]>): number {
	if (b <= a) return 0
	let total = 0
	const firstDay = Math.floor(a / DAY_MS)
	const lastDay = Math.floor((b - 1) / DAY_MS)
	for (let day = firstDay; day <= lastDay; day++) {
		for (const [rs, re] of ranges) {
			const s = day * DAY_MS + rs
			const e = day * DAY_MS + re
			total += Math.max(0, Math.min(b, e) - Math.max(a, s))
		}
	}
	return total
}

function emptyResult(status: AttendanceStatus, timeIn: Date | null = null): AttendanceDayResult {
	return {
		status,
		timeIn,
		timeOut: null,
		workedHours: 0,
		regularHours: 0,
		overtimeHours: 0,
		rawOvertimeHours: 0,
		nightDiffHours: 0,
		restDayHours: 0,
		restDayOtHours: 0,
		regularHolidayHours: 0,
		regularHolidayOtHours: 0,
		specialHolidayHours: 0,
		specialHolidayOtHours: 0,
		lateMinutes: 0,
		undertimeMinutes: 0,
		breakMinutes: 0
	}
}

export function deriveAttendanceDay(input: DeriveInput): AttendanceDayResult {
	const { schedule, dayType } = input
	const approvedOt = input.approvedOtHours ?? 0
	const cfg = input.config ?? DEFAULT_NIGHT_WINDOW

	if (input.onLeave) return emptyResult('ON_LEAVE')

	// Pair IN/OUT (work) and BREAK_START/BREAK_END (breaks).
	const sorted = [...input.punches].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
	const workSegs: Array<[number, number]> = []
	const breakSegs: Array<[number, number]> = []
	let openWork: number | null = null
	let openBreak: number | null = null
	let firstIn: Date | null = null
	let lastOut: Date | null = null

	for (const p of sorted) {
		const t = p.timestamp.getTime()
		if (p.punchType === 'IN') {
			openWork = t
			if (!firstIn) firstIn = p.timestamp
		} else if (p.punchType === 'OUT') {
			if (openWork !== null) {
				workSegs.push([openWork, t])
				openWork = null
				lastOut = p.timestamp
			}
		} else if (p.punchType === 'BREAK_START') {
			openBreak = t
		} else if (p.punchType === 'BREAK_END') {
			if (openBreak !== null) {
				breakSegs.push([openBreak, t])
				openBreak = null
			}
		}
	}
	const incomplete = openWork !== null

	if (workSegs.length === 0) {
		if (firstIn || incomplete) return emptyResult('INCOMPLETE', firstIn)
		if (dayType === 'REST_DAY') return emptyResult('REST_DAY')
		if (dayType === 'REGULAR_HOLIDAY' || dayType === 'SPECIAL_HOLIDAY')
			return emptyResult('HOLIDAY')
		return emptyResult('ABSENT')
	}

	const netIntervals = subtractIntervals(workSegs, breakSegs)
	const grossWorkedMs = workSegs.reduce((s, [a, b]) => s + (b - a), 0)
	const punchedNetMs = netIntervals.reduce((s, [a, b]) => s + (b - a), 0)

	// Measure what `subtractIntervals` actually removed rather than summing the raw break
	// segments: only the part of a break overlapping a work segment ever comes off the
	// clock. Old rows can carry a break punched outside the IN/OUT window, and counting
	// that in full would make it look like a long meal and suppress the deduction below.
	const punchedBreakMs = grossWorkedMs - punchedNetMs

	// The scheduled meal break is unpaid whether or not it gets punched, and in practice
	// employees only punch IN and OUT. Deducting it here is what keeps an 8–5 day at 8h
	// instead of 9h with a phantom hour of overtime. `max` rather than a sum: a punched
	// break *is* the meal break, so it must never be deducted twice.
	const scheduledBreakMs =
		dayType === 'REGULAR' && schedule && punchedNetMs > MEAL_BREAK_OWED_AFTER_MS
			? schedule.breakMinutes * 60_000
			: 0
	const unpaidBreakMs = Math.max(punchedBreakMs, scheduledBreakMs)
	const netWorkedMs = Math.max(0, punchedNetMs - (unpaidBreakMs - punchedBreakMs))
	const workedHours = round2(netWorkedMs / 3_600_000)

	// Night-differential window (may wrap midnight).
	const nightRanges: Array<[number, number]> =
		cfg.nightStartMin > cfg.nightEndMin
			? [
					[0, cfg.nightEndMin * 60_000],
					[cfg.nightStartMin * 60_000, DAY_MS]
				]
			: [[cfg.nightStartMin * 60_000, cfg.nightEndMin * 60_000]]
	const nightMs = netIntervals.reduce(
		(s, [a, b]) => s + dailyOverlapMs(a + MANILA_OFFSET_MS, b + MANILA_OFFSET_MS, nightRanges),
		0
	)
	// A schedule stores only a break *duration*, never when it falls, so an unpunched break
	// can't be cut out of the night intervals the way a punched one is. Clamping keeps the
	// invariant that night-differential hours are a subset of hours worked — exact whenever
	// the shift sits wholly inside the window, which is the case that would otherwise pay
	// night differential on an hour the employee spent at lunch.
	const nightDiffHours = round2(Math.min(nightMs / 3_600_000, workedHours))

	// Late / undertime only apply to a scheduled regular day.
	let lateMinutes = 0
	let undertimeMinutes = 0
	if (dayType === 'REGULAR' && schedule && firstIn && lastOut) {
		lateMinutes = Math.max(0, phtMinuteOfDay(firstIn) - schedule.startMinutes)
		undertimeMinutes = Math.max(0, schedule.endMinutes - phtMinuteOfDay(lastOut))
	}

	// Threshold beyond which hours are overtime.
	const threshold =
		dayType === 'REGULAR' && schedule
			? (schedule.endMinutes - schedule.startMinutes - schedule.breakMinutes) / 60
			: 8
	const baseHours = round2(Math.min(workedHours, threshold))
	const rawOvertimeHours = round2(Math.max(0, workedHours - threshold))
	const paidOt = round2(Math.min(rawOvertimeHours, approvedOt))

	const result = emptyResult(
		incomplete ? 'INCOMPLETE' : lateMinutes > 0 ? 'LATE' : 'PRESENT',
		firstIn
	)
	result.timeOut = lastOut
	result.workedHours = workedHours
	result.breakMinutes = Math.round(unpaidBreakMs / 60_000)
	result.nightDiffHours = nightDiffHours
	result.lateMinutes = lateMinutes
	result.undertimeMinutes = undertimeMinutes
	result.rawOvertimeHours = rawOvertimeHours

	switch (dayType) {
		case 'REGULAR':
			result.regularHours = baseHours
			result.overtimeHours = paidOt
			break
		case 'REST_DAY':
			result.restDayHours = baseHours
			result.restDayOtHours = paidOt
			break
		case 'REGULAR_HOLIDAY':
			result.regularHolidayHours = baseHours
			result.regularHolidayOtHours = paidOt
			break
		case 'SPECIAL_HOLIDAY':
			result.specialHolidayHours = baseHours
			result.specialHolidayOtHours = paidOt
			break
	}

	return result
}
