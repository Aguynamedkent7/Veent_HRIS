import { fail } from '@sveltejs/kit'
import { ROLE_HIERARCHY } from '$lib/server/rbac'
import {
	listGoalsForEmployee,
	listReviewsForEmployee,
	listReviewsForReviewer,
	createGoal,
	updateGoalProgress
} from '$lib/server/services/performance'
import { db } from '$lib/server/db'
import { z } from 'zod'
import type { Actions, PageServerLoad } from './$types'

const GOAL_STATUS = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const isManager = ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY.MANAGER

	const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
	if (!myEmployee) {
		return { myGoals: [], myReviews: [], reviewsToGive: [], isManager: false }
	}

	const [myGoals, myReviews, reviewsToGive] = await Promise.all([
		listGoalsForEmployee(myEmployee.id),
		listReviewsForEmployee(myEmployee.id),
		listReviewsForReviewer(myEmployee.id)
	])

	return { myGoals, myReviews, reviewsToGive, isManager }
}

const createGoalSchema = z.object({
	title: z.string().min(1),
	description: z.string().optional(),
	category: z.string().optional(),
	targetDate: z.coerce.date().optional()
})

const updateGoalSchema = z.object({
	id: z.string().min(1),
	progress: z.coerce.number().min(0).max(100),
	status: z.enum(GOAL_STATUS)
})

export const actions: Actions = {
	createGoal: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
		if (!myEmployee) return fail(400, { error: 'No employee profile found' })

		const raw = Object.fromEntries(await request.formData())
		const parsed = createGoalSchema.safeParse(raw)
		if (!parsed.success) return fail(400, { error: 'Invalid input' })

		try {
			await createGoal(myEmployee.id, parsed.data, {
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

	updateGoal: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
		if (!myEmployee) return fail(400, { error: 'No employee profile found' })

		const raw = Object.fromEntries(await request.formData())
		const parsed = updateGoalSchema.safeParse(raw)
		if (!parsed.success) return fail(400, { error: 'Invalid input' })

		try {
			await updateGoalProgress(
				parsed.data.id,
				myEmployee.id,
				{ progress: parsed.data.progress, status: parsed.data.status },
				{
					organizationId: user.organizationId,
					actorId: user.id,
					actorRole: user.role,
					ipAddress: getClientAddress()
				}
			)
		} catch (e: unknown) {
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
	}
}
