import { requireRole } from '$lib/server/rbac'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	requireRole(user.role, 'HR_ADMIN', 'SUPER_ADMIN')
	return { isSuperAdmin: user.role === 'SUPER_ADMIN' }
}
