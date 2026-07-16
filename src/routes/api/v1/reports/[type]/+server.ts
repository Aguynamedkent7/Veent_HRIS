import { json, error } from '@sveltejs/kit'
import { requireRole, requirePayrollReports } from '$lib/server/rbac'
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
	generateBIRWithholding,
	exportToCSV
} from '$lib/server/services/reports'
import { generateSeparationReport } from '$lib/server/services/separation'
import type { RequestHandler } from './$types'

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
	'bir-withholding',
	'separation'
] as const
// Payroll reports are also visible to Payroll Officer / Finance; the rest are HR-only.
const PAYROLL_REPORT_TYPES = [
	'payroll-costs',
	'payroll-register',
	'loan-summary',
	'government-remittance',
	'bir-withholding'
] as const

export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (!locals.user) error(401, 'Unauthorized')

	const user = locals.user

	const type = params.type
	if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
		error(404, 'Unknown report type')
	}

	if (PAYROLL_REPORT_TYPES.includes(type as (typeof PAYROLL_REPORT_TYPES)[number])) {
		requirePayrollReports(user.role)
	} else {
		requireRole(user.role, 'HR_ADMIN', 'SUPER_ADMIN')
	}

	const startDate = url.searchParams.get('start')
		? new Date(url.searchParams.get('start')!)
		: new Date(new Date().getFullYear(), 0, 1)
	const endDate = url.searchParams.get('end') ? new Date(url.searchParams.get('end')!) : new Date()
	const departmentId = url.searchParams.get('department') ?? undefined
	const exportCsv = url.searchParams.get('export') === 'csv'

	let results: Record<string, unknown>[] = []

	if (type === 'headcount') {
		results = await generateHeadcount(user.organizationId, { startDate, endDate, departmentId })
	} else if (type === 'attendance') {
		results = await generateAttendance(user.organizationId, { startDate, endDate, departmentId })
	} else if (type === 'payroll-costs') {
		results = await generatePayrollCosts(user.organizationId, { startDate, endDate })
	} else if (type === 'leave-utilization') {
		results = await generateLeaveUtilization(user.organizationId, { startDate, endDate })
	} else if (type === 'payroll-register') {
		results = await generatePayrollRegister(user.organizationId, { startDate, endDate })
	} else if (type === 'tardiness') {
		results = await generateTardiness(user.organizationId, { startDate, endDate, departmentId })
	} else if (type === 'overtime') {
		results = await generateOvertime(user.organizationId, { startDate, endDate, departmentId })
	} else if (type === 'loan-summary') {
		results = await generateLoanSummary(user.organizationId, { startDate, endDate })
	} else if (type === 'government-remittance') {
		results = await generateGovernmentRemittance(user.organizationId, { startDate, endDate })
	} else if (type === 'bir-withholding') {
		results = await generateBIRWithholding(user.organizationId, { startDate, endDate })
	} else if (type === 'separation') {
		results = await generateSeparationReport(user.organizationId, { startDate, endDate })
	}

	if (exportCsv) {
		const csv = exportToCSV(results)
		return new Response(csv, {
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="${type}.csv"`
			}
		})
	}

	return json({ results })
}
