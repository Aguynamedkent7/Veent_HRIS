import { requireMinRole } from '$lib/server/rbac'
import { getPayrollRun, overridePayrollEntry } from '$lib/server/services/payroll/index'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
	requireMinRole(locals.user!.role, 'HR_ADMIN')
	const run = await getPayrollRun(params.id, locals.user!.organizationId)
	return { run }
}

export const actions: Actions = {
	override: async ({ request, locals, params, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'HR_ADMIN')

		const data = await request.formData()
		const entryId = data.get('entryId') as string
		const netPay = parseFloat(data.get('netPay') as string)
		const note = data.get('note') as string

		await overridePayrollEntry(
			entryId,
			user.organizationId,
			{ netPay },
			note,
			{ organizationId: user.organizationId, actorId: user.id, actorRole: user.role, ipAddress: getClientAddress() }
		)
	}
}
