import { json, error } from '@sveltejs/kit'
import { requireRole } from '$lib/server/rbac'
import { listOrgUsers } from '$lib/server/services/settings/org'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized')
	requireRole(locals.user.role, 'SUPER_ADMIN')
	return json({ results: await listOrgUsers(locals.user.organizationId) })
}
