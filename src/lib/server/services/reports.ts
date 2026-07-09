import { db } from '$lib/server/db'

export async function getHeadcountByDepartment(organizationId: string) {
	return db.department.findMany({
		where: { organizationId },
		include: {
			_count: {
				select: {
					employees: {
						where: { employmentStatus: 'ACTIVE' }
					}
				}
			}
		},
		orderBy: { name: 'asc' }
	})
}

export async function getLeaveUtilizationReport(organizationId: string, year: number) {
	return db.leaveBalance.findMany({
		where: {
			year,
			employee: { user: { organizationId }, employmentStatus: 'ACTIVE' }
		},
		include: {
			employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
			leaveType: { select: { name: true } }
		},
		orderBy: [{ employee: { lastName: 'asc' } }, { leaveType: { name: 'asc' } }]
	})
}

export async function getPayrollSummaryReport(organizationId: string, year: number) {
	return db.payrollRun.findMany({
		where: {
			organizationId,
			status: 'APPROVED',
			periodStart: { gte: new Date(`${year}-01-01`) },
			periodEnd: { lte: new Date(`${year}-12-31`) }
		},
		select: {
			id: true,
			periodStart: true,
			periodEnd: true,
			totalGross: true,
			totalDeductions: true,
			totalNet: true,
			hasOverride: true
		},
		orderBy: { periodStart: 'asc' }
	})
}

export async function getAttritionReport(organizationId: string, year: number) {
	const [hired, offboarded] = await Promise.all([
		db.employee.count({
			where: {
				user: { organizationId },
				startDate: {
					gte: new Date(`${year}-01-01`),
					lte: new Date(`${year}-12-31`)
				}
			}
		}),
		db.employee.count({
			where: {
				user: { organizationId },
				employmentStatus: 'OFFBOARDED',
				endDate: {
					gte: new Date(`${year}-01-01`),
					lte: new Date(`${year}-12-31`)
				}
			}
		})
	])

	return { year, hired, offboarded }
}
