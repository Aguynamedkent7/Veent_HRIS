import { error, fail, isHttpError } from '@sveltejs/kit'
import { z } from 'zod'
import { db } from '$lib/server/db'
import { canAny } from '$lib/rbac'
import {
	getComplaint,
	postComplaintMessage,
	resolveComplaint
} from '$lib/server/services/complaints'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.user!
	const isHr = canAny(user.roles, 'MANAGE_HR')

	const complaint = await getComplaint(params.id, user.organizationId)

	const myEmployee = await db.employee.findFirst({
		where: { userId: user.id, organizationId: user.organizationId },
		select: { id: true }
	})
	const isSubject = myEmployee?.id === complaint.employeeId
	if (!isHr && !isSubject) error(403, 'You do not have access to this inquiry.')

	return { complaint, isHr, isSubject }
}

const replySchema = z.object({ body: z.string().trim().min(1) })

export const actions: Actions = {
	reply: async ({ request, locals, getClientAddress, params }) => {
		const user = locals.user!
		const isHr = canAny(user.roles, 'MANAGE_HR')

		const myEmployee = await db.employee.findFirst({
			where: { userId: user.id, organizationId: user.organizationId },
			select: { id: true }
		})
		const complaint = await getComplaint(params.id, user.organizationId).catch(() => null)
		if (!complaint) return fail(404, { error: 'Inquiry not found.' })

		const isSubject = myEmployee?.id === complaint.employeeId
		if (!isHr && !isSubject) return fail(403, { error: 'Insufficient permissions.' })

		const parsed = replySchema.safeParse({ body: (await request.formData()).get('body') })
		if (!parsed.success) return fail(422, { error: 'Message cannot be empty.' })

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRoles: user.roles,
			ipAddress: getClientAddress()
		}
		try {
			await postComplaintMessage(params.id, parsed.data.body, ctx, myEmployee?.id ?? null)
		} catch (e) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { message: 'Reply sent.' }
	},

	resolve: async ({ locals, getClientAddress, params }) => {
		const user = locals.user!
		if (!canAny(user.roles, 'MANAGE_HR')) return fail(403, { error: 'Insufficient permissions.' })

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRoles: user.roles,
			ipAddress: getClientAddress()
		}
		try {
			await resolveComplaint(params.id, ctx)
		} catch (e) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { message: 'Inquiry resolved.' }
	}
}
