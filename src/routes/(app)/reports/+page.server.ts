import { error } from '@sveltejs/kit'
import { ROLE_HIERARCHY, canViewPayrollReports } from '$lib/server/rbac'
import {
	getHeadcountByDepartment,
	getLeaveUtilizationReport,
	getPayrollSummaryReport,
	getAttritionReport
} from '$lib/server/services/reports'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
	const role = locals.user!.role
	// HR ladder (Manager+) sees all reports; Payroll Officer / Finance see payroll only.
	const canViewHrReports = ROLE_HIERARCHY[role] >= ROLE_HIERARCHY.MANAGER
	if (!canViewHrReports && !canViewPayrollReports(role)) error(403, 'Insufficient permissions')

	const year = parseInt(url.searchParams.get('year') ?? String(new Date().getFullYear()))
	const orgId = locals.user!.organizationId

	const [headcountByDept, leaveUtilization, payrollSummary, attrition] = await Promise.all([
		canViewHrReports ? getHeadcountByDepartment(orgId) : Promise.resolve([]),
		canViewHrReports ? getLeaveUtilizationReport(orgId, year) : Promise.resolve([]),
		getPayrollSummaryReport(orgId, year),
		canViewHrReports
			? getAttritionReport(orgId, year)
			: Promise.resolve({ hired: 0, offboarded: 0 })
	])

	return { headcountByDept, leaveUtilization, payrollSummary, attrition, year, canViewHrReports }
}
