import { fail } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import { listBenefitPlans, createBenefitPlan } from '$lib/server/services/benefits'
import { z } from 'zod'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	requireMinRole(locals.user!.role, 'HR_ADMIN')

	const plans = await listBenefitPlans(locals.user!.organizationId)

	return { plans }
}

const createPlanSchema = z.object({
	name: z.string().min(1),
	type: z.enum(['HMO', 'INSURANCE', 'RETIREMENT', 'ALLOWANCE', 'LEAVE_CREDIT', 'OTHER']),
	provider: z.string().optional(),
	description: z.string().optional(),
	employeeCost: z.coerce.number().nonnegative().optional(),
	employerCost: z.coerce.number().nonnegative().optional()
})

export const actions: Actions = {
	createPlan: async ({ request, locals, getClientAddress }) => {
		requireMinRole(locals.user!.role, 'HR_ADMIN')
		const user = locals.user!

		const raw = Object.fromEntries(await request.formData())
		const parsed = createPlanSchema.safeParse(raw)
		if (!parsed.success) return fail(400, { error: parsed.error.flatten().fieldErrors })

		await createBenefitPlan(user.organizationId, parsed.data, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	}
}
