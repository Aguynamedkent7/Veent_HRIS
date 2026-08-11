import { json } from '@sveltejs/kit'
import { requireAnyCapability } from '$lib/server/rbac'
import { reviewLeaveRequest } from '$lib/server/services/leave'
import { apiError } from '$lib/server/api-error'
import type { RequestHandler } from './$types'

// PATCH: body = { action: 'approve' | 'reject' | 'override-approve', rejectionReason?: string, note?: string }
// requireAnyCapability VIEW_TEAM
// call reviewLeaveRequest
// return json(result)
export const PATCH: RequestHandler = async ({ params, request, locals, getClientAddress }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')

	const user = locals.user

	try {
		requireAnyCapability(user.roles, 'VIEW_TEAM')
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

	// #282: override-approve bypasses the approval chain outright, so it is org-wide HR authority —
	// not the VIEW_TEAM the rest of the route runs on. The old `requireAnyMinRole('HR_ADMIN')` here
	// admitted MANAGER (#133 ranks them level), which contradicted its own error message.
	if (action === 'override-approve') {
		try {
			requireAnyCapability(user.roles, 'ADMINISTER_HR_ORGWIDE')
		} catch {
			return apiError(403, 'override-approve requires org-wide HR (HR_ADMIN, CEO or SUPER_ADMIN)')
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
