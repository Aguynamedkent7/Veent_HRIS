import { fail, isHttpError } from '@sveltejs/kit'
import { z } from 'zod'
import { requireCapability } from '$lib/server/rbac'
import { listOrgUsers, setUserRole, setUserActive } from '$lib/server/services/settings/org'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	requireCapability(user.role, 'ADMINISTER_SYSTEM')

	const users = await listOrgUsers(user.organizationId)

	return { users }
}

const roleSchema = z.object({
	userId: z.string().min(1, 'User ID is required'),
	role: z.enum(['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'SUPER_ADMIN', 'PAYROLL_OFFICER', 'FINANCE'])
})

const activeSchema = z.object({
	userId: z.string().min(1, 'User ID is required'),
	isActive: z.enum(['true', 'false'])
})

export const actions: Actions = {
	setRole: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireCapability(user.role, 'ADMINISTER_SYSTEM')

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

		try {
			await setUserRole(parsed.data.userId, user.organizationId, parsed.data.role, ctx)
		} catch (err) {
			// Surface the last-super-admin guardrail as an inline error, not a 409 page.
			if (isHttpError(err) && err.status === 409) return fail(409, { error: err.body.message })
			throw err
		}
	},

	setActive: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireCapability(user.role, 'ADMINISTER_SYSTEM')

		const raw = Object.fromEntries(await request.formData())
		const parsed = activeSchema.safeParse(raw)

		if (!parsed.success) {
			return fail(400, { error: 'Invalid input. Please check the form fields.' })
		}

		// GUARDRAIL: a SUPER_ADMIN cannot deactivate their own account.
		if (parsed.data.userId === user.id) {
			return fail(400, { error: 'You cannot deactivate your own account.' })
		}

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
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
			if (isHttpError(err) && err.status === 409) return fail(409, { error: err.body.message })
			throw err
		}
	}
}
