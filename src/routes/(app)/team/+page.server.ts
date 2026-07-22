import { requireMinRole } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import { isFoodServiceOrg } from '$lib/orgs'
import { autoDeriveFromPunches } from '$lib/server/services/attendance'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url, getClientAddress }) => {
	const user = locals.user!
	requireMinRole(user.role, 'MANAGER')

	const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
	const isAdmin = ['HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)

	// Date range from URL params, default to current week (Mon-Sun)
	const today = new Date()
	const weekDay = today.getDay()
	const weekStart = new Date(today)
	weekStart.setDate(today.getDate() - (weekDay === 0 ? 6 : weekDay - 1))
	weekStart.setHours(0, 0, 0, 0)
	const weekEnd = new Date(weekStart)
	weekEnd.setDate(weekStart.getDate() + 6)
	weekEnd.setHours(23, 59, 59, 999)

	const startParam = url.searchParams.get('start')
	const endParam = url.searchParams.get('end')
	const startDate = startParam ? new Date(startParam) : weekStart
	const endDate = endParam ? new Date(endParam) : weekEnd
	const startISO = startDate.toISOString().slice(0, 10)
	const endISO = endDate.toISOString().slice(0, 10)

	// Get team members
	const members = await db.employee.findMany({
		where: {
			user: { organizationId: user.organizationId, isActive: true },
			...(!isAdmin && myEmployee ? { reportsToId: myEmployee.id } : {})
		},
		select: { id: true, firstName: true, lastName: true }
	})

	// Auto-derive from punches over the range so ABSENT/INCOMPLETE days materialise (non-destructive;
	// fills only missing days). This is what makes the "who failed to time in" check work — otherwise
	// a no-punch day is invisible until someone opens that employee's attendance.
	await autoDeriveFromPunches(
		user.organizationId,
		{ from: startDate, to: endDate },
		{
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		}
	)

	// Presence comes from the derived AttendanceDay records (same source as the single-employee
	// attendance view), so ABSENT / INCOMPLETE / ON_LEAVE / HOLIDAY / REST_DAY each render distinctly
	// instead of collapsing to a blank "no data" cell.
	const days = await db.attendanceDay.findMany({
		where: {
			employeeId: { in: members.map((m) => m.id) },
			date: { gte: new Date(startISO), lte: new Date(endISO) }
		},
		select: { employeeId: true, date: true, status: true }
	})

	// attendanceMap: { [employeeId]: { [dateISO]: AttendanceStatus } }
	const attendanceMap: Record<string, Record<string, string>> = {}
	for (const d of days) {
		const dateISO = d.date.toISOString().slice(0, 10)
		;(attendanceMap[d.employeeId] ??= {})[dateISO] = d.status
	}

	// Build date columns array
	const dates: string[] = []
	const cur = new Date(startDate)
	while (cur <= endDate) {
		dates.push(cur.toISOString().slice(0, 10))
		cur.setDate(cur.getDate() + 1)
	}

	return {
		members,
		dates,
		attendanceMap,
		startDate: startISO,
		endDate: endISO,
		// Food-service tenants label this roster "Branches" (#182), so the heading follows suit.
		isFoodService: isFoodServiceOrg(user.organizationId)
	}
}
