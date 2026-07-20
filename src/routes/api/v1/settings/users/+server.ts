import { json, error } from '@sveltejs/kit'
import { requireCapability } from '$lib/server/rbac'
import { listOrgUsers } from '$lib/server/services/settings/org'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized')
	requireCapability(locals.user.role, 'ADMINISTER_SYSTEM')
	return json({ results: await listOrgUsers(locals.user.organizationId) })
}
