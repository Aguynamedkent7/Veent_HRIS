import { fail, isHttpError } from '@sveltejs/kit'
import { can, ROLE_HIERARCHY, requireAnyCapability } from '$lib/server/rbac'
import {
	listGoalsForEmployee,
	listReviewsForEmployee,
	listReviewsForReviewer,
	redactHrAuthored,
	createGoal,
	updateGoalProgress,
	listReviewCycles,
	createReviewCycle,
	updateReviewCycleStatus,
	openReviewsForCycle,
	listGoalsForManager
} from '$lib/server/services/performance'
import { db } from '$lib/server/db'
import { z } from 'zod'
import type { Actions, PageServerLoad } from './$types'

const GOAL_STATUS = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const isManager = ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY.MANAGER
	const isAdmin = can(user.role, 'MANAGE_HR')

	const cycles = isAdmin ? await listReviewCycles(user.organizationId) : []

	const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
	if (!myEmployee) {
		return {
			myGoals: [],
			myReviews: [],
			reviewsToGive: [],
			teamGoals: [],
			isManager,
			isAdmin,
			cycles
		}
	}

	const [myGoals, myReviews, reviewsToGive, teamGoals] = await Promise.all([
		listGoalsForEmployee(myEmployee.id),
		listReviewsForEmployee(myEmployee.id),
		listReviewsForReviewer(myEmployee.id),
		isManager ? listGoalsForManager(myEmployee.id) : Promise.resolve([])
	])

	// #179: My Reviews are the viewer's own reviews as the subject — strip the HR-authored
	// comments and rating so the confidential review never reaches the reviewed employee.
	return {
		myGoals,
		myReviews: myReviews.map(redactHrAuthored),
		reviewsToGive,
		teamGoals,
		isManager,
		isAdmin,
		cycles
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
	},

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
