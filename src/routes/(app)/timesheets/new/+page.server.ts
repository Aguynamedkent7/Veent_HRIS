import { fail, isHttpError, redirect } from '@sveltejs/kit'
import { z } from 'zod'
import { db } from '$lib/server/db'
import { createTimesheet } from '$lib/server/services/timesheets'
import { autoDeriveFromPunches, attendanceEntriesForRange } from '$lib/server/services/attendance'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const employee = await db.employee.findUnique({ where: { userId: user.id } })
	if (!employee) redirect(303, '/timesheets')
	return {}
}

const createSchema = z.object({
	periodStart: z.coerce.date(),
	periodEnd: z.coerce.date()
})

export const actions: Actions = {
	// Period-range create: reflect the employee's punches for the period and seed a
	// DRAFT timesheet from the derived attendance (no punches → an empty draft). The
	// draft is submitted separately from /timesheets — creation never sends for review.
	create: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
		if (!myEmployee) return fail(400, { error: 'No employee profile found' })

		const parsed = createSchema.safeParse(Object.fromEntries(await request.formData()))
		if (!parsed.success) return fail(400, { error: 'Invalid dates' })

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		}
		try {
			await autoDeriveFromPunches(
				user.organizationId,
				{ from: parsed.data.periodStart, to: parsed.data.periodEnd, employeeId: myEmployee.id },
				ctx
			)
			const entries = await attendanceEntriesForRange(
				myEmployee.id,
				parsed.data.periodStart,
				parsed.data.periodEnd
			)
			await createTimesheet(
				myEmployee.id,
				parsed.data.periodStart,
				parsed.data.periodEnd,
				entries,
				ctx
			)
		} catch (e) {
			if (isHttpError(e) && [400, 403, 404, 409].includes(e.status))
				return fail(e.status, { error: e.body.message })
			throw e
		}

		redirect(303, '/timesheets')
	}
}
