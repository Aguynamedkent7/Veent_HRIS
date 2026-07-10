import { fail } from '@sveltejs/kit'
import { z } from 'zod'
import { requireRole } from '$lib/server/rbac'
import { listOrgUsers, setUserRole } from '$lib/server/services/settings/org'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	requireRole(user.role, 'SUPER_ADMIN')

	const users = await listOrgUsers(user.organizationId)

	return { users }
}

const roleSchema = z.object({
	userId: z.string().min(1, 'User ID is required'),
	role: z.enum(['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'])
})

export const actions: Actions = {
	setRole: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireRole(user.role, 'SUPER_ADMIN')

		const raw = Object.fromEntries(await request.formData())
		const parsed = roleSchema.safeParse(raw)

		if (!parsed.success) {
			return fail(400, {
				error: 'Invalid input. Please check the form fields.',
				fieldErrors: parsed.error.flatten().fieldErrors
			})
		}

		// GUARDRAIL: a SUPER_ADMIN cannot change their own role.
		if (parsed.data.userId === user.id) {
			return fail(400, { error: 'You cannot change your own role.' })
		}

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		}

		await setUserRole(parsed.data.userId, user.organizationId, parsed.data.role, ctx)
	}
}
