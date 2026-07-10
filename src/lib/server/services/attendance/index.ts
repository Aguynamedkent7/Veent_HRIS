import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { manilaDayKey } from '$lib/utils/dates'
import { deriveAttendanceDay, type AttPunchType, type DayType, type ScheduleDay } from './derive'
import type { AuditContext } from '../types'

/**
 * Attendance service (Slice 2): derive AttendanceDay records from TimeLog punches against each
 * employee's schedule + the holiday calendar + approved leaves, list them, and lock a range so
 * payroll can import them. Derivation itself is the pure `deriveAttendanceDay`.
 */

const DEFAULT_WEEKDAY_SHIFT: ScheduleDay = { startMinutes: 540, endMinutes: 1080, breakMinutes: 60 } // 09:00–18:00

/** The shift for a weekday: an assigned schedule wins (absent weekday = rest); otherwise Mon–Fri default. */
function scheduleDayFor(
	scheduleDays: { weekday: number; startMinutes: number; endMinutes: number; breakMinutes: number }[] | null,
	weekday: number
): ScheduleDay | null {
	if (scheduleDays) {
		const d = scheduleDays.find((x) => x.weekday === weekday)
		return d ? { startMinutes: d.startMinutes, endMinutes: d.endMinutes, breakMinutes: d.breakMinutes } : null
	}
	return weekday >= 1 && weekday <= 5 ? DEFAULT_WEEKDAY_SHIFT : null
}

/** Group punches into shifts, attributing an overnight OUT/breaks to the IN's PHT day. */
function groupPunchesByDay(punches: { punchType: AttPunchType; timestamp: Date }[]): Map<string, { punchType: AttPunchType; timestamp: Date }[]> {
	const byDay = new Map<string, { punchType: AttPunchType; timestamp: Date }[]>()
	const sorted = [...punches].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
	let currentDay: string | null = null
	for (const p of sorted) {
		if (p.punchType === 'IN') currentDay = manilaDayKey(p.timestamp)
		const day = currentDay ?? manilaDayKey(p.timestamp)
		if (!byDay.has(day)) byDay.set(day, [])
		byDay.get(day)!.push(p)
		if (p.punchType === 'OUT') currentDay = null
	}
	return byDay
}

export function listAttendanceDays(employeeId: string, from: Date, to: Date) {
	return db.attendanceDay.findMany({
		where: { employeeId, date: { gte: from, lte: to } },
		orderBy: { date: 'asc' }
	})
}

/**
 * Derive AttendanceDay records for [from, to] (PHT days). Idempotent — skips locked days.
 */
export async function deriveRange(
	organizationId: string,
	range: { from: Date; to: Date; employeeId?: string },
	ctx: AuditContext
) {
	const fromKey = manilaDayKey(range.from)
	const toKey = manilaDayKey(range.to)

	const employees = await db.employee.findMany({
		where: {
			user: { organizationId },
			employmentStatus: 'ACTIVE',
			...(range.employeeId ? { id: range.employeeId } : {})
		},
		include: { workSchedule: { include: { days: true } } }
	})

	const holidays = await db.publicHoliday.findMany({
		where: { organizationId, date: { gte: new Date(`${fromKey}T00:00:00Z`), lte: new Date(`${toKey}T23:59:59Z`) } },
		select: { date: true, type: true }
	})
	const holidayByDay = new Map(holidays.map((h) => [h.date.toISOString().slice(0, 10), h.type]))

	// PHT day range expressed as an absolute UTC window (PHT day D = [D 00:00+08:00, D+1 00:00+08:00)).
	const phtStart = new Date(`${fromKey}T00:00:00+08:00`)
	const phtEndExclusive = new Date(`${toKey}T00:00:00+08:00`)
	phtEndExclusive.setUTCDate(phtEndExclusive.getUTCDate() + 1)

	let derived = 0
	const flagged: { employeeId: string; date: string; status: string }[] = []

	for (const emp of employees) {
		const scheduleDays = emp.workSchedule ? emp.workSchedule.days : null

		const punches = await db.timeLog.findMany({
			where: { employeeId: emp.id, timestamp: { gte: phtStart, lt: phtEndExclusive } },
			select: { punchType: true, timestamp: true }
		})
		const byDay = groupPunchesByDay(punches)

		const leaves = await db.leaveRequest.findMany({
			where: { employeeId: emp.id, status: 'APPROVED', startDate: { lte: new Date(`${toKey}T23:59:59Z`) }, endDate: { gte: new Date(`${fromKey}T00:00:00Z`) } },
			select: { startDate: true, endDate: true }
		})

		for (let cur = new Date(`${fromKey}T00:00:00Z`); cur.toISOString().slice(0, 10) <= toKey; cur.setUTCDate(cur.getUTCDate() + 1)) {
			const dayKey = cur.toISOString().slice(0, 10)
			const weekday = cur.getUTCDay()
			const holiday = holidayByDay.get(dayKey)
			const schedDay = scheduleDayFor(scheduleDays as never, weekday)
			const dayType: DayType = holiday
				? holiday === 'REGULAR'
					? 'REGULAR_HOLIDAY'
					: 'SPECIAL_HOLIDAY'
				: schedDay
					? 'REGULAR'
					: 'REST_DAY'
			const onLeave = leaves.some((l) => l.startDate.toISOString().slice(0, 10) <= dayKey && l.endDate.toISOString().slice(0, 10) >= dayKey)

			const existing = await db.attendanceDay.findUnique({
				where: { employeeId_date: { employeeId: emp.id, date: cur } },
				select: { isLocked: true }
			})
			if (existing?.isLocked) continue

			const r = deriveAttendanceDay({
				punches: byDay.get(dayKey) ?? [],
				schedule: dayType === 'REGULAR' ? schedDay : null,
				dayType,
				approvedOtHours: 0, // gated on approved OT requests (Phase 11.4); 0 until then
				onLeave
			})

			const data = {
				status: r.status,
				dayType,
				timeIn: r.timeIn,
				timeOut: r.timeOut,
				workedHours: r.workedHours,
				regularHours: r.regularHours,
				overtimeHours: r.overtimeHours,
				rawOvertimeHours: r.rawOvertimeHours,
				nightDiffHours: r.nightDiffHours,
				restDayHours: r.restDayHours,
				restDayOtHours: r.restDayOtHours,
				regularHolidayHours: r.regularHolidayHours,
				regularHolidayOtHours: r.regularHolidayOtHours,
				specialHolidayHours: r.specialHolidayHours,
				specialHolidayOtHours: r.specialHolidayOtHours,
				lateMinutes: r.lateMinutes,
				undertimeMinutes: r.undertimeMinutes,
				breakMinutes: r.breakMinutes
			}
			await db.attendanceDay.upsert({
				where: { employeeId_date: { employeeId: emp.id, date: cur } },
				create: { employeeId: emp.id, date: new Date(dayKey), ...data },
				update: data
			})
			derived++
			if (r.status === 'ABSENT' || r.status === 'INCOMPLETE') flagged.push({ employeeId: emp.id, date: dayKey, status: r.status })
		}
	}

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'AttendanceDay',
		entityId: range.employeeId ?? organizationId,
		newValue: { from: fromKey, to: toKey, derived, flagged: flagged.length }
	})
	return { derived, flagged }
}

/** Lock AttendanceDays in a range so payroll can import them (read-only thereafter). */
export async function lockRange(
	organizationId: string,
	range: { from: Date; to: Date; employeeId?: string },
	ctx: AuditContext
) {
	const fromKey = manilaDayKey(range.from)
	const toKey = manilaDayKey(range.to)
	const res = await db.attendanceDay.updateMany({
		where: {
			date: { gte: new Date(fromKey), lte: new Date(toKey) },
			employee: { user: { organizationId } },
			...(range.employeeId ? { employeeId: range.employeeId } : {})
		},
		data: { isLocked: true }
	})
	await writeAuditLog(ctx, { action: 'UPDATE', entityType: 'AttendanceDay', entityId: range.employeeId ?? organizationId, newValue: { locked: res.count, from: fromKey, to: toKey } })
	return { locked: res.count }
}
