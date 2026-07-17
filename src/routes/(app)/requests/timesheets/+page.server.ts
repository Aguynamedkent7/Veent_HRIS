import { fail, isHttpError, redirect } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { requireMinRole } from '$lib/server/rbac'
import { reviewTimesheet } from '$lib/server/services/timesheets'
import type { Actions, PageServerLoad, RequestEvent } from './$types'

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

	// MANAGER sees direct reports; admins see all — but never one's own timesheet
	// (separation of duties, #75).
	const pendingTimesheets = await db.timesheet.findMany({
		where: {
			status: 'SUBMITTED',
			...(myEmployee ? { employeeId: { not: myEmployee.id } } : {}),
			employee: {
				user: { organizationId: user.organizationId },
				...(!isAdmin ? { reportsToId: myEmployee!.id } : {})
			}
		},
		// Entries power the read-only review modal (mode="review").
		include: {
			employee: { select: { id: true, firstName: true, lastName: true } },
			entries: { orderBy: { date: 'asc' } }
		},
		orderBy: { submittedAt: 'asc' }
	})

	return { pendingTimesheets }
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

export const actions: Actions = {
	// Single approve/reject from the review modal (matches the modal's ?/review contract).
	review: async (event) => {
		const user = event.locals.user!
		requireMinRole(user.role, 'MANAGER')

		const data = await event.request.formData()
		const id = data.get('id') as string
		const approved = data.get('approved') === 'true'
		const rejectionReason = ((data.get('rejectionReason') as string) ?? '').trim()
		if (!id) return fail(400, { error: 'Missing timesheet id' })
		if (!approved && !rejectionReason)
			return fail(400, { error: 'A reason is required to reject.' })

		try {
			await reviewTimesheet(
				id,
				user.organizationId,
				approved,
				approved ? undefined : rejectionReason,
				ctxOf(event)
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
	},

	// Bulk approve each selected (submitted) timesheet; non-submitted ones are skipped.
	approveMany: async (event) => {
		const user = event.locals.user!
		requireMinRole(user.role, 'MANAGER')

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
				await reviewTimesheet(id, user.organizationId, true, undefined, ctx)
				done++
			} catch {
				skipped++
			}
		}
		return {
			saved: `Approved ${done} timesheet${done === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}.`
		}
	},

	// Bulk reject each selected (submitted) timesheet with one shared reason; non-submitted ones
	// throw and are counted as skipped rather than aborting the batch.
	rejectMany: async (event) => {
		const user = event.locals.user!
		requireMinRole(user.role, 'MANAGER')

		const data = await event.request.formData()
		const ids = String(data.get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
		const reason = ((data.get('rejectionReason') as string) ?? '').trim()
		if (!ids.length) return fail(400, { error: 'No timesheets selected' })
		if (reason === '') return fail(400, { error: 'A reason is required to reject.' })

		const ctx = ctxOf(event)
		let done = 0
		let skipped = 0
		for (const id of ids) {
			try {
				await reviewTimesheet(id, user.organizationId, false, reason, ctx)
				done++
			} catch {
				skipped++
			}
		}
		return {
			saved: `Rejected ${done} timesheet${done === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}.`
		}
	}
}
