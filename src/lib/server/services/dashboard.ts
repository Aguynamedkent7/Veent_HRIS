import { db } from '$lib/server/db'
import {
	REGULARIZATION_MONTHS,
	regularizationStatus
} from '$lib/utils/dates'

// How far ahead HR is warned of an upcoming regularization (#168). "2–3 weeks before"
// → a 21-day look-ahead; still-probationary staff already past due are surfaced too.
export const REGULARIZATION_NOTICE_DAYS = 21

/**
 * Probationary employees due to regularize within the notice window — plus any already
 * past due but still marked probationary, which is HR's to fix. Ordered soonest first so
 * overdue rows lead. Kept a DB-side filter by translating the regularization ceiling
 * (asOf + notice window) back to a start-date bound, so Postgres does the filtering
 * instead of loading every probationary row.
 */
export async function listUpcomingRegularizations(organizationId: string, asOf: Date = new Date()) {
	const ceiling = new Date(asOf)
	ceiling.setUTCDate(ceiling.getUTCDate() + REGULARIZATION_NOTICE_DAYS)
	// regularization = startDate + 6mo ≤ ceiling  ⇔  startDate ≤ ceiling − 6mo.
	const startCeiling = new Date(ceiling)
	startCeiling.setUTCMonth(startCeiling.getUTCMonth() - REGULARIZATION_MONTHS)

	const employees = await db.employee.findMany({
		where: {
			user: { organizationId },
			employmentType: 'PROBATIONARY',
			employmentStatus: 'ACTIVE',
			startDate: { lte: startCeiling }
		},
		select: {
			id: true,
			firstName: true,
			lastName: true,
			jobTitle: true,
			startDate: true,
			department: { select: { name: true } }
		}
	})

	return employees
		.map((e) => {
			const { date, daysUntil, overdue } = regularizationStatus(e.startDate, asOf)
			return {
				id: e.id,
				name: `${e.firstName} ${e.lastName}`,
				jobTitle: e.jobTitle,
				department: e.department.name,
				startDate: e.startDate,
				regularizationDate: date,
				daysUntil,
				overdue
			}
		})
		.sort((a, b) => a.daysUntil - b.daysUntil)
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
