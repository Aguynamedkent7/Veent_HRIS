import { requireMinRole } from '$lib/server/rbac'
import { getReportingNodes } from '$lib/server/services/settings/org'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	requireMinRole(user.role, 'HR_ADMIN')

	return { nodes: await getReportingNodes(user.organizationId) }
}
