import { json } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import { listTimesheets } from '$lib/server/services/timesheets'
import { apiError } from '$lib/server/api-error'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')

	try {
		requireMinRole(locals.user.role, 'MANAGER')
	} catch {
		return apiError(403, 'Insufficient permissions')
	}

	const status = url.searchParams.get('status') ?? undefined
	const timesheets = await listTimesheets({ organizationId: locals.user.organizationId, status })

	return json({ data: timesheets, count: timesheets.length })
}
