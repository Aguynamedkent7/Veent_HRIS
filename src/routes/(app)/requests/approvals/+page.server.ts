import { fail, isHttpError, redirect } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { paginate } from '$lib/server/pagination'
import {
	decide,
	listPendingRequestsForApprover,
	APPROVER_ROLES
} from '$lib/server/services/approvals'
import type { ApprovalDecision } from '@prisma/client'
import type { Actions, PageServerLoad } from './$types'

// Request approvals (all request types) — any approver role, incl. Payroll Officer.
export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!
	if (!APPROVER_ROLES.includes(user.role)) redirect(303, '/requests')

	const myEmployee = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true }
	})

	const actionable = await listPendingRequestsForApprover(
		user.organizationId,
		user.role,
		myEmployee?.id ?? null
	)

	// #64: "at my stage" is decided in JS (canActOnStage), so this page paginates
	// the filtered set in memory — the fetch itself is already bounded to PENDING.
	const pagination = paginate(url, actionable.length)
	const pendingRequests = actionable.slice(pagination.skip, pagination.skip + pagination.take)

	return { pendingRequests, pagination }
}

export const actions: Actions = {
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
	},

	// Reject each selected request with one shared note. Requests the approver can't currently
	// decide (e.g. no longer at their stage) throw and are counted as skipped, not aborting the batch.
	rejectMany: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		if (!APPROVER_ROLES.includes(user.role)) return fail(403, { error: 'Insufficient permissions' })

		const data = await request.formData()
		const ids = String(data.get('ids') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
		const note = (data.get('note') as string) || ''
		if (!ids.length) return fail(400, { error: 'No requests selected' })
		if (note.trim() === '') return fail(400, { error: 'A note is required to reject requests.' })

		const myEmployee = await db.employee.findUnique({
			where: { userId: user.id },
			select: { id: true }
		})
		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		}

		let done = 0
		let skipped = 0
		for (const id of ids) {
			try {
				await decide(id, 'REJECTED', note, ctx, myEmployee?.id ?? null)
				done++
			} catch {
				skipped++
			}
		}
		return {
			saved: `Rejected ${done} request${done === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}.`
		}
	}
}
