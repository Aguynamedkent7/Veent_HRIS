import { db } from '$lib/server/db'

// ─── Legacy helpers (kept for existing reports page) ─────────────────────────

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

// ─── Filter Options ───────────────────────────────────────────────────────────

interface DateRangeFilter {
	startDate: Date
	endDate: Date
	departmentId?: string
}

// ─── generateHeadcount ────────────────────────────────────────────────────────
// Returns monthly headcount snapshots (active employees at end of each month)
// within the given date range, optionally filtered by department.

export async function generateHeadcount(
	organizationId: string,
	{ startDate, endDate, departmentId }: DateRangeFilter
) {
	const where = {
		user: { organizationId },
		startDate: { lte: endDate },
		OR: [{ endDate: null }, { endDate: { gte: startDate } }],
		...(departmentId ? { departmentId } : {})
	}

	const employees = await db.employee.findMany({
		where,
		select: {
			id: true,
			startDate: true,
			endDate: true,
			employmentStatus: true,
			department: { select: { name: true } }
		}
	})

	// Build monthly periods
	const periods: { period: string; headcount: number; department: string }[] = []
	const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
	const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1)

	while (cursor <= endMonth) {
		const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
		const label = cursor.toLocaleDateString('en-PH', { year: 'numeric', month: 'short' })

		const active = employees.filter((e) => {
			const started = e.startDate <= monthEnd
			const notEnded = !e.endDate || e.endDate >= cursor
			return started && notEnded
		})

		if (departmentId) {
			periods.push({ period: label, headcount: active.length, department: departmentId })
		} else {
			// Group by department
			const byDept: Record<string, number> = {}
			for (const e of active) {
				const deptName = e.department.name
				byDept[deptName] = (byDept[deptName] ?? 0) + 1
			}
			if (Object.keys(byDept).length === 0) {
				periods.push({ period: label, headcount: 0, department: 'All' })
			} else {
				for (const [dept, count] of Object.entries(byDept)) {
					periods.push({ period: label, headcount: count, department: dept })
				}
			}
		}

		cursor.setMonth(cursor.getMonth() + 1)
	}

	return periods
}

// ─── generateAttendance ───────────────────────────────────────────────────────

export async function generateAttendance(
	organizationId: string,
	{ startDate, endDate, departmentId }: DateRangeFilter
) {
	const timesheets = await db.timesheet.findMany({
		where: {
			periodStart: { gte: startDate },
			periodEnd: { lte: endDate },
			employee: {
				user: { organizationId },
				...(departmentId ? { departmentId } : {})
			}
		},
		select: {
			id: true,
			periodStart: true,
			periodEnd: true,
			totalHours: true,
			status: true,
			employee: {
				select: {
					firstName: true,
					lastName: true,
					employeeNumber: true
				}
			}
		},
		orderBy: [{ employee: { lastName: 'asc' } }, { periodStart: 'asc' }]
	})

	return timesheets.map((t) => ({
		Employee: `${t.employee.lastName}, ${t.employee.firstName} (${t.employee.employeeNumber})`,
		Period: `${t.periodStart.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} – ${t.periodEnd.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`,
		TotalHours: Number(t.totalHours),
		Status: t.status
	}))
}

// ─── generatePayrollCosts ─────────────────────────────────────────────────────

export async function generatePayrollCosts(
	organizationId: string,
	{ startDate, endDate }: { startDate: Date; endDate: Date }
) {
	const runs = await db.payrollRun.findMany({
		where: {
			organizationId,
			periodStart: { gte: startDate },
			periodEnd: { lte: endDate }
		},
		select: {
			periodStart: true,
			periodEnd: true,
			totalGross: true,
			totalNet: true,
			entries: {
				select: {
					grossPay: true,
					netPay: true,
					employee: {
						select: {
							department: { select: { name: true } }
						}
					}
				}
			}
		},
		orderBy: { periodStart: 'asc' }
	})

	// Flatten: one row per department per run
	const rows: {
		Period: string
		Department: string
		TotalGross: number
		TotalNet: number
		HeadCount: number
	}[] = []

	for (const run of runs) {
		const period = `${run.periodStart.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} – ${run.periodEnd.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`
		const byDept: Record<string, { gross: number; net: number; count: number }> = {}

		for (const entry of run.entries) {
			const dept = entry.employee.department.name
			if (!byDept[dept]) byDept[dept] = { gross: 0, net: 0, count: 0 }
			byDept[dept].gross += Number(entry.grossPay)
			byDept[dept].net += Number(entry.netPay)
			byDept[dept].count += 1
		}

		for (const [dept, totals] of Object.entries(byDept)) {
			rows.push({
				Period: period,
				Department: dept,
				TotalGross: totals.gross,
				TotalNet: totals.net,
				HeadCount: totals.count
			})
		}
	}

	return rows
}

// ─── generateLeaveUtilization ─────────────────────────────────────────────────

export async function generateLeaveUtilization(
	organizationId: string,
	{ startDate, endDate }: { startDate: Date; endDate: Date }
) {
	// Leave is now a Request of type LEAVE; totalDays and leaveTypeId live in payload.
	const requests = await db.request.findMany({
		where: {
			type: 'LEAVE',
			status: 'APPROVED',
			dateFrom: { gte: startDate },
			dateTo: { lte: endDate },
			employee: { user: { organizationId } }
		},
		select: { payload: true, employeeId: true }
	})

	const typeIds = [...new Set(requests.map((r) => (r.payload as { leaveTypeId?: string })?.leaveTypeId).filter(Boolean) as string[])]
	const types = typeIds.length
		? await db.leaveType.findMany({ where: { id: { in: typeIds } }, select: { id: true, name: true } })
		: []
	const typeNames = new Map(types.map((t) => [t.id, t.name]))

	// Group by leave type
	const byType: Record<string, { totalDays: number; employees: Set<string> }> = {}
	for (const req of requests) {
		const payload = (req.payload ?? {}) as { leaveTypeId?: string; totalDays?: number }
		const name = (payload.leaveTypeId && typeNames.get(payload.leaveTypeId)) || '—'
		if (!byType[name]) byType[name] = { totalDays: 0, employees: new Set() }
		byType[name].totalDays += Number(payload.totalDays ?? 0)
		byType[name].employees.add(req.employeeId)
	}

	return Object.entries(byType).map(([name, data]) => ({
		LeaveType: name,
		TotalDaysUsed: data.totalDays,
		EmployeeCount: data.employees.size
	}))
}

// ─── generatePayrollRegister ──────────────────────────────────────────────────
// One row per payroll entry in the range: gross, itemized statutory, other
// deductions (loans/cash advances/tardiness), and net — the standard payroll register.

export async function generatePayrollRegister(
	organizationId: string,
	{ startDate, endDate }: { startDate: Date; endDate: Date }
) {
	const entries = await db.payrollEntry.findMany({
		where: {
			payrollRun: { organizationId, periodStart: { gte: startDate }, periodEnd: { lte: endDate } }
		},
		select: {
			grossPay: true,
			sssEe: true,
			philhealthEe: true,
			pagibigEe: true,
			withholdingTax: true,
			totalDeductions: true,
			netPay: true,
			payrollRun: { select: { periodStart: true, periodEnd: true } },
			employee: { select: { firstName: true, lastName: true, employeeNumber: true } }
		},
		orderBy: [{ payrollRun: { periodStart: 'asc' } }, { employee: { lastName: 'asc' } }]
	})

	const fmt = (d: Date) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
	return entries.map((e) => {
		const statutory = Number(e.sssEe) + Number(e.philhealthEe) + Number(e.pagibigEe) + Number(e.withholdingTax)
		const other = Math.round((Number(e.totalDeductions) - statutory) * 100) / 100
		return {
			Employee: `${e.employee.lastName}, ${e.employee.firstName} (${e.employee.employeeNumber})`,
			Period: `${fmt(e.payrollRun.periodStart)} – ${fmt(e.payrollRun.periodEnd)}`,
			Gross: Number(e.grossPay),
			SSS: Number(e.sssEe),
			PhilHealth: Number(e.philhealthEe),
			PagIBIG: Number(e.pagibigEe),
			Tax: Number(e.withholdingTax),
			OtherDeductions: other,
			Net: Number(e.netPay)
		}
	})
}

// ─── exportToCSV ──────────────────────────────────────────────────────────────

export function exportToCSV(rows: Record<string, unknown>[]): string {
	if (rows.length === 0) return ''

	const headers = Object.keys(rows[0])
	const escape = (val: unknown): string => {
		const str = val === null || val === undefined ? '' : String(val)
		if (str.includes(',') || str.includes('"') || str.includes('\n')) {
			return `"${str.replace(/"/g, '""')}"`
		}
		return str
	}

	const lines = [
		headers.join(','),
		...rows.map((row) => headers.map((h) => escape(row[h])).join(','))
	]

	return lines.join('\r\n')
}
