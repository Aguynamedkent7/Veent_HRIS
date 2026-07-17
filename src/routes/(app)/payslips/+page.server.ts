import { redirect } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { paginate } from '$lib/server/pagination'
import { payslipVisibleRunFilter } from '$lib/server/services/payroll/runs'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!

	const myEmployee = await db.employee.findFirst({
		where: { userId: user.id }
	})

	if (!myEmployee) {
		redirect(302, '/dashboard')
	}

	const where = {
		employeeId: myEmployee.id,
		payrollRun: payslipVisibleRunFilter
	}
	const total = await db.payrollEntry.count({ where })
	const pagination = paginate(url, total)

	const payslips = await db.payrollEntry.findMany({
		where,
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
		},
		skip: pagination.skip,
		take: pagination.take
	})

	return { payslips, pagination }
}
