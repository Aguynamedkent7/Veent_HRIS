import { fail } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import { listTimesheets, createTimesheet, submitTimesheet, reviewTimesheet } from '$lib/server/services/timesheets'
import { db } from '$lib/server/db'
import { z } from 'zod'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!
	const isManager = ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)

	const status = url.searchParams.get('status') ?? undefined

	const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })

	// Stream the timesheet list so the page renders a skeleton while it loads.
	const timesheets = listTimesheets({
		organizationId: user.organizationId,
		employeeId: isManager ? undefined : myEmployee?.id,
		status
	})

	return { timesheets, myEmployeeId: myEmployee?.id, isManager }
}

const createSchema = z.object({
	periodStart: z.coerce.date(),
	periodEnd: z.coerce.date()
})

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
		if (!myEmployee) return fail(400, { error: 'No employee profile found' })

		const raw = Object.fromEntries(await request.formData())
		const parsed = createSchema.safeParse(raw)
		if (!parsed.success) return fail(400, { error: 'Invalid dates' })

		await createTimesheet(myEmployee.id, parsed.data.periodStart, parsed.data.periodEnd, [], {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	},

	submit: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
		if (!myEmployee) return fail(400, { error: 'No employee profile found' })

		const data = await request.formData()
		const id = data.get('id') as string

		await submitTimesheet(id, myEmployee.id, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	},

	review: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'MANAGER')

		const data = await request.formData()
		const id = data.get('id') as string
		const approved = data.get('approved') === 'true'
		const rejectionReason = data.get('rejectionReason') as string | undefined

		await reviewTimesheet(id, user.organizationId, approved, rejectionReason, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	}
}
