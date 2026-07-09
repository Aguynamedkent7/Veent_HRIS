import { json, error } from '@sveltejs/kit'
import { requireRole } from '$lib/server/rbac'
import {
	generateHeadcount,
	generateAttendance,
	generatePayrollCosts,
	generateLeaveUtilization,
	exportToCSV
} from '$lib/server/services/reports'
import type { RequestHandler } from './$types'

const VALID_TYPES = ['headcount', 'attendance', 'payroll-costs', 'leave-utilization'] as const

export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (!locals.user) error(401, 'Unauthorized')

	const user = locals.user
	requireRole(user.role, 'HR_ADMIN', 'SUPER_ADMIN')

	const type = params.type
	if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
		error(404, 'Unknown report type')
	}

	const startDate = url.searchParams.get('start')
		? new Date(url.searchParams.get('start')!)
		: new Date(new Date().getFullYear(), 0, 1)
	const endDate = url.searchParams.get('end')
		? new Date(url.searchParams.get('end')!)
		: new Date()
	const departmentId = url.searchParams.get('department') ?? undefined
	const exportCsv = url.searchParams.get('export') === 'csv'

	let results: Record<string, unknown>[] = []

	if (type === 'headcount') {
		results = await generateHeadcount(user.organizationId, { startDate, endDate, departmentId })
	} else if (type === 'attendance') {
		results = await generateAttendance(user.organizationId, { startDate, endDate, departmentId })
	} else if (type === 'payroll-costs') {
		results = await generatePayrollCosts(user.organizationId, { startDate, endDate })
	} else if (type === 'leave-utilization') {
		results = await generateLeaveUtilization(user.organizationId, { startDate, endDate })
	}

	if (exportCsv) {
		const csv = exportToCSV(results)
		return new Response(csv, {
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="${type}.csv"`
			}
		})
	}

	return json({ results })
}
