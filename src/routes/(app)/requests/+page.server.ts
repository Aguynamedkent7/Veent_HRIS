import { fail, isHttpError } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { paginate } from '$lib/server/pagination'
import {
	createRequest,
	countRequests,
	listRequests,
	cancelRequest,
	resubmitRequest,
	deleteRequest
} from '$lib/server/services/requests'
import { uploadsFromForm, saveRequestDocuments } from '$lib/server/services/requests/documents'
import { requestSchema } from '$lib/server/schemas/requests'
import type { Actions, PageServerLoad } from './$types'

// Self-service: the current user's own requests. Approvals live under
// /requests/timesheets and /requests/approvals.
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!
	const myEmployee = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true }
	})

	// #64: one count + one page query.
	const listParams = myEmployee
		? { organizationId: user.organizationId, employeeId: myEmployee.id }
		: null
	const total = listParams ? await countRequests(listParams) : 0
	const pagination = paginate(url, total)

	const [requests, leaveTypes] = await Promise.all([
		listParams
			? listRequests(listParams, { skip: pagination.skip, take: pagination.take })
			: Promise.resolve([]),
		db.leaveType.findMany({
			where: { organizationId: user.organizationId, isActive: true },
			orderBy: { name: 'asc' },
			select: { id: true, name: true }
		})
	])

	return { requests, leaveTypes, hasEmployee: Boolean(myEmployee), pagination }
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

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		}
		try {
			// uploadsFromForm validates count/size/type up front, so a bad file fails
			// here — before the request row is created.
			const uploads = await uploadsFromForm(f)
			const created = await createRequest(myEmployee.id, user.organizationId, parsed.data, ctx)
			try {
				await saveRequestDocuments(created.id, myEmployee.id, user.organizationId, uploads, ctx)
			} catch (e) {
				// Documents failed to persist — remove the just-created request so no
				// orphan is left behind; the original error is what the user sees.
				await deleteRequest(created.id, user.organizationId, ctx).catch(() => {})
				throw e
			}
		} catch (e: unknown) {
			if (isHttpError(e))
				return fail(e.status, {
					error: String(e.body.message),
					values: raw as Record<string, string>
				})
			if (e instanceof Error)
				return fail(400, { error: e.message, values: raw as Record<string, string> })
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
