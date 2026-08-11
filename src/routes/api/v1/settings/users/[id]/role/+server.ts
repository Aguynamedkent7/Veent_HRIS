import { json, error } from '@sveltejs/kit'
import { z } from 'zod'
import { ASSIGNABLE_ROLES } from '$lib/rbac'
import { requireAnyCapability } from '$lib/server/rbac'
import { setUserRole } from '$lib/server/services/settings/org'
import type { RequestHandler } from './$types'

const roleSchema = z.object({
	role: z.enum(ASSIGNABLE_ROLES)
})

// PATCH /api/v1/settings/users/:id/role — set a user's role.
// The last-active-super-admin / last-active-CEO (409) and self-role-change (403) guardrails all
// live in setUserRole, so this handler and the roles form action enforce the same rules without
// restating them. This route has never had a target-role check of its own and still does not:
// the page's old `u.role !== 'CEO'` block was UI-only and never reached here (#248).
export const PATCH: RequestHandler = async ({ locals, params, request, getClientAddress }) => {
	if (!locals.user) error(401, 'Unauthorized')
	const user = locals.user
	// Role changes are CEO-exclusive (#132) — Super Admin / HR Admin no longer qualify.
	requireAnyCapability(user.roles, 'MANAGE_USER_ROLES')

	const parsed = roleSchema.safeParse(await request.json())
	if (!parsed.success) error(422, parsed.error.errors[0]?.message ?? 'Invalid role')

	const updated = await setUserRole(params.id, user.organizationId, parsed.data.role, {
		organizationId: user.organizationId,
		actorId: user.id,
		actorRoles: user.roles,
		ipAddress: getClientAddress()
	})
	return json({ data: { id: updated.id, role: updated.role } })
}
