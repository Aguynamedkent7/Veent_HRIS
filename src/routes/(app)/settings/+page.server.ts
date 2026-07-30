import { can, canAny, requireCapability } from '$lib/server/rbac'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	requireCapability(user.role, 'MANAGE_HR')
	return {
		isSuperAdmin: can(user.role, 'ADMINISTER_SYSTEM'),
		// Statutory Rates page is reachable by editors (CEO/Super Admin) and proposers (HR Admin).
		canStatutory:
			canAny(user.roles, 'MANAGE_STATUTORY_RATES') || canAny(user.roles, 'PROPOSE_STATUTORY_RATES')
	}
}
