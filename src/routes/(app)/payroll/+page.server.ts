import { fail } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import { listPayrollRuns, createPayrollRun, computePayroll, approvePayroll } from '$lib/server/services/payroll/index'
import { z } from 'zod'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	requireMinRole(locals.user!.role, 'HR_ADMIN')
	const runs = await listPayrollRuns(locals.user!.organizationId)
	return { runs }
}

const createSchema = z.object({
	periodStart: z.coerce.date(),
	periodEnd: z.coerce.date()
})

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'HR_ADMIN')

		const raw = Object.fromEntries(await request.formData())
		const parsed = createSchema.safeParse(raw)
		if (!parsed.success) return fail(400, { error: 'Invalid dates' })

		try {
			await createPayrollRun(user.organizationId, parsed.data.periodStart, parsed.data.periodEnd, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			if (e instanceof Error && e.message.includes('already exists')) return fail(409, { error: e.message })
			throw e
		}
	},

	compute: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'HR_ADMIN')

		const data = await request.formData()
		const id = data.get('id') as string

		await computePayroll(id, user.organizationId, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	},

	approve: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'SUPER_ADMIN')

		const data = await request.formData()
		const id = data.get('id') as string

		await approvePayroll(id, user.organizationId, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	}
}
