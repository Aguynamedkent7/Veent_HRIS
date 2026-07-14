import { error } from '@sveltejs/kit'
import { requireRole } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import {
	generateHeadcount,
	generateAttendance,
	generatePayrollCosts,
	generateLeaveUtilization,
	generatePayrollRegister,
	generateTardiness,
	generateOvertime,
	generateLoanSummary,
	generateGovernmentRemittance,
	generateBIRWithholding
} from '$lib/server/services/reports'
import { canViewPayrollReports } from '$lib/server/rbac'
import type { PageServerLoad } from './$types'

const VALID_TYPES = [
	'headcount',
	'attendance',
	'payroll-costs',
	'leave-utilization',
	'payroll-register',
	'tardiness',
	'overtime',
	'loan-summary',
	'government-remittance',
	'bir-withholding'
] as const
// Payroll reports are visible to Payroll Officer / Finance; the rest are HR-only.
const PAYROLL_REPORT_TYPES = [
	'payroll-costs',
	'payroll-register',
	'loan-summary',
	'government-remittance',
	'bir-withholding'
]

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const user = locals.user!

	const type = params.type as string
	if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) error(404, 'Unknown report type')

	// Payroll reports open to Payroll Officer / Finance; everything else HR-only.
	if (PAYROLL_REPORT_TYPES.includes(type)) {
		if (!canViewPayrollReports(user.role)) error(403, 'Insufficient permissions')
	} else {
		requireRole(user.role, 'HR_ADMIN', 'SUPER_ADMIN')
	}

	// Parse filter params
	const startDate = url.searchParams.get('start')
		? new Date(url.searchParams.get('start')!)
		: new Date(new Date().getFullYear(), 0, 1)
	const endDate = url.searchParams.get('end') ? new Date(url.searchParams.get('end')!) : new Date()
	const departmentId = url.searchParams.get('department') ?? undefined

	// Load departments for the filter selector
	const departments = await db.department.findMany({
		where: { organizationId: user.organizationId },
		select: { id: true, name: true }
	})

	// Generate report
	let results: unknown[] = []
	let columns: string[] = []

	if (type === 'headcount') {
		results = await generateHeadcount(user.organizationId, { startDate, endDate, departmentId })
		columns = ['Period', 'Headcount', 'Department']
	} else if (type === 'attendance') {
		results = await generateAttendance(user.organizationId, { startDate, endDate, departmentId })
		columns = ['Employee', 'Period', 'TotalHours', 'Status']
	} else if (type === 'payroll-costs') {
		results = await generatePayrollCosts(user.organizationId, { startDate, endDate })
		columns = ['Period', 'Department', 'TotalGross', 'TotalNet', 'HeadCount']
	} else if (type === 'leave-utilization') {
		results = await generateLeaveUtilization(user.organizationId, { startDate, endDate })
		columns = ['LeaveType', 'TotalDaysUsed', 'EmployeeCount']
	} else if (type === 'payroll-register') {
		results = await generatePayrollRegister(user.organizationId, { startDate, endDate })
		columns = [
			'Employee',
			'Period',
			'Gross',
			'SSS',
			'PhilHealth',
			'PagIBIG',
			'Tax',
			'OtherDeductions',
			'Net'
		]
	} else if (type === 'tardiness') {
		results = await generateTardiness(user.organizationId, { startDate, endDate, departmentId })
		columns = ['Employee', 'LateDays', 'LateMinutes', 'UndertimeMinutes']
	} else if (type === 'overtime') {
		results = await generateOvertime(user.organizationId, { startDate, endDate, departmentId })
		columns = ['Employee', 'OvertimeHours', 'RawOvertimeHours', 'NightDiffHours']
	} else if (type === 'loan-summary') {
		results = await generateLoanSummary(user.organizationId, { startDate, endDate })
		columns = ['Employee', 'Principal', 'Balance', 'Installment', 'Status']
	} else if (type === 'government-remittance') {
		results = await generateGovernmentRemittance(user.organizationId, { startDate, endDate })
		columns = ['Contribution', 'EmployeeShare', 'EmployerShare', 'Total']
	} else if (type === 'bir-withholding') {
		results = await generateBIRWithholding(user.organizationId, { startDate, endDate })
		columns = ['Employee', 'TIN', 'Gross', 'TaxWithheld']
	}

	return {
		reportType: type,
		results,
		columns,
		departments,
		startDate: startDate.toISOString().slice(0, 10),
		endDate: endDate.toISOString().slice(0, 10),
		selectedDepartment: departmentId
	}
}
