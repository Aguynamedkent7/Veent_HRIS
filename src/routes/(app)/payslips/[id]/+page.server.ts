import { error, redirect } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.user!

	const myEmployee = await db.employee.findFirst({
		where: { userId: user.id }
	})

	if (!myEmployee) {
		redirect(302, '/dashboard')
	}

	const entry = await db.payrollEntry.findUnique({
		where: { id: params.id },
		include: {
			employee: {
				select: {
					firstName: true,
					lastName: true,
					employeeNumber: true,
					jobTitle: true,
					department: { select: { name: true } }
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

	if (!entry) error(404, 'Payslip not found')
	if (entry.employeeId !== myEmployee.id) error(403, 'Access denied')
	if (entry.payrollRun.status !== 'APPROVED') error(403, 'Payslip not yet available')

	return { entry }
}
