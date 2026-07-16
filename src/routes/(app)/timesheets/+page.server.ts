import { fail, isHttpError } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import {
	listTimesheets,
	getTimesheet,
	createTimesheet,
	submitTimesheet,
	updateTimesheetEntries,
	deleteTimesheet,
	submitDraftByHr
} from '$lib/server/services/timesheets'
import {
	previewTimeLogAggregation,
	aggregateTimeLogsToTimesheet
} from '$lib/server/services/timelog'
import { autoDeriveFromPunches, attendanceEntriesForRange } from '$lib/server/services/attendance'
import { db } from '$lib/server/db'
import { z } from 'zod'
import type { Actions, PageServerLoad, RequestEvent } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!
	const isManager = ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)
	const isHrAdmin = ['HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)

	const status = url.searchParams.get('status') ?? undefined

	const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })

	// A non-manager without an employee record owns no timesheets — return empty rather
	// than passing an undefined employeeId (which would list the whole org).
	const canList = isManager || Boolean(myEmployee)

	// Stream the timesheet list so the page renders a skeleton while it loads.
	const timesheets = canList
		? listTimesheets({
				organizationId: user.organizationId,
				employeeId: isManager ? undefined : myEmployee?.id,
				status
			})
		: Promise.resolve([])

	// HR gets the "Aggregate from time logs" panel, which needs an employee picker.
	const employees = isHrAdmin
		? await db.employee.findMany({
				where: { user: { organizationId: user.organizationId }, employmentStatus: 'ACTIVE' },
				select: { id: true, firstName: true, lastName: true, employeeNumber: true },
				orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
			})
		: []

	return { timesheets, myEmployeeId: myEmployee?.id, isManager, isHrAdmin, employees }
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

const aggregateSchema = z.object({
	employeeId: z.string().min(1),
	weekOf: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, 'weekOf must be YYYY-MM-DD')
		// Reject calendar-invalid dates (e.g. 2026-02-31) that Date would silently roll over.
		.refine((v) => {
			const [y, m, d] = v.split('-').map(Number)
			const dt = new Date(Date.UTC(y, m - 1, d))
			return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
		}, 'weekOf is not a valid calendar date')
})

// Scope the target employee to the caller's org; returns its id or null.
async function resolveOrgEmployee(employeeId: string, organizationId: string) {
	return db.employee.findFirst({
		where: { id: employeeId, organizationId },
		select: { id: true }
	})
}

// Entries arrive with date (YYYY-MM-DD) + optional HH:MM times; the server rebuilds PHT
// timestamps from date + time. hoursWorked is total worked; otHours is the OT portion.
const entriesSchema = z.array(
	z
		.object({
			date: z.string().min(1),
			timeIn: z.string().optional(),
			timeOut: z.string().optional(),
			hoursWorked: z.coerce.number().min(0).max(24),
			otHours: z.coerce.number().min(0).max(24).optional(),
			notes: z.string().optional()
		})
		.refine((e) => (e.otHours ?? 0) <= e.hoursWorked, {
			message: 'OT hours cannot exceed hours worked',
			path: ['otHours']
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
	// HR only — non-destructive preview of a week's punch aggregation (no DB writes).
	previewAggregate: async (event) => {
		requireMinRole(event.locals.user!.role, 'HR_ADMIN')
		const org = event.locals.user!.organizationId
		const parsed = aggregateSchema.safeParse(Object.fromEntries(await event.request.formData()))
		if (!parsed.success) return fail(400, { error: 'Pick an employee and a week.' })

		if (!(await resolveOrgEmployee(parsed.data.employeeId, org)))
			return fail(404, { error: 'Employee not found' })

		const preview = await previewTimeLogAggregation(
			parsed.data.employeeId,
			new Date(parsed.data.weekOf)
		)
		return {
			preview: { ...preview, employeeId: parsed.data.employeeId, weekOf: parsed.data.weekOf }
		}
	},

	// HR only — commit the week's punches into a DRAFT timesheet (idempotent for drafts).
	aggregate: async (event) => {
		requireMinRole(event.locals.user!.role, 'HR_ADMIN')
		const org = event.locals.user!.organizationId
		const parsed = aggregateSchema.safeParse(Object.fromEntries(await event.request.formData()))
		if (!parsed.success) return fail(400, { error: 'Pick an employee and a week.' })

		if (!(await resolveOrgEmployee(parsed.data.employeeId, org)))
			return fail(404, { error: 'Employee not found' })

		try {
			const result = await aggregateTimeLogsToTimesheet(
				parsed.data.employeeId,
				new Date(parsed.data.weekOf),
				ctxOf(event)
			)
			const days = Object.keys(result.hoursByDay).length
			return {
				saved: `Aggregated ${result.totalHours.toFixed(2)} hrs across ${days} day${days === 1 ? '' : 's'} into a draft timesheet.`
			}
		} catch (e) {
			return toFail(e)
		}
	},

	// HR only — submit an aggregated draft on the employee's behalf. Approval itself
	// happens exclusively in the review queue (/requests/timesheets).
	submitDraft: async (event) => {
		requireMinRole(event.locals.user!.role, 'HR_ADMIN')
		const id = (await event.request.formData()).get('id')
		if (typeof id !== 'string' || !id) return fail(400, { error: 'Missing timesheet id' })
		try {
			await submitDraftByHr(id, event.locals.user!.organizationId, ctxOf(event))
			return { saved: 'Timesheet submitted for review.' }
		} catch (e) {
			return toFail(e)
		}
	},

	create: async (event) => {
		const user = event.locals.user!
		const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
		if (!myEmployee) return fail(400, { error: 'No employee profile found' })

		const raw = Object.fromEntries(await event.request.formData())
		const parsed = createSchema.safeParse(raw)
		if (!parsed.success) return fail(400, { error: 'Invalid dates' })

		const ctx = ctxOf(event)
		try {
			// Reflect the employee's punches for the period, then seed the timesheet from the
			// derived attendance so a new sheet isn't empty. No attendance → an empty draft.
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
			return toFail(e)
		}
	},

	// Repopulate a draft's entries from the period's attendance (re-derives punches first).
	// Authorized in updateTimesheetEntries: the owner may sync their own draft; managers/HR too.
	syncAttendance: async (event) => {
		const org = event.locals.user!.organizationId
		const id = (await event.request.formData()).get('id') as string
		if (!id) return fail(400, { error: 'Missing timesheet id' })

		const ctx = ctxOf(event)
		try {
			const ts = await getTimesheet(id, org)
			await autoDeriveFromPunches(
				org,
				{ from: ts.periodStart, to: ts.periodEnd, employeeId: ts.employeeId },
				ctx
			)
			const entries = await attendanceEntriesForRange(ts.employeeId, ts.periodStart, ts.periodEnd)
			await updateTimesheetEntries(id, org, entries, ctx)
			return {
				saved: `Synced ${entries.length} day${entries.length === 1 ? '' : 's'} from attendance.`
			}
		} catch (e) {
			return toFail(e)
		}
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

	// Authorization is in deleteTimesheet: the owner may delete their own DRAFT/REJECTED; managers
	// (direct reports) and HR/super act more broadly. No hard role gate here.
	delete: async (event) => {
		const id = (await event.request.formData()).get('id') as string
		try {
			await deleteTimesheet(id, event.locals.user!.organizationId, ctxOf(event))
			return { saved: 'Timesheet deleted.' }
		} catch (e) {
			return toFail(e)
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

	// Mass delete: delete each selected timesheet (authorized per item in deleteTimesheet).
	// Items the caller can't delete — not owned, or submitted/approved on a select-all — throw
	// and are counted as skipped rather than aborting the batch.
	deleteMany: async (event) => {
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
	}
}
