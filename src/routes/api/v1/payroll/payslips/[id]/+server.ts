import { json } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { apiError } from '$lib/server/api-error'
import { isPayslipVisible } from '$lib/server/services/payroll/runs'
import { canAny } from '$lib/rbac'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')

	const user = locals.user

	// Scoped at the query, not checked afterwards: PayrollEntry has no organizationId
	// of its own, so tenancy runs through payrollRun. The role gate below only ever
	// constrained EMPLOYEE, which left every privileged role able to read any org's
	// payslip by id. Filtering here also makes a foreign id indistinguishable from a
	// nonexistent one (404, not 403) — no cross-org existence disclosure.
	const entry = await db.payrollEntry.findFirst({
		where: { id: params.id, payrollRun: { organizationId: user.organizationId } },
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

	// Only payroll-report viewers may read someone else's payslip; everyone else is limited
	// to their own. Previously this checked EMPLOYEE only, so any other non-owner role in the
	// org — VERIFIER, APPROVER, a plain MANAGER — could read any employee's full payslip
	// (gross pay, SSS, PhilHealth, …) by id. Gate on the payroll-view capability instead.
	const roles = user.roles?.length ? user.roles : [user.role]
	if (!canAny(roles, 'VIEW_PAYROLL_REPORTS')) {
		const myEmployee = await db.employee.findFirst({
			where: { userId: user.id },
			select: { id: true }
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
