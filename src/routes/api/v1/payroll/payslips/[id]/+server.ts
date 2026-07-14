import { json } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { apiError } from '$lib/server/api-error'
import { isPayslipVisible } from '$lib/server/services/payroll/runs'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')

	const user = locals.user

	const entry = await db.payrollEntry.findUnique({
		where: { id: params.id },
		include: {
			employee: {
				select: {
					firstName: true,
					lastName: true,
					employeeNumber: true,
					jobTitle: true,
					department: { select: { name: true } },
					userId: true
				}
			},
			payrollRun: {
				select: {
					periodStart: true,
					periodEnd: true,
					status: true,
					approvedAt: true,
					period: { select: { status: true } }
				}
			}
		}
	})

	if (!entry) return apiError(404, 'Payslip not found')

	// Ownership check for EMPLOYEE role
	if (user.role === 'EMPLOYEE') {
		const myEmployee = await db.employee.findFirst({
			where: { userId: user.id }
		})

		if (!myEmployee || entry.employeeId !== myEmployee.id) {
			return apiError(403, 'Access denied')
		}
	}

	if (!isPayslipVisible(entry.payrollRun)) {
		return apiError(403, 'Payslip not yet available')
	}

	return json({ data: entry })
}
