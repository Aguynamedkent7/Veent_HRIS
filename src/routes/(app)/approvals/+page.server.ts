import { fail } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import { reviewTimesheet } from '$lib/server/services/timesheets'
import { reviewLeaveRequest } from '$lib/server/services/leave'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	requireMinRole(user.role, 'MANAGER')

	const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
	const isAdmin = ['HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)

	// pendingTimesheets: SUBMITTED timesheets
	//   For MANAGER: only direct reports (reportsToId = myEmployee.id)
	//   For HR_ADMIN/SUPER_ADMIN: all in org
	const pendingTimesheets = await db.timesheet.findMany({
		where: {
			status: 'SUBMITTED',
			employee: {
				user: { organizationId: user.organizationId },
				...(!isAdmin && myEmployee ? { reportsToId: myEmployee.id } : {})
			}
		},
		include: {
			employee: { select: { id: true, firstName: true, lastName: true } }
		},
		orderBy: { submittedAt: 'asc' }
	})

	// pendingLeave: PENDING leave requests (same scoping)
	const pendingLeave = await db.leaveRequest.findMany({
		where: {
			status: 'PENDING',
			employee: {
				user: { organizationId: user.organizationId },
				...(!isAdmin && myEmployee ? { reportsToId: myEmployee.id } : {})
			}
		},
		include: {
			employee: { select: { id: true, firstName: true, lastName: true } },
			leaveType: { select: { name: true } }
		},
		orderBy: { createdAt: 'asc' }
	})

	return { pendingTimesheets, pendingLeave }
}

export const actions: Actions = {
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
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
	},

	approveLeave: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'MANAGER')

		const data = await request.formData()
		const id = data.get('id') as string
		if (!id) return fail(400, { error: 'Missing leave request id' })

		try {
			await reviewLeaveRequest(id, user.organizationId, true, undefined, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
	},

	rejectLeave: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'MANAGER')

		const data = await request.formData()
		const id = data.get('id') as string
		const rejectionReason = (data.get('rejectionReason') as string) || undefined
		if (!id) return fail(400, { error: 'Missing leave request id' })

		try {
			await reviewLeaveRequest(id, user.organizationId, false, rejectionReason, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
	}
}
