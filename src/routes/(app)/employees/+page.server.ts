import { requireMinRole } from '$lib/server/rbac'
import { paginate } from '$lib/server/pagination'
import { countEmployees, listEmployees, offboardEmployee } from '$lib/server/services/employees'
import { listAssignableBranches } from '$lib/server/services/branches'
import { isFoodServiceOrg } from '$lib/orgs'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
	// The full roster is HR-only. Managers reach a report's 201 file via the Team
	// tab (which links straight to /employees/[id]) — they must not see everyone.
	requireMinRole(locals.user!.role, 'HR_ADMIN')

	const organizationId = locals.user!.organizationId
	const search = url.searchParams.get('search') ?? undefined
	const departmentId = url.searchParams.get('department') ?? undefined
	// Branches only exist for the food-service tenants — ignore the param elsewhere so a
	// hand-typed ?branch= can't filter a roster that has no such dimension.
	const showBranches = isFoodServiceOrg(organizationId)
	const branchId = showBranches ? (url.searchParams.get('branch') ?? undefined) : undefined

	// #64: one count + one page query; the count is awaited (pagination meta needs
	// it) while the page of rows still streams so the skeleton renders immediately.
	const filters = { search, departmentId, branchId }
	const total = await countEmployees(organizationId, filters)
	const pagination = paginate(url, total)
	const employees = listEmployees(organizationId, filters, {
		skip: pagination.skip,
		take: pagination.take
	})
	const branches = showBranches ? await listAssignableBranches(organizationId) : []

	return { employees, pagination, branches, showBranches, branchFilter: branchId ?? '' }
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
