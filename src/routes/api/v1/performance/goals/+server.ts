import { json, error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { listGoalsForEmployee, createGoal } from '$lib/server/services/performance'
import { z } from 'zod'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized')
	const me = await db.employee.findUnique({ where: { userId: locals.user.id }, select: { id: true } })
	return json({ results: me ? await listGoalsForEmployee(me.id) : [] })
}

const schema = z.object({
	title: z.string().min(1),
	description: z.string().optional(),
	category: z.string().optional(),
	targetDate: z.coerce.date().optional()
})

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) error(401, 'Unauthorized')
	const me = await db.employee.findUnique({ where: { userId: locals.user.id }, select: { id: true } })
	if (!me) error(400, 'No employee profile')
	const parsed = schema.safeParse(await request.json())
	if (!parsed.success) error(422, parsed.error.errors[0]?.message ?? 'Invalid goal')
	const goal = await createGoal(me.id, parsed.data, {
		organizationId: locals.user.organizationId, actorId: locals.user.id, actorRole: locals.user.role, ipAddress: getClientAddress()
	})
	return json({ goal }, { status: 201 })
}
