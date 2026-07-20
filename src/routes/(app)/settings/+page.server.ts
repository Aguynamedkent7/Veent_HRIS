import { can, requireCapability } from '$lib/server/rbac'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	requireCapability(user.role, 'MANAGE_HR')
	return { isSuperAdmin: can(user.role, 'ADMINISTER_SYSTEM') }
}
