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

	// LEAVE requests store their leaveTypeId in the JSON payload (no relation); resolve it to a
	// name for the details panel.
	let leaveTypeName: string | null = null
	if (req.type === 'LEAVE') {
		const leaveTypeId = ((req.payload ?? {}) as Record<string, unknown>).leaveTypeId
		if (typeof leaveTypeId === 'string') {
			const lt = await db.leaveType.findFirst({
				where: { id: leaveTypeId, organizationId: user.organizationId },
				select: { name: true }
			})
			leaveTypeName = lt?.name ?? null
		}
	}

	return { request: req, isOwner, leaveTypeName }
}
