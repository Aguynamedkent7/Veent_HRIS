import { fail, redirect } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import { listEmployees, createEmployee, offboardEmployee } from '$lib/server/services/employees'
import { db } from '$lib/server/db'
import { z } from 'zod'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
	requireMinRole(locals.user!.role, 'MANAGER')

	const search = url.searchParams.get('search') ?? undefined
	const departmentId = url.searchParams.get('department') ?? undefined

	// Stream the (potentially large) employee list so the page can render a
	// skeleton immediately; departments are small and needed for the filter/form.
	const employees = listEmployees(locals.user!.organizationId, { search, departmentId })
	const departments = await db.department.findMany({
		where: { organizationId: locals.user!.organizationId },
		orderBy: { name: 'asc' }
	})

	return { employees, departments }
}

const createSchema = z.object({
	email: z.string().email(),
	firstName: z.string().min(1),
	lastName: z.string().min(1),
	middleName: z.string().optional(),
	departmentId: z.string().min(1),
	jobTitle: z.string().min(1),
	employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACTUAL', 'PROBATIONARY']),
	startDate: z.coerce.date(),
	basicMonthlySalary: z.coerce.number().positive(),
	role: z.enum(['EMPLOYEE', 'MANAGER', 'HR_ADMIN']).default('EMPLOYEE')
})

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		requireMinRole(locals.user!.role, 'HR_ADMIN')
		const user = locals.user!

		const raw = Object.fromEntries(await request.formData())
		const parsed = createSchema.safeParse(raw)
		if (!parsed.success) return fail(400, { error: parsed.error.flatten().fieldErrors })

		try {
			await createEmployee(
				user.organizationId,
				{ ...parsed.data, password: Math.random().toString(36).slice(-12) + 'A1!' },
				{
					organizationId: user.organizationId,
					actorId: user.id,
					actorRole: user.role,
					ipAddress: getClientAddress()
				}
			)
		} catch (e: unknown) {
			if (e instanceof Error && e.message === 'Email already in use') {
				return fail(409, { error: 'Email already in use' })
			}
			throw e
		}
	},

	offboard: async ({ request, locals, getClientAddress }) => {
		requireMinRole(locals.user!.role, 'HR_ADMIN')
		const user = locals.user!

		const data = await request.formData()
		const id = data.get('id') as string
		const endDate = new Date(data.get('endDate') as string)

		await offboardEmployee(id, user.organizationId, endDate, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	}
}
