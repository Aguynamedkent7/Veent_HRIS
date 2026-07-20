import { json } from '@sveltejs/kit'
import { requireCapability, requirePayrollManage } from '$lib/server/rbac'
import { getRunWithEntries, approveRun, voidRun } from '$lib/server/services/payroll/runs'
import { apiError } from '$lib/server/api-error'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')

	try {
		requirePayrollManage(locals.user.role)
	} catch {
		return apiError(403, 'Insufficient permissions')
	}

	const run = await getRunWithEntries(params.id, locals.user.organizationId)
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
			requireCapability(user.role, 'ADMINISTER_SYSTEM')
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
