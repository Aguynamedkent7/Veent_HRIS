import { requireMinRole } from '$lib/server/rbac'
import { getHeadcountByDepartment, getLeaveUtilizationReport, getPayrollSummaryReport, getAttritionReport } from '$lib/server/services/reports'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
	requireMinRole(locals.user!.role, 'MANAGER')

	const year = parseInt(url.searchParams.get('year') ?? String(new Date().getFullYear()))
	const orgId = locals.user!.organizationId

	const [headcountByDept, leaveUtilization, payrollSummary, attrition] = await Promise.all([
		getHeadcountByDepartment(orgId),
		getLeaveUtilizationReport(orgId, year),
		getPayrollSummaryReport(orgId, year),
		getAttritionReport(orgId, year)
	])

	return { headcountByDept, leaveUtilization, payrollSummary, attrition, year }
}
