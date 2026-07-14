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

// Entries arrive with date (YYYY-MM-DD) + optional HH:MM times; the server rebuilds PHT
// timestamps from date + time. hoursWorked is total worked; otHours is the OT portion.
const entriesSchema = z.array(
	z.object({
		date: z.string().min(1),
		timeIn: z.string().optional(),
		timeOut: z.string().optional(),
		hoursWorked: z.coerce.number().min(0).max(24),
		otHours: z.coerce.number().min(0).max(24).optional(),
		notes: z.string().optional()
	})
)

function toEntryInputs(rows: z.infer<typeof entriesSchema>) {
	return rows.map((e) => ({
		date: new Date(e.date),
		timeIn: e.timeIn ? new Date(`${e.date}T${e.timeIn}:00+08:00`) : null,
		timeOut: e.timeOut ? new Date(`${e.date}T${e.timeOut}:00+08:00`) : null,
		hoursWorked: e.hoursWorked,
		otHours: e.otHours ?? 0,
		notes: e.notes
	}))
}

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
			await updateTimesheetEntries(
				id,
				event.locals.user!.organizationId,
				toEntryInputs(parsed),
				ctxOf(event)
			)
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

	// Approve each selected (submitted) timesheet; non-submitted ones are skipped.
	approveMany: async (event) => {
		requireMinRole(event.locals.user!.role, 'MANAGER')
		const ids = String((await event.request.formData()).get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
		if (!ids.length) return fail(400, { error: 'No timesheets selected' })

		const org = event.locals.user!.organizationId
		const ctx = ctxOf(event)
		let done = 0
		let skipped = 0
		for (const id of ids) {
			try {
				await reviewTimesheet(id, org, true, undefined, ctx)
				done++
			} catch {
				skipped++
			}
		}
		return {
			saved: `Approved ${done} timesheet${done === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}.`
		}
	},

	// Submit each selected (draft) timesheet the current user owns; others are skipped.
	submitMany: async (event) => {
		const user = event.locals.user!
		const myEmployee = await db.employee.findUnique({
			where: { userId: user.id },
			select: { id: true }
		})
		if (!myEmployee) return fail(400, { error: 'No employee profile found' })
		const ids = String((await event.request.formData()).get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
		if (!ids.length) return fail(400, { error: 'No timesheets selected' })

		const ctx = ctxOf(event)
		let done = 0
		let skipped = 0
		for (const id of ids) {
			try {
				await submitTimesheet(id, myEmployee.id, ctx)
				done++
			} catch {
				skipped++
			}
		}
		return {
			saved: `Submitted ${done} timesheet${done === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}.`
		}
	},

	// Mass delete: delete each selected timesheet (scoped per item); report how many.
	deleteMany: async (event) => {
		requireMinRole(event.locals.user!.role, 'MANAGER')
		const ids = String((await event.request.formData()).get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
		if (!ids.length) return fail(400, { error: 'No timesheets selected' })

		const org = event.locals.user!.organizationId
		const ctx = ctxOf(event)
		let deleted = 0
		let skipped = 0
		for (const id of ids) {
			try {
				await deleteTimesheet(id, org, ctx)
				deleted++
			} catch {
				skipped++
			}
		}
		return {
			saved: `Deleted ${deleted} timesheet${deleted === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}.`
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
