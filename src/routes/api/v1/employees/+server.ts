import { json } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import { listEmployees } from '$lib/server/services/employees'
import { apiError } from '$lib/server/api-error'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')

	try {
		requireMinRole(locals.user.role, 'MANAGER')
	} catch {
		return apiError(403, 'Insufficient permissions')
	}

	const search = url.searchParams.get('search') ?? undefined
	const departmentId = url.searchParams.get('departmentId') ?? undefined

	const employees = await listEmployees(locals.user.organizationId, { search, departmentId })

	return json({ data: employees, count: employees.length })
}
