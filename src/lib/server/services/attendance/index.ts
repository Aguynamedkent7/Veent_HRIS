import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { manilaDayKey } from '$lib/utils/dates'
import { deriveAttendanceDay, type AttPunchType, type DayType, type ScheduleDay } from './derive'
import { createTimesheet } from '../timesheets'
import type { AuditContext } from '../types'

/**
 * Attendance service (Slice 2): derive AttendanceDay records from TimeLog punches against each
 * employee's schedule + the holiday calendar + approved leaves, list them, and lock a range so
 * payroll can import them. Derivation itself is the pure `deriveAttendanceDay`.
 */

const DEFAULT_WEEKDAY_SHIFT: ScheduleDay = { startMinutes: 540, endMinutes: 1080, breakMinutes: 60 } // 09:00–18:00

/** The shift for a weekday: an assigned schedule wins (absent weekday = rest); otherwise Mon–Fri default. */
function scheduleDayFor(
	scheduleDays:
		{ weekday: number; startMinutes: number; endMinutes: number; breakMinutes: number }[] | null,
	weekday: number
): ScheduleDay | null {
	if (scheduleDays) {
		const d = scheduleDays.find((x) => x.weekday === weekday)
		return d
			? { startMinutes: d.startMinutes, endMinutes: d.endMinutes, breakMinutes: d.breakMinutes }
			: null
	}
	return weekday >= 1 && weekday <= 5 ? DEFAULT_WEEKDAY_SHIFT : null
}

/** Group punches into shifts, attributing an overnight OUT/breaks to the IN's PHT day. */
function groupPunchesByDay(
	punches: { punchType: AttPunchType; timestamp: Date }[]
): Map<string, { punchType: AttPunchType; timestamp: Date }[]> {
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
 * Team view for a single PHT day: every active employee with their AttendanceDay for that
 * day (or null if none derived yet). AttendanceDays are stored keyed at midnight UTC of the
 * PHT day (see deriveRange), so `dateKey` ('YYYY-MM-DD') is matched exactly.
 */
export async function listTeamDay(organizationId: string, dateKey: string) {
	const date = new Date(dateKey)
	const employees = await db.employee.findMany({
		where: { user: { organizationId }, employmentStatus: 'ACTIVE' },
		select: {
			id: true,
			firstName: true,
			lastName: true,
			employeeNumber: true,
			department: { select: { name: true } },
			attendanceDays: { where: { date }, take: 1 }
		},
		orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
	})

	return employees.map((e) => ({
		id: e.id,
		name: `${e.lastName}, ${e.firstName}`,
		employeeNumber: e.employeeNumber,
		departmentName: e.department?.name ?? null,
		day: e.attendanceDays[0] ?? null
	}))
}

/**
 * Derive AttendanceDay records for [from, to] (PHT days). Idempotent — skips locked days.
 */
export async function deriveRange(
	organizationId: string,
	range: { from: Date; to: Date; employeeId?: string },
	ctx: AuditContext,
	opts: { onlyMissing?: boolean } = {}
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
		where: {
			organizationId,
			date: { gte: new Date(`${fromKey}T00:00:00Z`), lte: new Date(`${toKey}T23:59:59Z`) }
		},
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

		const leaveReqs = await db.request.findMany({
			where: {
				employeeId: emp.id,
				type: 'LEAVE',
				status: 'APPROVED',
				dateFrom: { lte: new Date(`${toKey}T23:59:59Z`) },
				dateTo: { gte: new Date(`${fromKey}T00:00:00Z`) }
			},
			select: { dateFrom: true, dateTo: true }
		})
		const leaves = leaveReqs.map((l) => ({ startDate: l.dateFrom!, endDate: l.dateTo! }))

		// Approved OVERTIME requests (T169) gate how much worked overtime actually
		// pays: deriveAttendanceDay pays min(rawOvertime, approvedOtHours) per day.
		const otReqs = await db.request.findMany({
			where: {
				employeeId: emp.id,
				type: 'OVERTIME',
				status: 'APPROVED',
				dateFrom: { gte: new Date(`${fromKey}T00:00:00Z`), lte: new Date(`${toKey}T23:59:59Z`) }
			},
			select: { dateFrom: true, hours: true }
		})
		const approvedOtByDay = new Map<string, number>()
		for (const o of otReqs) {
			if (!o.dateFrom) continue
			const k = o.dateFrom.toISOString().slice(0, 10)
			approvedOtByDay.set(k, (approvedOtByDay.get(k) ?? 0) + Number(o.hours ?? 0))
		}

		for (
			let cur = new Date(`${fromKey}T00:00:00Z`);
			cur.toISOString().slice(0, 10) <= toKey;
			cur.setUTCDate(cur.getUTCDate() + 1)
		) {
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
			const onLeave = leaves.some(
				(l) =>
					l.startDate.toISOString().slice(0, 10) <= dayKey &&
					l.endDate.toISOString().slice(0, 10) >= dayKey
			)

			const existing = await db.attendanceDay.findUnique({
				where: { employeeId_date: { employeeId: emp.id, date: cur } },
				select: { isLocked: true, manuallyEdited: true }
			})
			if (existing?.isLocked) continue
			// Never overwrite a manual HR override, even on a full Refresh re-derive.
			if (existing?.manuallyEdited) continue
			// Auto-derive only fills gaps — never overwrites an existing (possibly hand-corrected) day.
			if (opts.onlyMissing && existing) continue

			const r = deriveAttendanceDay({
				punches: byDay.get(dayKey) ?? [],
				schedule: dayType === 'REGULAR' ? schedDay : null,
				dayType,
				approvedOtHours: approvedOtByDay.get(dayKey) ?? 0,
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
			if (r.status === 'ABSENT' || r.status === 'INCOMPLETE')
				flagged.push({ employeeId: emp.id, date: dayKey, status: r.status })
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

/**
 * Non-destructive auto-derive for page loads: if any punches exist in the window, derive only
 * the days that don't yet have an AttendanceDay. Cheap and idempotent after the first view, and
 * it leaves existing (corrected/locked) days untouched — a full re-derive is the Refresh button.
 */
export async function autoDeriveFromPunches(
	organizationId: string,
	range: { from: Date; to: Date; employeeId?: string },
	ctx: AuditContext
) {
	const fromKey = manilaDayKey(range.from)
	const toKey = manilaDayKey(range.to)
	const phtStart = new Date(`${fromKey}T00:00:00+08:00`)
	const phtEndExclusive = new Date(`${toKey}T00:00:00+08:00`)
	phtEndExclusive.setUTCDate(phtEndExclusive.getUTCDate() + 1)

	const punchCount = await db.timeLog.count({
		where: {
			employee: { user: { organizationId } },
			timestamp: { gte: phtStart, lt: phtEndExclusive },
			...(range.employeeId ? { employeeId: range.employeeId } : {})
		}
	})
	if (punchCount === 0) return { derived: 0, flagged: 0 }

	const res = await deriveRange(organizationId, range, ctx, { onlyMissing: true })
	return { derived: res.derived, flagged: res.flagged.length }
}

/**
 * Materialise an employee's derived attendance over [from, to] into a persisted Timesheet
 * (the artifact /team and payroll consume). Per-employee only. Each day becomes one entry with
 * hoursWorked = regular + overtime; the day status (and OT) is kept in the entry note. Relies on
 * the Timesheet @@unique([employeeId, periodStart]) to reject duplicates (createTimesheet → 409).
 */
export async function createTimesheetFromAttendance(
	employeeId: string,
	organizationId: string,
	from: Date,
	to: Date,
	ctx: AuditContext
) {
	const emp = await db.employee.findFirst({
		where: { id: employeeId, organizationId },
		select: { id: true }
	})
	if (!emp) error(404, 'Employee not found')

	const fromKey = manilaDayKey(from)
	const toKey = manilaDayKey(to)
	const days = await db.attendanceDay.findMany({
		where: { employeeId, date: { gte: new Date(fromKey), lte: new Date(toKey) } },
		orderBy: { date: 'asc' }
	})
	if (days.length === 0) error(400, 'No attendance in this range to save as a timesheet.')

	const entries = days.map((d) => {
		const ot = Number(d.overtimeHours)
		const worked = Number(d.regularHours) + ot
		return {
			date: d.date,
			hoursWorked: worked,
			notes: ot > 0 ? `${d.status} (OT ${ot.toFixed(2)})` : d.status
		}
	})

	return createTimesheet(employeeId, new Date(fromKey), new Date(toKey), entries, ctx)
}

/** HR correction of a single AttendanceDay. Rejected if the day is locked. */
export async function correctDay(
	id: string,
	organizationId: string,
	data: {
		status?: import('./derive').AttendanceStatus
		timeIn?: Date | null
		timeOut?: Date | null
		regularHours?: number
		overtimeHours?: number
		nightDiffHours?: number
		lateMinutes?: number
		undertimeMinutes?: number
		note?: string
	},
	ctx: AuditContext
) {
	const day = await db.attendanceDay.findFirst({
		where: { id, employee: { user: { organizationId } } }
	})
	if (!day) error(404, 'Attendance day not found')
	if (day.isLocked) error(409, 'This attendance day is locked and cannot be edited')

	// Flag the day so a later re-derive (Refresh) won't overwrite this manual override.
	const updated = await db.attendanceDay.update({
		where: { id },
		data: { ...data, manuallyEdited: true }
	})
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'AttendanceDay',
		entityId: id,
		oldValue: {
			regularHours: Number(day.regularHours),
			overtimeHours: Number(day.overtimeHours),
			status: day.status
		},
		newValue: data as Record<string, unknown>
	})
	return updated
}

/**
 * Discard a manual override on a single day and re-derive it from punches. Clears the
 * manuallyEdited flag so the re-derive is allowed to overwrite the hand-entered values.
 */
export async function resetDayToDerived(id: string, organizationId: string, ctx: AuditContext) {
	const day = await db.attendanceDay.findFirst({
		where: { id, employee: { user: { organizationId } } },
		select: { employeeId: true, date: true, isLocked: true }
	})
	if (!day) error(404, 'Attendance day not found')
	if (day.isLocked) error(409, 'This attendance day is locked and cannot be edited')

	await db.attendanceDay.update({ where: { id }, data: { manuallyEdited: false } })
	await deriveRange(
		organizationId,
		{ from: day.date, to: day.date, employeeId: day.employeeId },
		ctx
	)

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'AttendanceDay',
		entityId: id,
		newValue: { resetToDerived: true }
	})
	return { reset: true }
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
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'AttendanceDay',
		entityId: range.employeeId ?? organizationId,
		newValue: { locked: res.count, from: fromKey, to: toKey }
	})
	return { locked: res.count }
}

/** Reopen locked AttendanceDays in a range. Privileged (super admin) — reverses lockRange. */
export async function unlockRange(
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
		data: { isLocked: false }
	})
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'AttendanceDay',
		entityId: range.employeeId ?? organizationId,
		newValue: { unlocked: res.count, from: fromKey, to: toKey }
	})
	return { unlocked: res.count }
}
