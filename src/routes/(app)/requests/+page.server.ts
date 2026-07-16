import { fail, isHttpError } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import {
	createRequest,
	listRequests,
	cancelRequest,
	resubmitRequest
} from '$lib/server/services/requests'
import { requestSchema } from '$lib/server/schemas/requests'
import type { Actions, PageServerLoad } from './$types'

// Self-service: the current user's own requests. Approvals live under
// /requests/timesheets and /requests/approvals.
export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const myEmployee = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true }
	})

	const [requests, leaveTypes] = await Promise.all([
		myEmployee
			? listRequests({ organizationId: user.organizationId, employeeId: myEmployee.id })
			: Promise.resolve([]),
		db.leaveType.findMany({
			where: { organizationId: user.organizationId, isActive: true },
			orderBy: { name: 'asc' },
			select: { id: true, name: true }
		})
	])

	return { requests, leaveTypes, hasEmployee: Boolean(myEmployee) }
}

// Build the type-specific raw payload from flat form fields, keyed by request type.
function rawFromForm(type: string, f: FormData): Record<string, unknown> {
	const s = (k: string) => (f.get(k) as string) || undefined
	switch (type) {
		case 'LEAVE':
			return {
				type,
				leaveTypeId: s('leaveTypeId'),
				startDate: s('startDate'),
				endDate: s('endDate'),
				reason: s('reason')
			}
		case 'OFFICIAL_BUSINESS':
			return {
				type,
				startDate: s('startDate'),
				endDate: s('endDate'),
				location: s('location'),
				purpose: s('purpose')
			}
		case 'OVERTIME':
		case 'UNDERTIME':
		case 'REST_DAY_WORK':
		case 'HOLIDAY_WORK':
			return { type, date: s('date'), hours: s('hours'), reason: s('reason') }
		case 'INFO_UPDATE':
			return {
				type,
				field: s('field'),
				currentValue: s('currentValue'),
				requestedValue: s('requestedValue'),
				reason: s('reason')
			}
		default:
			return { type }
	}
}

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		const myEmployee = await db.employee.findUnique({
			where: { userId: user.id },
			select: { id: true }
		})
		if (!myEmployee) return fail(400, { error: 'No employee profile found.' })

		const f = await request.formData()
		const raw = rawFromForm(f.get('type') as string, f)
		const parsed = requestSchema.safeParse(raw)
		if (!parsed.success) {
			const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>
			return fail(422, {
				error: 'Please fix the highlighted fields.',
				fieldErrors,
				// Echo the submitted strings back so a non-enhanced rerender keeps them.
				values: raw as Record<string, string>
			})
		}

		try {
			await createRequest(myEmployee.id, user.organizationId, parsed.data, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
		return { message: 'Request submitted.' }
	},

	cancel: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		const myEmployee = await db.employee.findUnique({
			where: { userId: user.id },
			select: { id: true }
		})
		if (!myEmployee) return fail(400, { error: 'No employee profile found.' })

		const id = (await request.formData()).get('id') as string
		if (!id) return fail(400, { error: 'Missing request id.' })

		try {
			await cancelRequest(id, myEmployee.id, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
		return { message: 'Request cancelled.' }
	},

	resubmit: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		const myEmployee = await db.employee.findUnique({
			where: { userId: user.id },
			select: { id: true }
		})
		if (!myEmployee) return fail(400, { error: 'No employee profile found.' })

		const id = (await request.formData()).get('id') as string
		if (!id) return fail(400, { error: 'Missing request id.' })

		try {
			await resubmitRequest(id, myEmployee.id, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
		return { message: 'Request re-submitted.' }
	}
}
