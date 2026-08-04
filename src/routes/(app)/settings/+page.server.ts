import { can, canAny, requireCapability } from '$lib/server/rbac'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	requireCapability(user.role, 'MANAGE_HR')
	return {
		isSuperAdmin: can(user.role, 'ADMINISTER_SYSTEM'),
		// The Roles page opens for the role-changer (#132) and the account-status admin, so the card
		// evaluates that same OR rather than piggybacking on ADMINISTER_SYSTEM. A no-op while
		// MANAGE_USER_ROLES is CEO-only, but widening it can no longer leave the card behind (#237).
		canRoles: can(user.role, 'MANAGE_USER_ROLES') || can(user.role, 'ADMINISTER_SYSTEM'),
		// Statutory Rates page is reachable by editors (CEO/Super Admin) and proposers (HR Admin).
		canStatutory:
			canAny(user.roles, 'MANAGE_STATUTORY_RATES') || canAny(user.roles, 'PROPOSE_STATUTORY_RATES')
	}
}
