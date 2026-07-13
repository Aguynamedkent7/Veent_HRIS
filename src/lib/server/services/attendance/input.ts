import { db } from '$lib/server/db'
import { manilaDayKey } from '$lib/utils/dates'
import { emptyAttendance, type AttendanceInput } from '../payroll/types'

/**
 * The payroll seam (Slice 2): sum an employee's AttendanceDay buckets over a period into the
 * payroll engine's `AttendanceInput`. Returns `null` when there are no attendance days for the
 * period, so payroll can fall back to the approved-timesheet path.
 */
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
	for (const d of days) {
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
	return sum
}
