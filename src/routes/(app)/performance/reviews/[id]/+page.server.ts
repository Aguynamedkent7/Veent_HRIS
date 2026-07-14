import { fail, isHttpError } from '@sveltejs/kit'
import { z } from 'zod'
import { db } from '$lib/server/db'
import {
	getReview,
	saveSelfAssessment,
	submitManagerReview,
	acknowledgeReview
} from '$lib/server/services/performance'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.user!
	const review = await getReview(params.id, user.organizationId)
	const me = await db.employee.findUnique({ where: { userId: user.id }, select: { id: true } })

	return {
		review,
		isSubject: me?.id === review.employee.id,
		isReviewer: me?.id === review.reviewer.id
	}
}

function ctxOf(locals: App.Locals, ip: string) {
	return {
		organizationId: locals.user!.organizationId,
		actorId: locals.user!.id,
		actorRole: locals.user!.role,
		ipAddress: ip
	}
}
async function myEmployeeId(userId: string) {
	return (await db.employee.findUnique({ where: { userId }, select: { id: true } }))?.id ?? ''
}
async function run(fn: () => Promise<unknown>) {
	try {
		await fn()
		return { success: true }
	} catch (e: unknown) {
		if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
		throw e
	}
}

export const actions: Actions = {
	saveSelf: async ({ request, locals, params, getClientAddress }) => {
		const text = (await request.formData()).get('selfAssessment') as string
		if (!text?.trim()) return fail(422, { error: 'Self-assessment cannot be empty' })
		const employeeId = await myEmployeeId(locals.user!.id)
		return run(() =>
			saveSelfAssessment(params.id, employeeId, text, ctxOf(locals, getClientAddress()))
		)
	},

	submitReview: async ({ request, locals, params, getClientAddress }) => {
		const data = await request.formData()
		const parsed = z
			.object({
				managerComments: z.string().optional(),
				overallRating: z.coerce.number().int().min(1).max(5).optional()
			})
			.safeParse(Object.fromEntries(data))
		if (!parsed.success) return fail(422, { error: 'Invalid review' })
		const reviewerId = await myEmployeeId(locals.user!.id)
		return run(() =>
			submitManagerReview(params.id, reviewerId, parsed.data, ctxOf(locals, getClientAddress()))
		)
	},

	acknowledge: async ({ locals, params, getClientAddress }) => {
		const employeeId = await myEmployeeId(locals.user!.id)
		return run(() => acknowledgeReview(params.id, employeeId, ctxOf(locals, getClientAddress())))
	}
}
