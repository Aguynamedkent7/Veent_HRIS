import { fail, redirect } from '@sveltejs/kit'
import { z } from 'zod'
import { db } from '$lib/server/db'
import { getEmployee, updateEmployee } from '$lib/server/services/employees'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!

	const employeeRecord = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true }
	})

	if (!employeeRecord) redirect(303, '/dashboard')

	const employee = await getEmployee(employeeRecord.id, user.organizationId)

	return { employee }
}

const updateSchema = z.object({
	firstName: z.string().min(1).optional(),
	lastName: z.string().min(1).optional(),
	contactPhone: z.string().optional().transform((v) => v || undefined),
	contactAddress: z.string().optional().transform((v) => v || undefined),
	dateOfBirth: z
		.string()
		.optional()
		.transform((v) => (v ? new Date(v) : undefined))
})

export const actions: Actions = {
	update: async ({ request, locals }) => {
		const user = locals.user!

		const employeeRecord = await db.employee.findUnique({
			where: { userId: user.id },
			select: { id: true }
		})

		if (!employeeRecord) {
			return fail(400, { error: 'No employee profile found.' })
		}

		const formData = await request.formData()
		const result = updateSchema.safeParse({
			firstName: formData.get('firstName') || undefined,
			lastName: formData.get('lastName') || undefined,
			contactPhone: formData.get('contactPhone') || undefined,
			contactAddress: formData.get('contactAddress') || undefined,
			dateOfBirth: formData.get('dateOfBirth') || undefined
		})

		if (!result.success) {
			const firstError = result.error.errors[0]
			return fail(400, { error: firstError?.message ?? 'Validation error.' })
		}

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role
		}

		try {
			await updateEmployee(employeeRecord.id, user.organizationId, result.data, ctx)
		} catch (err: unknown) {
			const e = err as { body?: { message?: string }; message?: string }
			return fail(400, { error: e?.body?.message ?? e?.message ?? 'Failed to update profile.' })
		}

		return { success: true }
	}
}
