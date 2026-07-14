import { json, error } from '@sveltejs/kit'
import { requireRole } from '$lib/server/rbac'
import { listReviewCycles, createReviewCycle } from '$lib/server/services/performance'
import { z } from 'zod'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized')
	requireRole(locals.user.role, 'HR_ADMIN', 'SUPER_ADMIN')
	return json({ results: await listReviewCycles(locals.user.organizationId) })
}

const schema = z.object({
	name: z.string().min(1),
	startDate: z.coerce.date(),
	endDate: z.coerce.date()
})

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) error(401, 'Unauthorized')
	const user = locals.user
	requireRole(user.role, 'HR_ADMIN', 'SUPER_ADMIN')
	const parsed = schema.safeParse(await request.json())
	if (!parsed.success) error(422, parsed.error.errors[0]?.message ?? 'Invalid cycle')
	const cycle = await createReviewCycle(user.organizationId, parsed.data, {
		organizationId: user.organizationId,
		actorId: user.id,
		actorRole: user.role,
		ipAddress: getClientAddress()
	})
	return json({ cycle }, { status: 201 })
}
