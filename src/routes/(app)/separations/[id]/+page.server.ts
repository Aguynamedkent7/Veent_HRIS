import { fail, isHttpError } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import {
	getSeparation,
	computeFinalPay,
	setClearanceItem,
	finalizeSeparation
} from '$lib/server/services/separation'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.user!
	requireMinRole(user.role, 'HR_ADMIN')

	const separation = await getSeparation(params.id, user.organizationId)
	// Live preview of what final pay would be if finalized now.
	const finalPay = await computeFinalPay(params.id, user.organizationId)

	return { separation, finalPay }
}

export const actions: Actions = {
	toggleClearance: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'HR_ADMIN')

		const data = await request.formData()
		const itemId = data.get('itemId') as string
		const cleared = data.get('cleared') === 'true'
		if (!itemId) return fail(400, { error: 'Missing clearance item.' })

		try {
			await setClearanceItem(itemId, user.organizationId, cleared, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
		return { ok: true }
	},

	finalize: async ({ locals, params, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'HR_ADMIN')

		try {
			await finalizeSeparation(params.id, user.organizationId, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
		return { finalized: true }
	}
}
