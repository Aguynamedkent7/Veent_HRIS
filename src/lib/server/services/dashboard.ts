import { db } from '$lib/server/db'
import { manilaDayKey } from '$lib/utils/dates'

// Active employees whose birthday (month + day) is `today` in PHT (#167). Dates of birth
// are stored at UTC midnight, so their UTC month/day already read as the PHT calendar day.
// Filtered in the database with EXTRACT so we never load the whole roster for a greeting.
export async function listTodaysBirthdays(organizationId: string, today: Date = new Date()) {
	const [, mm, dd] = manilaDayKey(today).split('-').map(Number)
	const rows = await db.$queryRaw<{ firstName: string; lastName: string }[]>`
		SELECT e."firstName", e."lastName"
		FROM employees e
		JOIN users u ON u.id = e."userId"
		WHERE u."organizationId" = ${organizationId}
			AND e."employmentStatus" = 'ACTIVE'
			AND e."dateOfBirth" IS NOT NULL
			AND EXTRACT(MONTH FROM e."dateOfBirth") = ${mm}
			AND EXTRACT(DAY FROM e."dateOfBirth") = ${dd}
		ORDER BY e."firstName", e."lastName"
	`
	return rows.map((r) => `${r.firstName} ${r.lastName}`)
}

// The viewer's own employment standing for the dashboard status card (#167): type, start
// date (for tenure) and contract end date (for a contractual's renewal). Null when the
// user has no employee profile (e.g. a bare admin account).
export async function getMyEmploymentStatus(userId: string) {
	return db.employee.findUnique({
		where: { userId },
		select: { employmentType: true, startDate: true, endDate: true }
	})
}

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
		db.request.count({
			where: {
				employeeId: { in: directReportIds },
				type: 'LEAVE',
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
		db.request.count({
			where: {
				employee: { user: { organizationId } },
				type: 'LEAVE',
				status: 'APPROVED',
				dateFrom: { lte: tomorrow },
				dateTo: { gte: today }
			}
		}),
		db.timesheet.count({
			where: {
				employee: { user: { organizationId } },
				status: 'SUBMITTED'
			}
		}),
		db.request.count({
			where: {
				employee: { user: { organizationId } },
				type: 'LEAVE',
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
