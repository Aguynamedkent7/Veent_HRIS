import { error } from '@sveltejs/kit'
import { requireRole } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import {
	generateHeadcount,
	generateAttendance,
	generatePayrollCosts,
	generateLeaveUtilization,
	generatePayrollRegister
} from '$lib/server/services/reports'
import type { PageServerLoad } from './$types'

const VALID_TYPES = ['headcount', 'attendance', 'payroll-costs', 'leave-utilization', 'payroll-register'] as const

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const user = locals.user!
	requireRole(user.role, 'HR_ADMIN', 'SUPER_ADMIN')

	const type = params.type as string
	if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) error(404, 'Unknown report type')

	// Parse filter params
	const startDate = url.searchParams.get('start')
		? new Date(url.searchParams.get('start')!)
		: new Date(new Date().getFullYear(), 0, 1)
	const endDate = url.searchParams.get('end')
		? new Date(url.searchParams.get('end')!)
		: new Date()
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
		columns = ['Employee', 'Period', 'Gross', 'SSS', 'PhilHealth', 'PagIBIG', 'Tax', 'OtherDeductions', 'Net']
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
