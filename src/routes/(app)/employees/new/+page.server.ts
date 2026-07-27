import { fail, redirect } from '@sveltejs/kit'
import { z } from 'zod'
import { db } from '$lib/server/db'
import { requireCapability } from '$lib/server/rbac'
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
	requireCapability(locals.user!.role, 'MANAGE_HR')

	const orgId = locals.user!.organizationId
	const [departments, employees, positions, workSchedules] = await Promise.all([
		db.department.findMany({
			where: { organizationId: orgId },
			orderBy: { name: 'asc' }
		}),
		db.employee.findMany({
			where: {
				user: { organizationId: orgId },
				employmentStatus: 'ACTIVE'
			},
			select: { id: true, firstName: true, lastName: true, employeeNumber: true },
			orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
		}),
		db.position.findMany({
			where: { organizationId: orgId, isActive: true },
			select: { id: true, title: true, departmentId: true },
			orderBy: { title: 'asc' }
		}),
		db.workSchedule.findMany({
			where: { organizationId: orgId },
			select: { id: true, name: true, isDefault: true },
			orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]
		})
	])

	// orgId drives a {#key} remount of the form: switching tenants mid-onboard swaps the
	// org-scoped selects (department, reports-to, position, schedule) under the live form,
	// which would silently blank the required Department field and wedge the submit (#ceo-switch).
	return { organizationId: orgId, departments, employees, positions, workSchedules }
}

const createSchema = z.object({
	email: z.string().email(),
	password: z
		.string()
		.min(8)
		.optional()
		.or(z.literal('').transform(() => undefined)),
	firstName: z.string().min(1),
	lastName: z.string().min(1),
	middleName: z.string().optional(),
	role: z.enum(['EMPLOYEE', 'MANAGER', 'HR_ADMIN']),
	departmentId: z.string().min(1),
	jobTitle: z.string().min(1),
	// New hires start probationary (#136) unless HR picks otherwise; regularization to
	// FULL_TIME is automatic once 6 months of service have elapsed.
	employmentType: z
		.enum(['FULL_TIME', 'PROBATIONARY', 'CONTRACTUAL', 'PART_TIME'])
		.default('PROBATIONARY'),
	startDate: z.coerce.date(),
	basicMonthlySalary: z.coerce.number().positive(),
	// #120: how the amount above is read — a fixed monthly salary or a per-hour rate.
	rateType: z.enum(['MONTHLY', 'HOURLY']).default('MONTHLY'),
	sssNumber: z.string().optional(),
	philhealthNumber: z.string().optional(),
	pagibigNumber: z.string().optional(),
	tinNumber: z.string().optional(),
	emergencyContactName: z.string().optional(),
	emergencyContactRelation: z.string().optional(),
	emergencyContactPhone: z.string().optional(),
	bankName: z.string().optional(),
	bankAccountName: z.string().optional(),
	bankAccountNumber: z.string().optional(),
	gcashNumber: z.string().optional(),
	reportsToId: z
		.string()
		.optional()
		.or(z.literal('').transform(() => undefined)),
	// Work schedule + position are optional at onboarding; empty select → unset (null).
	workScheduleId: z
		.string()
		.optional()
		.or(z.literal('').transform(() => undefined)),
	positionId: z
		.string()
		.optional()
		.or(z.literal('').transform(() => undefined)),
	// Empty string leaves the Discord link unset; a value sets it (unique per employee).
	discordId: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : null))
})

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		requireCapability(locals.user!.role, 'MANAGE_HR')
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
			// Employee has three unique constraints (userId, discordId, and
			// organizationId+employeeNumber), so a bare P2002 says nothing about which one fired.
			// Read meta.target — reporting a number clash as a Discord ID problem sends the user
			// off to edit a field that was never the issue.
			if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
				const target = (e as { meta?: { target?: unknown } }).meta?.target
				const fields = Array.isArray(target) ? (target as string[]) : []
				if (fields.includes('discordId')) {
					return fail(409, {
						error: 'That Discord ID is already linked to another employee.',
						values: raw as Record<string, string>
					})
				}
				if (fields.includes('employeeNumber')) {
					// createEmployee retries a lost race, so reaching here means it lost repeatedly.
					return fail(409, {
						error: 'Could not allocate an employee number just now. Please try again.',
						values: raw as Record<string, string>
					})
				}
			}
			throw e
		}
	}
}
