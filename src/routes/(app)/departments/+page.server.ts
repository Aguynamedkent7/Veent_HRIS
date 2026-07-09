import { fail } from '@sveltejs/kit'
import { z } from 'zod'
import { requireRole } from '$lib/server/rbac'
import { listDepartments, createDepartment, updateDepartment } from '$lib/server/services/departments'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const departments = await listDepartments(locals.user!.organizationId)
	return { departments }
}

const nameSchema = z.object({
	name: z.string().min(1, 'Name is required')
})

const updateSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1, 'Name is required')
})

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')
		const user = locals.user!

		const raw = Object.fromEntries(await request.formData())
		const parsed = nameSchema.safeParse(raw)

		if (!parsed.success) {
			return fail(400, { fieldErrors: parsed.error.flatten().fieldErrors })
		}

		await createDepartment(user.organizationId, parsed.data.name, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	},

	update: async ({ request, locals, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')
		const user = locals.user!

		const raw = Object.fromEntries(await request.formData())
		const parsed = updateSchema.safeParse(raw)

		if (!parsed.success) {
			return fail(400, { fieldErrors: parsed.error.flatten().fieldErrors })
		}

		await updateDepartment(parsed.data.id, user.organizationId, parsed.data.name, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	}
}
