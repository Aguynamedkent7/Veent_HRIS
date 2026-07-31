/**
 * Tenant-shape constants.
 *
 * Lives in `$lib` (not `$lib/server`) for the same reason as `$lib/rbac`: the sidebar
 * decides what to render from the same table the server enforces, so a tab that appears
 * where the load would reject is impossible by construction. `$lib/server/rbac` wraps this
 * in the throwing guard.
 */

/**
 * The food-service tenants (#131/#140) — JoJo Potato and Sweetleaf. These are the ones that
 * run physical stores, so they get Branches; they also use brand marks without a wordmark,
 * so the header renders one beside the logo (#139). Split this constant if those two ever
 * diverge.
 *
 * A hardcoded allowlist is right for now and matches the existing precedent. When a fourth
 * tenant appears, the upgrade is an `Organization.usesBranches` flag — and this function is
 * the single seam where that swap happens.
 */
export const FOOD_SERVICE_ORG_IDS = ['org_jojo', 'org_sweetleaf'] as const

export function isFoodServiceOrg(organizationId: string | null | undefined): boolean {
	return !!organizationId && (FOOD_SERVICE_ORG_IDS as readonly string[]).includes(organizationId)
}
