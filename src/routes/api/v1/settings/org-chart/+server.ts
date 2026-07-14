import { json, error } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import { getReportingNodes } from '$lib/server/services/settings/org'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized')
	requireMinRole(locals.user.role, 'HR_ADMIN')
	return json({ results: await getReportingNodes(locals.user.organizationId) })
}
