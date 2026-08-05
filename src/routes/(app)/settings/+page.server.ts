import { can, canAny, requireAnyCapability } from '$lib/server/rbac'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	requireAnyCapability(user.roles, 'MANAGE_HR')
	return {
		isSuperAdmin: can(user.role, 'ADMINISTER_SYSTEM'),
		// The Roles page opens for the role-changer (#132) and the account-status admin, so the card
		// evaluates that same OR rather than piggybacking on ADMINISTER_SYSTEM. A no-op while
		// MANAGE_USER_ROLES is CEO-only, but widening it can no longer leave the card behind (#237).
		//
		// #256: only the MANAGE_USER_ROLES leg is widened here — that is this PR's capability. The
		// ADMINISTER_SYSTEM leg stays on the primary role to match `settings/roles`'s own
		// `canManageActive` guard, or the card would open for a secondary-role holder the page then
		// 403s. Both legs widen together when the guard does (PR 4).
		canRoles: canAny(user.roles, 'MANAGE_USER_ROLES') || can(user.role, 'ADMINISTER_SYSTEM'),
		// Statutory Rates page is reachable by editors (CEO/Super Admin) and proposers (HR Admin).
		canStatutory:
			canAny(user.roles, 'MANAGE_STATUTORY_RATES') || canAny(user.roles, 'PROPOSE_STATUTORY_RATES')
	}
}
