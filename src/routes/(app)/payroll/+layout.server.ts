import { requirePayrollManage } from '$lib/server/rbac'
import { loadCalculatorData } from '$lib/server/services/payroll/calculator'
import type { LayoutServerLoad } from './$types'

// Every payroll page gets the calculator roster + recurring prefills so the
// floating calculator panel (#72) works side-by-side with runs and periods.
// All payroll pages already require payroll-manage; the gate here also covers
// the roster this load returns.
export const load: LayoutServerLoad = async ({ locals }) => {
	requirePayrollManage(locals.user!.role)
	return await loadCalculatorData(locals.user!.organizationId)
}
