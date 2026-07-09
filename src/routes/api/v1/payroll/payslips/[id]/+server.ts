import { json, error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { apiError } from '$lib/server/api-error'
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
					approvedAt: true
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

	if (entry.payrollRun.status !== 'APPROVED') {
		return apiError(403, 'Payslip not yet available')
	}

	return json({ data: entry })
}
