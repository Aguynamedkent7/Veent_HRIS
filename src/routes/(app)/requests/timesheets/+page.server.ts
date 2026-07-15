import { fail, isHttpError, redirect } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { requireMinRole } from '$lib/server/rbac'
import { reviewTimesheet } from '$lib/server/services/timesheets'
import type { Actions, PageServerLoad } from './$types'

// Timesheet approvals — MANAGER+ only (Payroll Officer/Finance don't approve timesheets).
export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const isManagerLadder = ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)
	if (!isManagerLadder) redirect(303, '/requests')

	const isAdmin = ['HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)
	const myEmployee = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true }
	})

	// A non-admin manager scopes to their direct reports; without an employee record there
	// is nothing to scope by, so show nothing rather than falling through to org-wide.
	if (!isAdmin && !myEmployee) return { pendingTimesheets: [] }

	// MANAGER sees direct reports; admins see all.
	const pendingTimesheets = await db.timesheet.findMany({
		where: {
			status: 'SUBMITTED',
			employee: {
				user: { organizationId: user.organizationId },
				...(!isAdmin ? { reportsToId: myEmployee!.id } : {})
			}
		},
		include: { employee: { select: { id: true, firstName: true, lastName: true } } },
		orderBy: { submittedAt: 'asc' }
	})

	return { pendingTimesheets }
}

export const actions: Actions = {
	approveTimesheet: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'MANAGER')

		const id = (await request.formData()).get('id') as string
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
		const rejectionReason = ((data.get('rejectionReason') as string) ?? '').trim()
		if (!id) return fail(400, { error: 'Missing timesheet id' })
		if (!rejectionReason) return fail(400, { error: 'A reason is required to reject.' })

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
	}
}
