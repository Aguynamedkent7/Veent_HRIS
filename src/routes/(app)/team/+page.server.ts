import { requireMinRole } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
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

	// Get team members
	const members = await db.employee.findMany({
		where: {
			user: { organizationId: user.organizationId, isActive: true },
			...(!isAdmin && myEmployee ? { reportsToId: myEmployee.id } : {})
		},
		select: { id: true, firstName: true, lastName: true }
	})

	// Get approved timesheets with entries in range
	const timesheets = await db.timesheet.findMany({
		where: {
			status: 'APPROVED',
			employeeId: { in: members.map((m: { id: string }) => m.id) },
			periodStart: { lte: endDate },
			periodEnd: { gte: startDate }
		},
		include: { entries: { where: { date: { gte: startDate, lte: endDate } } } }
	})

	// Get approved leave in range
	const leaves = await db.leaveRequest.findMany({
		where: {
			status: 'APPROVED',
			employeeId: { in: members.map((m: { id: string }) => m.id) },
			startDate: { lte: endDate },
			endDate: { gte: startDate }
		}
	})

	// Build attendance map: { [employeeId]: { [dateISO]: 'P' | 'L' } }
	const attendanceMap: Record<string, Record<string, string>> = {}
	for (const ts of timesheets) {
		for (const entry of ts.entries) {
			const empId = ts.employeeId
			const dateISO = entry.date.toISOString().slice(0, 10)
			if (!attendanceMap[empId]) attendanceMap[empId] = {}
			if (Number(entry.hoursWorked) > 0) attendanceMap[empId][dateISO] = 'P'
		}
	}
	for (const leave of leaves) {
		const cur = new Date(leave.startDate)
		while (cur <= leave.endDate) {
			const dateISO = cur.toISOString().slice(0, 10)
			if (!attendanceMap[leave.employeeId]) attendanceMap[leave.employeeId] = {}
			attendanceMap[leave.employeeId][dateISO] = 'L'
			cur.setDate(cur.getDate() + 1)
		}
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
		startDate: startDate.toISOString().slice(0, 10),
		endDate: endDate.toISOString().slice(0, 10)
	}
}
