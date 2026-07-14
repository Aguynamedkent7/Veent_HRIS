import { fail, isHttpError } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { requireMinRole } from '$lib/server/rbac'
import {
	createRequest,
	listRequests,
	cancelRequest,
	resubmitRequest
} from '$lib/server/services/requests'
import { reviewTimesheet } from '$lib/server/services/timesheets'
import {
	decide,
	listPendingRequestsForApprover,
	APPROVER_ROLES
} from '$lib/server/services/approvals'
import { requestSchema } from '$lib/server/schemas/requests'
import type { ApprovalDecision } from '@prisma/client'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const myEmployee = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true }
	})

	const canApprove = APPROVER_ROLES.includes(user.role)
	const isAdmin = ['HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)

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

	// Approver inbox — only for roles that can act on a stage.
	const pendingRequests = canApprove
		? await listPendingRequestsForApprover(user.organizationId, user.role, myEmployee?.id ?? null)
		: []

	// SUBMITTED timesheets: MANAGER sees direct reports, admins see all.
	const pendingTimesheets = canApprove
		? await db.timesheet.findMany({
				where: {
					status: 'SUBMITTED',
					employee: {
						user: { organizationId: user.organizationId },
						...(!isAdmin && myEmployee ? { reportsToId: myEmployee.id } : {})
					}
				},
				include: { employee: { select: { id: true, firstName: true, lastName: true } } },
				orderBy: { submittedAt: 'asc' }
			})
		: []

	return {
		requests,
		leaveTypes,
		hasEmployee: Boolean(myEmployee),
		canApprove,
		pendingRequests,
		pendingTimesheets
	}
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
	// ─── Own requests (self-service) ─────────────────────────────────────────────
	create: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		const myEmployee = await db.employee.findUnique({
			where: { userId: user.id },
			select: { id: true }
		})
		if (!myEmployee) return fail(400, { error: 'No employee profile found.' })

		const f = await request.formData()
		const parsed = requestSchema.safeParse(rawFromForm(f.get('type') as string, f))
		if (!parsed.success) {
			return fail(422, { error: parsed.error.errors[0]?.message ?? 'Invalid input.' })
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
	},

	// ─── Approvals (act on others' items) ────────────────────────────────────────
	approveTimesheet: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'MANAGER')

		const data = await request.formData()
		const id = data.get('id') as string
		if (!id) return fail(400, { error: 'Missing timesheet id' })

		try {
			await reviewTimesheet(id, user.organizationId, true, undefined, {
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
	},

	rejectTimesheet: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'MANAGER')

		const data = await request.formData()
		const id = data.get('id') as string
		const rejectionReason = (data.get('rejectionReason') as string) || undefined
		if (!id) return fail(400, { error: 'Missing timesheet id' })

		try {
			await reviewTimesheet(id, user.organizationId, false, rejectionReason, {
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
	},

	decideRequest: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		if (!APPROVER_ROLES.includes(user.role)) return fail(403, { error: 'Insufficient permissions' })

		const data = await request.formData()
		const id = data.get('id') as string
		const decision = data.get('decision') as ApprovalDecision
		const note = (data.get('note') as string) || undefined
		if (!id || !['APPROVED', 'REJECTED', 'RETURNED'].includes(decision)) {
			return fail(400, { error: 'Missing request id or invalid decision' })
		}

		if (['REJECTED', 'RETURNED'].includes(decision) && (!note || note.trim() === '')) {
			return fail(400, { error: 'A note is required for rejected or returned requests.' })
		}

		const myEmployee = await db.employee.findUnique({
			where: { userId: user.id },
			select: { id: true }
		})

		try {
			await decide(
				id,
				decision,
				note,
				{
					organizationId: user.organizationId,
					actorId: user.id,
					actorRole: user.role,
					ipAddress: getClientAddress()
				},
				myEmployee?.id ?? null
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
	}
}
