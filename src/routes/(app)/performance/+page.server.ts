import { fail, isHttpError } from '@sveltejs/kit'
import { canAny, requireAnyCapability } from '$lib/server/rbac'
import {
	listReviewsForEmployee,
	listReviewsForReviewer,
	redactHrAuthored,
	listReviewCycles,
	createReviewCycle,
	updateReviewCycleStatus,
	openReviewsForCycle
} from '$lib/server/services/performance'
import { db } from '$lib/server/db'
import { z } from 'zod'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const isAdmin = canAny(user.roles, 'MANAGE_HR')

	const cycles = isAdmin ? await listReviewCycles(user.organizationId) : []

	const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
	if (!myEmployee) {
		return {
			myReviews: [],
			reviewsToGive: [],
			isAdmin,
			cycles
		}
	}

	const [myReviews, reviewsToGive] = await Promise.all([
		listReviewsForEmployee(myEmployee.id),
		listReviewsForReviewer(myEmployee.id)
	])

	// #179: My Reviews are the viewer's own reviews as the subject — strip the HR-authored
	// comments and rating so the confidential review never reaches the reviewed employee.
	return {
		myReviews: myReviews.map(redactHrAuthored),
		reviewsToGive,
		isAdmin,
		cycles
	}
}

function ctxOf(locals: App.Locals, ip: string) {
	return {
		organizationId: locals.user!.organizationId,
		actorId: locals.user!.id,
		actorRoles: locals.user!.roles,
		ipAddress: ip
	}
}

export const actions: Actions = {
	createCycle: async ({ request, locals, getClientAddress }) => {
		requireAnyCapability(locals.user!.roles, 'MANAGE_HR')
		const parsed = z
			.object({ name: z.string().min(1), startDate: z.coerce.date(), endDate: z.coerce.date() })
			.safeParse(Object.fromEntries(await request.formData()))
		if (!parsed.success) return fail(422, { error: 'Invalid cycle details' })
		try {
			await createReviewCycle(
				locals.user!.organizationId,
				parsed.data,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { cycleCreated: true }
	},

	setCycleStatus: async ({ request, locals, getClientAddress }) => {
		requireAnyCapability(locals.user!.roles, 'MANAGE_HR')
		const data = await request.formData()
		const id = data.get('id') as string
		const status = data.get('status') as 'DRAFT' | 'ACTIVE' | 'CLOSED'
		if (!id || !['DRAFT', 'ACTIVE', 'CLOSED'].includes(status))
			return fail(400, { error: 'Invalid status' })
		try {
			await updateReviewCycleStatus(
				id,
				locals.user!.organizationId,
				status,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { cycleUpdated: true }
	},

	openReviews: async ({ request, locals, getClientAddress }) => {
		requireAnyCapability(locals.user!.roles, 'MANAGE_HR')
		const id = (await request.formData()).get('id') as string
		if (!id) return fail(400, { error: 'Missing cycle id' })
		try {
			const res = await openReviewsForCycle(
				id,
				locals.user!.organizationId,
				ctxOf(locals, getClientAddress())
			)
			return { opened: res.opened }
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
	}
}
