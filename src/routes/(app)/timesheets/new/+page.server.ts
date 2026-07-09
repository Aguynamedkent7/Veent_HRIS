import { fail, redirect } from '@sveltejs/kit'
import { z } from 'zod'
import { db } from '$lib/server/db'
import { createTimesheet, submitTimesheet } from '$lib/server/services/timesheets'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const employee = await db.employee.findUnique({ where: { userId: user.id } })
	if (!employee) redirect(303, '/timesheets')
	return {}
}

const entrySchema = z.object({
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
	hoursWorked: z.number().min(0).max(24),
	notes: z.string().optional()
})

const createSchema = z.object({
	periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	entries: z.array(entrySchema).min(1)
})

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = locals.user!

		const employee = await db.employee.findUnique({ where: { userId: user.id } })
		if (!employee) {
			return fail(400, { error: 'No employee profile found for this user.' })
		}

		const formData = await request.formData()
		const periodStart = formData.get('periodStart') as string
		const periodEnd = formData.get('periodEnd') as string
		const entriesRaw = formData.get('entries') as string

		let parsedEntries: unknown
		try {
			parsedEntries = JSON.parse(entriesRaw)
		} catch {
			return fail(400, { error: 'Invalid entries format.' })
		}

		const result = createSchema.safeParse({
			periodStart,
			periodEnd,
			entries: parsedEntries
		})

		if (!result.success) {
			const firstError = result.error.errors[0]
			return fail(400, { error: firstError?.message ?? 'Validation error.' })
		}

		const { entries } = result.data

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role
		}

		try {
			const ts = await createTimesheet(
				employee.id,
				new Date(result.data.periodStart),
				new Date(result.data.periodEnd),
				entries.map((e) => ({
					date: new Date(e.date),
					hoursWorked: e.hoursWorked,
					notes: e.notes
				})),
				ctx
			)

			await submitTimesheet(ts.id, employee.id, ctx)
		} catch (err: unknown) {
			const e = err as { status?: number; body?: { message?: string }; message?: string }
			if (e?.status === 409) {
				return fail(409, { error: 'A timesheet for this period already exists.' })
			}
			return fail(400, { error: e?.body?.message ?? e?.message ?? 'Failed to create timesheet.' })
		}

		redirect(303, '/timesheets')
	}
}
