import { fail, isHttpError } from '@sveltejs/kit'
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

export const actions: Actions = {
	override: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requirePayrollManage(user.role)

		const data = await request.formData()
		const entryId = data.get('entryId') as string
		const netPay = parseFloat(data.get('netPay') as string)
		const note = data.get('note') as string

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
