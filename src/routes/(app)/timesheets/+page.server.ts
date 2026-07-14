import { fail, isHttpError } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import {
	listTimesheets,
	createTimesheet,
	submitTimesheet,
	reviewTimesheet,
	updateTimesheetEntries,
	deleteTimesheet
} from '$lib/server/services/timesheets'
import { db } from '$lib/server/db'
import { z } from 'zod'
import type { Actions, PageServerLoad, RequestEvent } from './$types'

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

function ctxOf(event: RequestEvent) {
	const u = event.locals.user!
	return {
		organizationId: u.organizationId,
		actorId: u.id,
		actorRole: u.role,
		ipAddress: event.getClientAddress()
	}
}

function toFail(e: unknown) {
	if (isHttpError(e) && [400, 403, 404, 409].includes(e.status))
		return fail(e.status, { error: e.body.message })
	throw e
}

const createSchema = z.object({
	periodStart: z.coerce.date(),
	periodEnd: z.coerce.date()
})

const entriesSchema = z.array(
	z.object({
		date: z.coerce.date(),
		hoursWorked: z.coerce.number().min(0).max(24),
		notes: z.string().optional()
	})
)

export const actions: Actions = {
	create: async (event) => {
		const user = event.locals.user!
		const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
		if (!myEmployee) return fail(400, { error: 'No employee profile found' })

		const raw = Object.fromEntries(await event.request.formData())
		const parsed = createSchema.safeParse(raw)
		if (!parsed.success) return fail(400, { error: 'Invalid dates' })

		await createTimesheet(
			myEmployee.id,
			parsed.data.periodStart,
			parsed.data.periodEnd,
			[],
			ctxOf(event)
		)
	},

	submit: async (event) => {
		const user = event.locals.user!
		const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
		if (!myEmployee) return fail(400, { error: 'No employee profile found' })

		const id = (await event.request.formData()).get('id') as string
		try {
			await submitTimesheet(id, myEmployee.id, ctxOf(event))
			return { saved: 'Timesheet submitted for review.' }
		} catch (e) {
			return toFail(e)
		}
	},

	// HR review edit: replace the timesheet's entries and recompute its total.
	saveEntries: async (event) => {
		requireMinRole(event.locals.user!.role, 'MANAGER')
		const data = await event.request.formData()
		const id = data.get('id') as string
		let parsed
		try {
			parsed = entriesSchema.parse(JSON.parse(String(data.get('entries') ?? '[]')))
		} catch {
			return fail(400, { error: 'Invalid timesheet entries' })
		}
		try {
			await updateTimesheetEntries(id, event.locals.user!.organizationId, parsed, ctxOf(event))
			return { saved: 'Timesheet entries saved.' }
		} catch (e) {
			return toFail(e)
		}
	},

	delete: async (event) => {
		requireMinRole(event.locals.user!.role, 'MANAGER')
		const id = (await event.request.formData()).get('id') as string
		try {
			await deleteTimesheet(id, event.locals.user!.organizationId, ctxOf(event))
			return { saved: 'Timesheet deleted.' }
		} catch (e) {
			return toFail(e)
		}
	},

	review: async (event) => {
		requireMinRole(event.locals.user!.role, 'MANAGER')
		const data = await event.request.formData()
		const id = data.get('id') as string
		const approved = data.get('approved') === 'true'
		const rejectionReason = (data.get('rejectionReason') as string) || undefined
		if (!approved && !rejectionReason)
			return fail(400, { error: 'A reason is required to reject.' })
		try {
			await reviewTimesheet(
				id,
				event.locals.user!.organizationId,
				approved,
				rejectionReason,
				ctxOf(event)
			)
			return { saved: approved ? 'Timesheet approved.' : 'Timesheet rejected.' }
		} catch (e) {
			return toFail(e)
		}
	}
}
