import { db } from '$lib/server/db'

export async function getEmployeeMetrics(userId: string, organizationId: string) {
	const employee = await db.employee.findFirst({
		where: { userId }
	})

	if (!employee) {
		return {
			pendingTimesheets: 0,
			leaveBalances: [],
			nextPayrollRun: null,
			recentTimesheets: []
		}
	}

	const currentYear = new Date().getFullYear()
	const now = new Date()

	const [pendingTimesheets, leaveBalances, nextPayrollRun, recentTimesheets] = await Promise.all([
		db.timesheet.count({
			where: {
				employeeId: employee.id,
				status: { in: ['DRAFT', 'SUBMITTED'] }
			}
		}),
		db.leaveBalance.findMany({
			where: {
				employeeId: employee.id,
				year: currentYear
			},
			include: {
				leaveType: { select: { name: true } }
			}
		}),
		db.payrollRun.findFirst({
			where: {
				organizationId,
				periodStart: { gte: now }
			},
			orderBy: { periodStart: 'asc' }
		}),
		db.timesheet.findMany({
			where: { employeeId: employee.id },
			orderBy: { createdAt: 'desc' },
			take: 3
		})
	])

	return {
		pendingTimesheets,
		leaveBalances,
		nextPayrollRun,
		recentTimesheets
	}
}

export async function getManagerMetrics(userId: string, organizationId: string) {
	const employee = await db.employee.findFirst({
		where: { userId }
	})

	if (!employee) {
		return {
			pendingApprovals: { timesheets: 0, leave: 0 },
			teamHeadcount: 0,
			recentActivity: []
		}
	}

	const directReports = await db.employee.findMany({
		where: { reportsToId: employee.id },
		select: { id: true }
	})
	const directReportIds = directReports.map((e) => e.id)

	const [pendingTimesheets, pendingLeave, teamHeadcount, recentActivity] = await Promise.all([
		db.timesheet.count({
			where: {
				employeeId: { in: directReportIds },
				status: 'SUBMITTED'
			}
		}),
		db.leaveRequest.count({
			where: {
				employeeId: { in: directReportIds },
				status: 'PENDING'
			}
		}),
		db.employee.count({
			where: {
				reportsToId: employee.id,
				employmentStatus: 'ACTIVE'
			}
		}),
		db.auditLog.findMany({
			where: { organizationId },
			orderBy: { createdAt: 'desc' },
			take: 5,
			include: {
				actor: { select: { email: true, role: true } }
			}
		})
	])

	return {
		pendingApprovals: { timesheets: pendingTimesheets, leave: pendingLeave },
		teamHeadcount,
		recentActivity
	}
}

export async function getAdminMetrics(organizationId: string) {
	const today = new Date()
	today.setHours(0, 0, 0, 0)
	const tomorrow = new Date(today)
	tomorrow.setDate(tomorrow.getDate() + 1)

	const [
		totalHeadcount,
		onLeaveToday,
		pendingTimesheets,
		pendingLeave,
		openJobPostings,
		lastPayrollRun
	] = await Promise.all([
		db.employee.count({
			where: {
				user: { organizationId },
				employmentStatus: 'ACTIVE'
			}
		}),
		db.leaveRequest.count({
			where: {
				employee: { user: { organizationId } },
				status: 'APPROVED',
				startDate: { lte: tomorrow },
				endDate: { gte: today }
			}
		}),
		db.timesheet.count({
			where: {
				employee: { user: { organizationId } },
				status: 'SUBMITTED'
			}
		}),
		db.leaveRequest.count({
			where: {
				employee: { user: { organizationId } },
				status: 'PENDING'
			}
		}),
		db.jobPosting.count({
			where: {
				organizationId,
				status: 'OPEN'
			}
		}),
		db.payrollRun.findFirst({
			where: { organizationId },
			orderBy: { periodStart: 'desc' },
			select: {
				periodStart: true,
				periodEnd: true,
				status: true,
				totalNet: true
			}
		})
	])

	return {
		totalHeadcount,
		onLeaveToday,
		pendingTimesheets,
		pendingLeave,
		openJobPostings,
		lastPayrollRun
	}
}
