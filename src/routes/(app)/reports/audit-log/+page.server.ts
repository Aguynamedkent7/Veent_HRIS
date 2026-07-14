import { requireRole } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!
	requireRole(user.role, 'HR_ADMIN', 'SUPER_ADMIN')
	const isSuperAdmin = user.role === 'SUPER_ADMIN'

	const page = Number(url.searchParams.get('page') ?? '1')
	const perPage = 50
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

	const [logs, totalCount, actors] = await Promise.all([
		db.auditLog.findMany({
			where,
			orderBy: { createdAt: 'desc' },
			skip: (page - 1) * perPage,
			take: perPage,
			include: { actor: { select: { email: true, role: true } } }
		}),
		db.auditLog.count({ where }),
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
		totalCount,
		actors,
		page,
		perPage,
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
