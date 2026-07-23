import { requireMinRole } from '$lib/server/rbac'
import { failFromError } from '$lib/server/form-fail'
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

	// Offboarded staff are kept, not deleted (#184), so the roster splits into two tabs:
	// the active workforce (default) and a dedicated Offboarded section. Both counts feed
	// the tab labels; only the selected tab's page of rows is queried.
	const tab = url.searchParams.get('status') === 'offboarded' ? 'offboarded' : 'active'
	const baseFilters = { search, departmentId, branchId }

	// #64: counts are awaited (pagination meta + tab labels need them) while the page of
	// rows still streams so the skeleton renders immediately.
	const [activeCount, offboardedCount] = await Promise.all([
		countEmployees(organizationId, { ...baseFilters, offboarded: false }),
		countEmployees(organizationId, { ...baseFilters, offboarded: true })
	])
	const total = tab === 'offboarded' ? offboardedCount : activeCount
	const pagination = paginate(url, total)
	const employees = listEmployees(
		organizationId,
		{ ...baseFilters, offboarded: tab === 'offboarded' },
		{ skip: pagination.skip, take: pagination.take }
	)
	const branches = showBranches ? await listAssignableBranches(organizationId) : []

	return {
		employees,
		pagination,
		branches,
		showBranches,
		branchFilter: branchId ?? '',
		tab,
		activeCount,
		offboardedCount
	}
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

		try {
			await offboardEmployee(id, user.organizationId, endDate, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e) {
			return failFromError(e)
		}
	}
}
