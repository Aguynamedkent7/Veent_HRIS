import { can, requireAnyCapability } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import { paginate } from '$lib/server/pagination'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!
	requireAnyCapability(user.roles, 'MANAGE_HR')
	const isSuperAdmin = can(user.role, 'ADMINISTER_SYSTEM')

	const actorId = url.searchParams.get('actor') ?? undefined
	const entityType = url.searchParams.get('entity') ?? undefined
	const action = url.searchParams.get('action') ?? undefined
	const startDate = url.searchParams.get('start')
		? new Date(url.searchParams.get('start')!)
		: undefined
	const endDate = url.searchParams.get('end') ? new Date(url.searchParams.get('end')!) : undefined

	const where = {
		organizationId: user.organizationId,
		...(actorId && { actorId }),
		...(entityType && { entityType }),
		...(action && { action: action as never }),
		...(startDate || endDate ? { createdAt: { gte: startDate, lte: endDate } } : {})
	}

	// #64: shared helper (audit log keeps its 50-row pages); count first so an
	// out-of-range ?page= clamps to the last page.
	const total = await db.auditLog.count({ where })
	const pagination = paginate(url, total, { pageSize: 50 })

	const [logs, actors] = await Promise.all([
		db.auditLog.findMany({
			where,
			orderBy: { createdAt: 'desc' },
			skip: pagination.skip,
			take: pagination.take,
			include: { actor: { select: { email: true, role: true } } }
		}),
		db.user.findMany({
			where: { organizationId: user.organizationId },
			select: { id: true, email: true }
		})
	])

	// Redact old/new values for HR_ADMIN (only SUPER_ADMIN sees them)
	const sanitizedLogs = logs.map(
		(log: {
			id: string
			action: string
			entityType: string
			entityId: string
			oldValue: unknown
			newValue: unknown
			createdAt: Date
			actor: { email: string; role: string }
		}) => ({
			...log,
			oldValue: isSuperAdmin ? log.oldValue : null,
			newValue: isSuperAdmin ? log.newValue : null
		})
	)

	return {
		logs: sanitizedLogs,
		actors,
		pagination,
		entityTypes: [
			'Employee',
			'Timesheet',
			'Request',
			'LeaveRequest',
			'PayrollRun',
			'JobPosting',
			'Applicant',
			'Department'
		]
	}
}
