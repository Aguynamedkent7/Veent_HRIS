import { error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { getRequest } from '$lib/server/services/requests'
import { APPROVER_ROLES } from '$lib/server/services/approvals'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.user!
	const req = await getRequest(params.id, user.organizationId)
	if (!req) error(404, 'Request not found')

	// Owner, or any approver (managers/HR/super-admin plus payroll officers) who can see
	// others' requests — the same set allowed in the approvals queue, so a reviewer can open
	// the detail of a request they're able to act on.
	const myEmployee = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true }
	})
	const isOwner = myEmployee?.id === req.employeeId
	const canReview = APPROVER_ROLES.includes(user.role)
	if (!isOwner && !canReview) error(403, 'Insufficient permissions')

	return { request: req, isOwner }
}
