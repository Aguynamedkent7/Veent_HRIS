import { json, error } from '@sveltejs/kit'
import { requireAnyMinRole } from '$lib/server/rbac'
import { getReportingNodes } from '$lib/server/services/settings/org'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized')
	requireAnyMinRole(locals.user.roles, 'HR_ADMIN')
	return json({ results: await getReportingNodes(locals.user.organizationId) })
}
