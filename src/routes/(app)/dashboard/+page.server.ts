import { db } from '$lib/server/db'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!

	const [headcount, pendingLeave, pendingTimesheets, lastPayrollRun] = await Promise.all([
		db.employee.count({
			where: { user: { organizationId: user.organizationId }, employmentStatus: 'ACTIVE' }
		}),
		db.request.count({
			where: {
				employee: { user: { organizationId: user.organizationId } },
				type: 'LEAVE',
				status: 'PENDING'
			}
		}),
		db.timesheet.count({
			where: {
				employee: { user: { organizationId: user.organizationId } },
				status: 'SUBMITTED'
			}
		}),
		db.payrollRun.findFirst({
			where: { organizationId: user.organizationId },
			orderBy: { createdAt: 'desc' },
			select: { periodStart: true, periodEnd: true, status: true, totalNet: true }
		})
	])

	return { metrics: { headcount, pendingLeave, pendingTimesheets, lastPayrollRun } }
}
