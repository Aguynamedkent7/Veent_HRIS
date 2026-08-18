import { fail, isHttpError } from '@sveltejs/kit'
import { requireAnyCapability } from '$lib/server/rbac'
import {
	getSeparation,
	computeFinalPay,
	setClearanceItem,
	finalizeSeparation,
	finalizeBarFor,
	type FinalPayResult
} from '$lib/server/services/separation'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.user!
	requireAnyCapability(user.roles, 'MANAGE_HR')

	const separation = await getSeparation(params.id, user.organizationId)
	// Finalized cases show the snapshot persisted at finalization; open cases get a
	// live preview of what final pay would be if finalized now.
	const finalPay =
		separation.status === 'FINALIZED' && separation.finalPayBreakdown
			? (separation.finalPayBreakdown as unknown as FinalPayResult)
			: await computeFinalPay(params.id, user.organizationId)

	// Cosmetic affordance only — finalizeSeparation is the enforcement (house rule: a UI check is
	// never enforcement). Same helper, so the button and the guard cannot drift.
	const finalizeBar =
		separation.status === 'FINALIZED' ? null : await finalizeBarFor(separation, user.id)

	return { separation, finalPay, finalizeBar }
}

export const actions: Actions = {
	toggleClearance: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireAnyCapability(user.roles, 'MANAGE_HR')

		const data = await request.formData()
		const itemId = data.get('itemId') as string
		const cleared = data.get('cleared') === 'true'
		if (!itemId) return fail(400, { error: 'Missing clearance item.' })

		try {
			await setClearanceItem(itemId, user.organizationId, cleared, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRoles: user.roles,
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
		requireAnyCapability(user.roles, 'MANAGE_HR')

		try {
			await finalizeSeparation(params.id, user.organizationId, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRoles: user.roles,
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
