import { fail } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import { getEmployee, updateEmployee, offboardEmployee } from '$lib/server/services/employees'
import { db } from '$lib/server/db'
import { z } from 'zod'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
	requireMinRole(locals.user!.role, 'MANAGER')

	const canManage = ['HR_ADMIN', 'SUPER_ADMIN'].includes(locals.user!.role)

	const [employee, departments] = await Promise.all([
		getEmployee(params.id, locals.user!.organizationId, locals.user!.role),
		db.department.findMany({
			where: { organizationId: locals.user!.organizationId },
			orderBy: { name: 'asc' }
		})
	])

	return { employee, departments, canManage }
}

const updateSchema = z.object({
	jobTitle: z.string().min(1).optional(),
	departmentId: z.string().optional(),
	contactPhone: z.string().optional(),
	contactAddress: z.string().optional(),
	basicMonthlySalary: z.coerce.number().positive().optional(),
	// Empty string clears the link; a value sets it (unique per employee).
	discordId: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : null))
})

export const actions: Actions = {
	update: async ({ request, locals, params, getClientAddress }) => {
		requireMinRole(locals.user!.role, 'HR_ADMIN')
		const user = locals.user!

		const raw = Object.fromEntries(await request.formData())
		const parsed = updateSchema.safeParse(raw)
		if (!parsed.success) return fail(400, { error: 'Invalid input' })

		try {
			await updateEmployee(params.id, user.organizationId, parsed.data, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			// Unique constraint on Employee.discordId
			if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
				return fail(409, { error: 'That Discord ID is already linked to another employee.' })
			}
			throw e
		}

		return { success: true }
	},

	offboard: async ({ request, locals, params, getClientAddress }) => {
		requireMinRole(locals.user!.role, 'HR_ADMIN')
		const user = locals.user!

		const data = await request.formData()
		const endDate = new Date(data.get('endDate') as string)

		await offboardEmployee(params.id, user.organizationId, endDate, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	}
}
