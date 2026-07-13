import { error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { getRequest } from '$lib/server/services/requests'
import { ROLE_HIERARCHY } from '$lib/server/rbac'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.user!
	const req = await getRequest(params.id, user.organizationId)
	if (!req) error(404, 'Request not found')

	// Owner, or a manager/HR who can see others' requests.
	const myEmployee = await db.employee.findUnique({ where: { userId: user.id }, select: { id: true } })
	const isOwner = myEmployee?.id === req.employeeId
	const canReview = ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY.MANAGER
	if (!isOwner && !canReview) error(403, 'Insufficient permissions')

	return { request: req, isOwner }
}
