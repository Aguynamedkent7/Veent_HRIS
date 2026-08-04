import { json } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import { reviewLeaveRequest } from '$lib/server/services/leave'
import { apiError } from '$lib/server/api-error'
import type { RequestHandler } from './$types'

// PATCH: body = { action: 'approve' | 'reject' | 'override-approve', rejectionReason?: string, note?: string }
// requireMinRole MANAGER
// call reviewLeaveRequest
// return json(result)
export const PATCH: RequestHandler = async ({ params, request, locals, getClientAddress }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')

	const user = locals.user

	try {
		requireMinRole(user.role, 'MANAGER')
	} catch {
		return apiError(403, 'Insufficient permissions')
	}

	let body: { action?: string; rejectionReason?: string; note?: string }
	try {
		body = await request.json()
	} catch {
		return apiError(400, 'Invalid JSON body')
	}

	const { action, rejectionReason } = body

	if (action !== 'approve' && action !== 'reject' && action !== 'override-approve') {
		return apiError(400, 'action must be "approve", "reject", or "override-approve"')
	}

	// override-approve requires HR_ADMIN or higher
	if (action === 'override-approve') {
		try {
			requireMinRole(user.role, 'HR_ADMIN')
		} catch {
			return apiError(403, 'override-approve requires HR_ADMIN or higher')
		}
	}

	const approved = action === 'approve' || action === 'override-approve'

	if (!approved && !rejectionReason) {
		return apiError(400, 'rejectionReason is required when rejecting')
	}

	try {
		const result = await reviewLeaveRequest(
			params.id,
			user.organizationId,
			approved,
			rejectionReason,
			{
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				// #247: reaches `rolesOf` indirectly — `reviewLeaveRequest` delegates to `decide`,
				// which resolves stage authority from the full set. Its page twin
				// (`(app)/requests/approvals/+page.server.ts:124,160`) already passed this.
				actorRoles: user.roles,
				ipAddress: getClientAddress()
			}
		)
		return json(result)
	} catch (e: unknown) {
		if (e instanceof Error) {
			const status = (e as { status?: number }).status
			if (status === 404) return apiError(404, e.message)
			if (status === 400) return apiError(400, e.message)
		}
		throw e
	}
}
