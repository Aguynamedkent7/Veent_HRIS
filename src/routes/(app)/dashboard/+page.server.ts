import { db } from '$lib/server/db'
import { redis, CACHE_TTL } from '$lib/server/redis'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const cacheKey = `dashboard:metrics:${user.organizationId}`

	const cached = await redis.get(cacheKey).catch(() => null)
	if (cached) return { metrics: JSON.parse(cached) }

	const [headcount, pendingLeave, pendingTimesheets, lastPayrollRun] = await Promise.all([
		db.employee.count({
			where: { user: { organizationId: user.organizationId }, employmentStatus: 'ACTIVE' }
		}),
		db.leaveRequest.count({
			where: {
				employee: { user: { organizationId: user.organizationId } },
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

	const metrics = { headcount, pendingLeave, pendingTimesheets, lastPayrollRun }

	await redis.setex(cacheKey, CACHE_TTL.DASHBOARD_METRICS, JSON.stringify(metrics)).catch(() => null)

	return { metrics }
}
