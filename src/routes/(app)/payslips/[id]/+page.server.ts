import { error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { isPayslipVisible } from '$lib/server/services/payroll/runs'
import type { PageServerLoad } from './$types'

const PRIVILEGED = new Set(['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'FINANCE'])

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.user!

	const entry = await db.payrollEntry.findUnique({
		where: { id: params.id },
		include: {
			employee: {
				select: {
					firstName: true,
					lastName: true,
					employeeNumber: true,
					jobTitle: true,
					userId: true,
					organizationId: true,
					department: { select: { name: true } }
				}
			},
			payrollRun: {
				select: {
					periodStart: true,
					periodEnd: true,
					status: true,
					approvedAt: true,
					period: { select: { status: true } },
					organizationId: true
				}
			}
		}
	})

	if (!entry) error(404, 'Payslip not found')
	if (entry.payrollRun.organizationId !== user.organizationId) {
		error(404, 'Payslip not found')
	}

	// Employees + managers can only see their own; privileged roles can see any.
	if (!PRIVILEGED.has(user.role)) {
		const myEmployee = await db.employee.findFirst({ where: { userId: user.id } })
		if (!myEmployee || entry.employeeId !== myEmployee.id) {
			error(403, 'Access denied')
		}
		if (!isPayslipVisible(entry.payrollRun)) {
			error(403, 'Payslip not yet available')
		}
	}

	return {
		entry: {
			...entry,
			grossPay: Number(entry.grossPay),
			sssEe: Number(entry.sssEe),
			philhealthEe: Number(entry.philhealthEe),
			pagibigEe: Number(entry.pagibigEe),
			withholdingTax: Number(entry.withholdingTax),
			totalDeductions: Number(entry.totalDeductions),
			netPay: Number(entry.netPay)
		}
	}
}
