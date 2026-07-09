import { fail, redirect } from '@sveltejs/kit'
import { z } from 'zod'
import { db } from '$lib/server/db'
import { requireRole } from '$lib/server/rbac'
import { createEmployee } from '$lib/server/services/employees'
import { sendWelcomeEmail } from '$lib/server/notifications'
import type { Actions, PageServerLoad } from './$types'

function generateTempPassword(): string {
	const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
	let result = ''
	for (let i = 0; i < 8; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length))
	}
	return result
}

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')

	const [departments, employees] = await Promise.all([
		db.department.findMany({
			where: { organizationId: locals.user!.organizationId },
			orderBy: { name: 'asc' }
		}),
		db.employee.findMany({
			where: {
				user: { organizationId: locals.user!.organizationId },
				employmentStatus: 'ACTIVE'
			},
			select: { id: true, firstName: true, lastName: true, employeeNumber: true },
			orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
		})
	])

	return { departments, employees }
}

const createSchema = z.object({
	email: z.string().email(),
	password: z.string().min(8).optional().or(z.literal('').transform(() => undefined)),
	firstName: z.string().min(1),
	lastName: z.string().min(1),
	middleName: z.string().optional(),
	role: z.enum(['EMPLOYEE', 'MANAGER', 'HR_ADMIN']),
	departmentId: z.string().min(1),
	jobTitle: z.string().min(1),
	employmentType: z.enum(['FULL_TIME', 'PROBATIONARY', 'CONTRACTUAL', 'PART_TIME']),
	startDate: z.coerce.date(),
	basicMonthlySalary: z.coerce.number().positive(),
	sssNumber: z.string().optional(),
	philhealthNumber: z.string().optional(),
	pagibigNumber: z.string().optional(),
	tinNumber: z.string().optional(),
	reportsToId: z.string().optional().or(z.literal('').transform(() => undefined))
})

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')
		const user = locals.user!

		const raw = Object.fromEntries(await request.formData())
		const parsed = createSchema.safeParse(raw)

		if (!parsed.success) {
			return fail(400, {
				fieldErrors: parsed.error.flatten().fieldErrors,
				values: raw as Record<string, string>
			})
		}

		const tempPassword = parsed.data.password ?? generateTempPassword()

		try {
			const newEmployee = await createEmployee(
				user.organizationId,
				{
					...parsed.data,
					password: tempPassword,
					reportsToId: parsed.data.reportsToId || undefined
				},
				{
					organizationId: user.organizationId,
					actorId: user.id,
					actorRole: user.role,
					ipAddress: getClientAddress()
				}
			)

			sendWelcomeEmail(parsed.data.email, tempPassword)

			redirect(303, `/employees/${newEmployee.id}`)
		} catch (e: unknown) {
			const errMsg = e instanceof Error ? e.message : String(e)
			if (errMsg.includes('Email already in use') || errMsg.includes('409')) {
				return fail(409, {
					error: 'An account with this email already exists.',
					values: raw as Record<string, string>
				})
			}
			throw e
		}
	}
}
