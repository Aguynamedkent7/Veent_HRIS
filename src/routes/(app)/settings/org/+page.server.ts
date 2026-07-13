import { fail } from '@sveltejs/kit'
import { z } from 'zod'
import { requireMinRole } from '$lib/server/rbac'
import { listPositions, createPosition, getOrgChart } from '$lib/server/services/settings/org'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	requireMinRole(user.role, 'HR_ADMIN')

	const [positions, orgChart] = await Promise.all([
		listPositions(user.organizationId),
		getOrgChart(user.organizationId)
	])

	return { positions, orgChart }
}

const positionSchema = z.object({
	title: z.string().min(1, 'Title is required'),
	level: z.coerce.number().int().optional(),
	departmentId: z.string().optional()
})

export const actions: Actions = {
	createPosition: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'HR_ADMIN')

		const raw = Object.fromEntries(await request.formData())
		const parsed = positionSchema.safeParse(raw)

		if (!parsed.success) {
			return fail(400, {
				error: 'Invalid input. Please check the form fields.',
				fieldErrors: parsed.error.flatten().fieldErrors
			})
		}

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		}

		await createPosition(
			user.organizationId,
			{
				title: parsed.data.title,
				level: parsed.data.level,
				departmentId: parsed.data.departmentId || undefined
			},
			ctx
		)
	}
}
