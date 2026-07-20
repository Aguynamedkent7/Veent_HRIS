import { fail, isHttpError } from '@sveltejs/kit'
import { z } from 'zod'
import { requirePayrollManage } from '$lib/server/rbac'
import {
	getPayrollRun,
	overridePayrollEntry,
	computePayroll
} from '$lib/server/services/payroll/index'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
	requirePayrollManage(locals.user!.role)
	const run = await getPayrollRun(params.id, locals.user!.organizationId)
	return { run }
}

// `finite()` matters as much as `min(0)`: z.coerce.number() turns "" into 0 and
// "abc" into NaN, and NaN would otherwise satisfy a bare number() check.
const overrideSchema = z.object({
	entryId: z.string().min(1),
	netPay: z.coerce.number().finite().min(0),
	note: z.string().trim().min(1)
})

export const actions: Actions = {
	override: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requirePayrollManage(user.role)

		const data = await request.formData()

		// parseFloat with no guard let NaN and negative amounts through to a Decimal
		// column — NaN blew up at the driver, a negative net pay was written silently.
		const parsed = overrideSchema.safeParse({
			entryId: data.get('entryId'),
			netPay: data.get('netPay'),
			note: data.get('note')
		})
		if (!parsed.success) {
			return fail(422, { error: 'Enter a valid, non-negative net pay and a reason.' })
		}
		const { entryId, netPay, note } = parsed.data

		await overridePayrollEntry(entryId, user.organizationId, { netPay }, note, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	},

	// Recompute this run in place (e.g. after assigning recurring earnings or
	// deductions) — allowed until the run is approved.
	compute: async ({ params, locals, getClientAddress }) => {
		const user = locals.user!
		requirePayrollManage(user.role)

		try {
			await computePayroll(params.id, user.organizationId, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
	}
}
