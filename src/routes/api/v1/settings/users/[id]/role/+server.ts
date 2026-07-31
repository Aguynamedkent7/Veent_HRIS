import { json, error } from '@sveltejs/kit'
import { z } from 'zod'
import { requireCapability } from '$lib/server/rbac'
import { setUserRole } from '$lib/server/services/settings/org'
import type { RequestHandler } from './$types'

const roleSchema = z.object({
	role: z.enum(['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN', 'PAYROLL_OFFICER', 'FINANCE'])
})

// PATCH /api/v1/settings/users/:id/role — set a user's role.
// The last-active-super-admin (409) and self-role-change (403) guardrails both live in setUserRole,
// so this handler and the roles form action enforce the same rules without restating them.
export const PATCH: RequestHandler = async ({ locals, params, request, getClientAddress }) => {
	if (!locals.user) error(401, 'Unauthorized')
	const user = locals.user
	// Role changes are CEO-exclusive (#132) — Super Admin / HR Admin no longer qualify.
	requireCapability(user.role, 'MANAGE_USER_ROLES')

	const parsed = roleSchema.safeParse(await request.json())
	if (!parsed.success) error(422, parsed.error.errors[0]?.message ?? 'Invalid role')

	const updated = await setUserRole(params.id, user.organizationId, parsed.data.role, {
		organizationId: user.organizationId,
		actorId: user.id,
		actorRole: user.role,
		ipAddress: getClientAddress()
	})
	return json({ data: { id: updated.id, role: updated.role } })
}
