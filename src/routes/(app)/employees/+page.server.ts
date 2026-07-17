import { requireMinRole } from '$lib/server/rbac'
import { paginate } from '$lib/server/pagination'
import { countEmployees, listEmployees, offboardEmployee } from '$lib/server/services/employees'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
	// The full roster is HR-only. Managers reach a report's 201 file via the Team
	// tab (which links straight to /employees/[id]) — they must not see everyone.
	requireMinRole(locals.user!.role, 'HR_ADMIN')

	const search = url.searchParams.get('search') ?? undefined
	const departmentId = url.searchParams.get('department') ?? undefined

	// #64: one count + one page query; the count is awaited (pagination meta needs
	// it) while the page of rows still streams so the skeleton renders immediately.
	const filters = { search, departmentId }
	const total = await countEmployees(locals.user!.organizationId, filters)
	const pagination = paginate(url, total)
	const employees = listEmployees(locals.user!.organizationId, filters, {
		skip: pagination.skip,
		take: pagination.take
	})

	return { employees, pagination }
}

export const actions: Actions = {
	// Onboarding lives on the dedicated /employees/new page (full form + Discord ID); this
	// list page only carries the offboard action for the table rows.
	offboard: async ({ request, locals, getClientAddress }) => {
		requireMinRole(locals.user!.role, 'HR_ADMIN')
		const user = locals.user!

		const data = await request.formData()
		const id = data.get('id') as string
		const endDate = new Date(data.get('endDate') as string)

		await offboardEmployee(id, user.organizationId, endDate, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	}
}
