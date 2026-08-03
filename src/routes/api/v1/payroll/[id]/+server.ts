import { json } from '@sveltejs/kit'
import { requireCapability, requirePayrollManage } from '$lib/server/rbac'
import { getRunWithEntries, approveRun, voidRun } from '$lib/server/services/payroll/runs'
import { apiError } from '$lib/server/api-error'
import { listVisiblePayEmployeeIds } from '$lib/server/services/employee-access'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')

	try {
		requirePayrollManage(locals.user.role)
	} catch {
		return apiError(403, 'Insufficient permissions')
	}

	// #249: same scoping as the run-detail page — a MANAGER sees their own team's entries, not the
	// whole organization's pay. Guarding only the page would leave this endpoint as the way around.
	const visibleEmployeeIds = await listVisiblePayEmployeeIds({
		id: locals.user.id,
		role: locals.user.role,
		roles: locals.user.roles,
		organizationId: locals.user.organizationId
	})
	const run = await getRunWithEntries(params.id, locals.user.organizationId, visibleEmployeeIds)
	return json({ data: run })
}

export const POST: RequestHandler = async ({ locals, params, url, request }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')

	const action = url.searchParams.get('action')
	const user = locals.user

	if (action === 'approve') {
		try {
			requirePayrollManage(user.role)
		} catch {
			return apiError(403, 'Insufficient permissions')
		}

		let body: { overrideNote?: string } = {}
		try {
			body = await request.json()
		} catch {
			// no body is fine
		}

		const run = await approveRun(params.id, user.organizationId, body.overrideNote, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role
		})
		return json({ data: run })
	}

	if (action === 'void') {
		try {
			requireCapability(user.role, 'OVERRIDE_FINALIZED')
		} catch {
			return apiError(403, 'Insufficient permissions')
		}

		const run = await voidRun(params.id, user.organizationId, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role
		})
		return json({ data: run })
	}

	return apiError(400, 'Invalid action. Use ?action=approve or ?action=void')
}
