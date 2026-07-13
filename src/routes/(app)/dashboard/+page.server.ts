import { db } from '$lib/server/db'
import { manilaDayKey } from '$lib/utils/dates'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const orgId = user.organizationId

	// Today's PHT day, stored as the UTC-midnight date key used by AttendanceDay.
	const todayKey = manilaDayKey(new Date())
	const today = new Date(`${todayKey}T00:00:00Z`)

	const [headcount, onLeaveToday, pendingRequests, pendingTimesheets, lastPayrollRun, attendanceGroups] =
		await Promise.all([
			db.employee.count({
				where: { user: { organizationId: orgId }, employmentStatus: 'ACTIVE' }
			}),
			// Employees on approved leave that spans today.
			db.request.count({
				where: {
					employee: { user: { organizationId: orgId } },
					type: 'LEAVE',
					status: 'APPROVED',
					dateFrom: { lte: today },
					dateTo: { gte: today }
				}
			}),
			// All pending requests (leave, OT, etc.) awaiting a decision.
			db.request.count({
				where: { employee: { user: { organizationId: orgId } }, status: 'PENDING' }
			}),
			db.timesheet.count({
				where: { employee: { user: { organizationId: orgId } }, status: 'SUBMITTED' }
			}),
			db.payrollRun.findFirst({
				where: { organizationId: orgId },
				orderBy: { createdAt: 'desc' },
				select: { periodStart: true, periodEnd: true, status: true, totalNet: true }
			}),
			// Today's derived attendance, grouped by status.
			db.attendanceDay.groupBy({
				by: ['status'],
				where: { date: today, employee: { user: { organizationId: orgId } } },
				_count: { _all: true }
			})
		])

	const attStatus = (s: string) => attendanceGroups.find((g) => g.status === s)?._count._all ?? 0
	const attendance = {
		present: attStatus('PRESENT'),
		late: attStatus('LATE'),
		absent: attStatus('ABSENT'),
		onLeave: attStatus('ON_LEAVE'),
		derived: attendanceGroups.reduce((s, g) => s + g._count._all, 0)
	}

	return {
		metrics: {
			headcount,
			onLeaveToday,
			pendingApprovals: pendingRequests + pendingTimesheets,
			pendingRequests,
			pendingTimesheets,
			lastPayrollRun,
			attendance
		}
	}
}
