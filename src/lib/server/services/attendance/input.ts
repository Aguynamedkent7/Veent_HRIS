import { db } from '$lib/server/db'
import { manilaDayKey } from '$lib/utils/dates'
import { emptyAttendance, type AttendanceInput } from '../payroll/types'

/**
 * The payroll seam (Slice 2): sum an employee's AttendanceDay buckets over a period into the
 * payroll engine's `AttendanceInput`. Returns `null` when there are no attendance days for the
 * period, so payroll can fall back to the approved-timesheet path.
 */
type AttendanceDayRow = Awaited<ReturnType<typeof db.attendanceDay.findMany>>[number]

/** Add one AttendanceDay's hours + tardiness minutes into an accumulator (shared by both builders). */
function accumulateDay(sum: AttendanceInput, d: AttendanceDayRow): void {
	sum.regularHours += Number(d.regularHours)
	sum.overtimeHours += Number(d.overtimeHours)
	sum.nightDiffHours += Number(d.nightDiffHours)
	sum.restDayHours += Number(d.restDayHours)
	sum.restDayOtHours += Number(d.restDayOtHours)
	sum.regularHolidayHours += Number(d.regularHolidayHours)
	sum.regularHolidayOtHours += Number(d.regularHolidayOtHours)
	sum.specialHolidayHours += Number(d.specialHolidayHours)
	sum.specialHolidayOtHours += Number(d.specialHolidayOtHours)
	sum.lateMinutes += d.lateMinutes
	sum.undertimeMinutes += d.undertimeMinutes
}

export async function buildAttendanceInput(
	employeeId: string,
	periodStart: Date,
	periodEnd: Date
): Promise<AttendanceInput | null> {
	const from = new Date(manilaDayKey(periodStart))
	const to = new Date(manilaDayKey(periodEnd))

	const days = await db.attendanceDay.findMany({
		where: { employeeId, date: { gte: from, lte: to } }
	})
	if (days.length === 0) return null

	const sum = emptyAttendance()
	for (const d of days) accumulateDay(sum, d)
	return sum
}

/**
 * #170/#171 Stage 2: the same buckets, but partitioned across mid-period segments. One `findMany`
 * over the whole span `[segments[0].start, last.end]` (same window convention as
 * `buildAttendanceInput`); each `AttendanceDay` lands in the segment whose inclusive `[start, end]`
 * contains its PHT day-key (`manilaDayKey`, matching `computeWorkingDays`). `@db.Date` means one row
 * per day, so a day never splits across segments — hence `Σ_i buildSegmentAttendance[i]` equals
 * `buildAttendanceInput` over the same span. Returns `null` when there are zero rows, so the caller
 * applies the working-day fallback split (matching the null contract).
 */
export async function buildSegmentAttendance(
	employeeId: string,
	segments: { start: Date; end: Date }[]
): Promise<AttendanceInput[] | null> {
	if (segments.length === 0) return null
	const from = new Date(manilaDayKey(segments[0].start))
	const to = new Date(manilaDayKey(segments[segments.length - 1].end))

	const days = await db.attendanceDay.findMany({
		where: { employeeId, date: { gte: from, lte: to } }
	})
	if (days.length === 0) return null

	const buckets = segments.map(() => emptyAttendance())
	// PHT day-key bounds; string compare is correct for YYYY-MM-DD and matches computeWorkingDays.
	const bounds = segments.map((s) => ({ start: manilaDayKey(s.start), end: manilaDayKey(s.end) }))
	for (const d of days) {
		const key = manilaDayKey(d.date)
		const idx = bounds.findIndex((b) => key >= b.start && key <= b.end)
		// ponytail: segments are contiguous and cover the whole span, so idx is always found; guard
		// only against a stray row outside all bounds rather than silently misbucketing.
		if (idx !== -1) accumulateDay(buckets[idx], d)
	}
	return buckets
}
