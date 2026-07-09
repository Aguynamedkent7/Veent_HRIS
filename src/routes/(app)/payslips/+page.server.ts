import { redirect } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!

	const myEmployee = await db.employee.findFirst({
		where: { userId: user.id }
	})

	if (!myEmployee) {
		redirect(302, '/dashboard')
	}

	const payslips = await db.payrollEntry.findMany({
		where: {
			employeeId: myEmployee.id,
			payrollRun: { status: 'APPROVED' }
		},
		include: {
			payrollRun: {
				select: {
					periodStart: true,
					periodEnd: true,
					status: true
				}
			}
		},
		orderBy: {
			payrollRun: { periodStart: 'desc' }
		}
	})

	return { payslips }
}
