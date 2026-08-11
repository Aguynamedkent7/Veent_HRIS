import { fail, error } from '@sveltejs/kit'
import { z } from 'zod'
import { ASSIGNABLE_ROLES } from '$lib/rbac'
import { canAny, requireAnyCapability } from '$lib/server/rbac'
import { failFromError } from '$lib/server/form-fail'
import { listOrgUsers, setUserRole, setUserActive } from '$lib/server/services/settings/org'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	// Role-change is CEO-only (#132); account activation stays with Super Admin. The
	// page serves both, so it opens for either capability and the UI shows only the
	// controls each caller may use.
	const canManageRoles = canAny(user.roles, 'MANAGE_USER_ROLES')
	const canManageActive = canAny(user.roles, 'ADMINISTER_SYSTEM')
	if (!canManageRoles && !canManageActive) error(403, 'Insufficient permissions')

	const users = await listOrgUsers(user.organizationId)

	return { users, canManageRoles, canManageActive }
}

const roleSchema = z.object({
	userId: z.string().min(1, 'User ID is required'),
	role: z.enum(ASSIGNABLE_ROLES)
})

const activeSchema = z.object({
	userId: z.string().min(1, 'User ID is required'),
	isActive: z.enum(['true', 'false'])
})

export const actions: Actions = {
	setRole: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireAnyCapability(user.roles, 'MANAGE_USER_ROLES')

		const raw = Object.fromEntries(await request.formData())
		const parsed = roleSchema.safeParse(raw)

		if (!parsed.success) {
			return fail(400, {
				error: 'Invalid input. Please check the form fields.',
				fieldErrors: parsed.error.flatten().fieldErrors
			})
		}

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRoles: user.roles,
			ipAddress: getClientAddress()
		}

		try {
			await setUserRole(parsed.data.userId, user.organizationId, parsed.data.role, ctx)
		} catch (err) {
			// Surface the service's guardrails — last super admin / last CEO (409) and
			// self-role-change (403) — as inline errors rather than error pages.
			return failFromError(err)
		}
	},

	setActive: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireAnyCapability(user.roles, 'ADMINISTER_SYSTEM')

		const raw = Object.fromEntries(await request.formData())
		const parsed = activeSchema.safeParse(raw)

		if (!parsed.success) {
			return fail(400, { error: 'Invalid input. Please check the form fields.' })
		}

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRoles: user.roles,
			ipAddress: getClientAddress()
		}

		try {
			await setUserActive(
				parsed.data.userId,
				user.organizationId,
				parsed.data.isActive === 'true',
				ctx
			)
		} catch (err) {
			return failFromError(err)
		}
	}
}
