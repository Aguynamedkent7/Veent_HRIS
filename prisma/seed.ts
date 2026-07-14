import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const db = new PrismaClient()

async function main() {
	const org = await db.organization.upsert({
		where: { id: 'org_seed' },
		update: {},
		create: {
			id: 'org_seed',
			name: 'Veent Corp',
			address: 'Makati City, Metro Manila, Philippines'
		}
	})

	const dept = await db.department.upsert({
		where: { organizationId_name: { organizationId: org.id, name: 'Human Resources' } },
		update: {},
		create: { organizationId: org.id, name: 'Human Resources' }
	})

	const hash = await bcrypt.hash('Admin@1234', 12)

	const superAdmin = await db.user.upsert({
		where: { email: 'admin@veent.ph' },
		update: {},
		create: {
			organizationId: org.id,
			email: 'admin@veent.ph',
			passwordHash: hash,
			role: 'SUPER_ADMIN'
		}
	})

	await db.employee.upsert({
		where: { userId: superAdmin.id },
		update: {},
		create: {
			userId: superAdmin.id,
			organizationId: org.id,
			employeeNumber: 'EMP-001',
			firstName: 'System',
			lastName: 'Admin',
			departmentId: dept.id,
			jobTitle: 'HR System Administrator',
			employmentType: 'FULL_TIME',
			startDate: new Date('2025-01-01'),
			basicMonthlySalary: 50000,
			rateType: 'MONTHLY'
		}
	})

	// Idempotent: LeaveType has no unique constraint on (organizationId, name), so
	// createMany would duplicate on every run. Only seed when none exist yet.
	const existingLeaveTypes = await db.leaveType.count({ where: { organizationId: org.id } })
	if (existingLeaveTypes === 0) {
		await db.leaveType.createMany({
			data: [
				{
					organizationId: org.id,
					name: 'Vacation Leave',
					isPaid: true,
					defaultDaysPerYear: 15,
					allowCarryOver: true,
					maxCarryOverDays: 5
				},
				{ organizationId: org.id, name: 'Sick Leave', isPaid: true, defaultDaysPerYear: 15 },
				{ organizationId: org.id, name: 'Emergency Leave', isPaid: true, defaultDaysPerYear: 3 },
				{ organizationId: org.id, name: 'Maternity Leave', isPaid: true, defaultDaysPerYear: 105 },
				{ organizationId: org.id, name: 'Paternity Leave', isPaid: true, defaultDaysPerYear: 7 }
			]
		})
	}

	// --- Manager (direct supervisor) ---
	const managerHash = await bcrypt.hash('Manager@1234', 12)
	const managerUser = await db.user.upsert({
		where: { email: 'manager@veent.ph' },
		update: {},
		create: {
			organizationId: org.id,
			email: 'manager@veent.ph',
			passwordHash: managerHash,
			role: 'MANAGER'
		}
	})
	const managerEmployee = await db.employee.upsert({
		where: { userId: managerUser.id },
		update: {},
		create: {
			userId: managerUser.id,
			organizationId: org.id,
			employeeNumber: 'EMP-002',
			firstName: 'Maria',
			lastName: 'Manager',
			departmentId: dept.id,
			jobTitle: 'People Operations Manager',
			employmentType: 'FULL_TIME',
			startDate: new Date('2025-01-15'),
			basicMonthlySalary: 45000,
			rateType: 'MONTHLY'
		}
	})

	// --- Regular employee reporting to the manager ---
	const employeeHash = await bcrypt.hash('Employee@1234', 12)
	const employeeUser = await db.user.upsert({
		where: { email: 'employee@veent.ph' },
		update: {},
		create: {
			organizationId: org.id,
			email: 'employee@veent.ph',
			passwordHash: employeeHash,
			role: 'EMPLOYEE'
		}
	})
	const employee = await db.employee.upsert({
		where: { userId: employeeUser.id },
		update: { reportsToId: managerEmployee.id, discordId: '123456789012345678' },
		create: {
			userId: employeeUser.id,
			organizationId: org.id,
			employeeNumber: 'EMP-003',
			firstName: 'Elena',
			lastName: 'Employee',
			departmentId: dept.id,
			jobTitle: 'Software Engineer',
			employmentType: 'FULL_TIME',
			startDate: new Date('2025-02-01'),
			basicMonthlySalary: 30000,
			rateType: 'MONTHLY',
			reportsToId: managerEmployee.id,
			discordId: '123456789012345678'
		}
	})

	// --- Payroll Officer (payroll access, no full HR) ---
	const payrollHash = await bcrypt.hash('Payroll@1234', 12)
	const payrollUser = await db.user.upsert({
		where: { email: 'payroll@veent.ph' },
		update: { role: 'PAYROLL_OFFICER' },
		create: {
			organizationId: org.id,
			email: 'payroll@veent.ph',
			passwordHash: payrollHash,
			role: 'PAYROLL_OFFICER'
		}
	})
	await db.employee.upsert({
		where: { userId: payrollUser.id },
		update: {},
		create: {
			userId: payrollUser.id,
			organizationId: org.id,
			employeeNumber: 'EMP-004',
			firstName: 'Paulo',
			lastName: 'Payroll',
			departmentId: dept.id,
			jobTitle: 'Payroll Officer',
			employmentType: 'FULL_TIME',
			startDate: new Date('2025-01-15'),
			basicMonthlySalary: 35000,
			rateType: 'MONTHLY'
		}
	})

	// --- Finance (payroll reports only, read-only) ---
	const financeHash = await bcrypt.hash('Finance@1234', 12)
	const financeUser = await db.user.upsert({
		where: { email: 'finance@veent.ph' },
		update: { role: 'FINANCE' },
		create: {
			organizationId: org.id,
			email: 'finance@veent.ph',
			passwordHash: financeHash,
			role: 'FINANCE'
		}
	})
	await db.employee.upsert({
		where: { userId: financeUser.id },
		update: {},
		create: {
			userId: financeUser.id,
			organizationId: org.id,
			employeeNumber: 'EMP-005',
			firstName: 'Fiona',
			lastName: 'Finance',
			departmentId: dept.id,
			jobTitle: 'Finance Analyst',
			employmentType: 'FULL_TIME',
			startDate: new Date('2025-01-15'),
			basicMonthlySalary: 40000,
			rateType: 'MONTHLY'
		}
	})

	// --- Leave balances for the employee (current year) so leave requests validate ---
	const year = new Date().getFullYear()
	const leaveTypes = await db.leaveType.findMany({ where: { organizationId: org.id } })
	for (const lt of leaveTypes) {
		await db.leaveBalance.upsert({
			where: {
				employeeId_leaveTypeId_year: { employeeId: employee.id, leaveTypeId: lt.id, year }
			},
			update: {},
			create: {
				employeeId: employee.id,
				leaveTypeId: lt.id,
				year,
				allocated: lt.defaultDaysPerYear,
				used: 0,
				remaining: lt.defaultDaysPerYear
			}
		})
	}

	await db.payrollConfig.upsert({
		where: { organizationId: org.id },
		update: {},
		create: {
			organizationId: org.id,
			payFrequency: 'SEMI_MONTHLY',
			firstCutoff: 15,
			secondCutoff: 30,
			philhealthRate: 0.05,
			philhealthFloor: 10000,
			philhealthCeiling: 100000,
			pagibigRate: 0.02,
			pagibigCeiling: 5000,
			sssTable: {},
			birTaxTable: {}
		}
	})

	// --- Payroll expansion config: earning/deduction codes + premium rate rule (DOLE defaults) ---
	const earningTypes = [
		{ code: 'BASIC', label: 'Basic pay', taxable: true, multiplier: 1.0 },
		{ code: 'OT', label: 'Overtime', taxable: true, multiplier: 1.25 },
		{ code: 'NIGHT_DIFF', label: 'Night differential', taxable: true, multiplier: 0.1 },
		{ code: 'REST_DAY', label: 'Rest day', taxable: true, multiplier: 1.3 },
		{ code: 'REG_HOLIDAY', label: 'Regular holiday', taxable: true, multiplier: 2.0 },
		{ code: 'SPECIAL_HOLIDAY', label: 'Special holiday', taxable: true, multiplier: 1.3 },
		{ code: 'ALLOWANCE', label: 'Allowances', taxable: false, multiplier: null },
		{ code: 'INCENTIVE', label: 'Incentives', taxable: true, multiplier: null }
	]
	for (const et of earningTypes) {
		await db.earningType.upsert({
			where: { organizationId_code: { organizationId: org.id, code: et.code } },
			update: {},
			create: { organizationId: org.id, ...et }
		})
	}

	const deductionTypes = [
		{ code: 'SSS_EE', label: 'SSS', isStatutory: true },
		{ code: 'PHILHEALTH_EE', label: 'PhilHealth', isStatutory: true },
		{ code: 'PAGIBIG_EE', label: 'Pag-IBIG', isStatutory: true },
		{ code: 'TAX', label: 'Withholding tax', isStatutory: true },
		{ code: 'TARDINESS', label: 'Tardiness/undertime', isStatutory: false },
		{ code: 'LOAN', label: 'Loan', isStatutory: false },
		{ code: 'CASH_ADVANCE', label: 'Cash advance', isStatutory: false }
	]
	for (const dt of deductionTypes) {
		await db.deductionType.upsert({
			where: { organizationId_code: { organizationId: org.id, code: dt.code } },
			update: {},
			create: { organizationId: org.id, ...dt }
		})
	}

	await db.payRateRule.upsert({
		where: { organizationId: org.id },
		update: {},
		create: { organizationId: org.id } // schema defaults = DOLE rates
	})

	// --- Benefit plan (one sample; fixed id keeps upsert idempotent) ---
	await db.benefitPlan.upsert({
		where: { id: 'benefit_seed_hmo' },
		update: {},
		create: {
			id: 'benefit_seed_hmo',
			organizationId: org.id,
			name: 'Maxicare HMO — Basic',
			type: 'HMO',
			provider: 'Maxicare',
			description: 'Standard HMO coverage for regular employees.',
			employeeCost: 0,
			employerCost: 1500
		}
	})

	// --- Review cycle (one sample; fixed id keeps upsert idempotent) ---
	await db.reviewCycle.upsert({
		where: { id: 'review_cycle_seed' },
		update: {},
		create: {
			id: 'review_cycle_seed',
			organizationId: org.id,
			name: `H1 ${year} Performance Review`,
			startDate: new Date(`${year}-01-01`),
			endDate: new Date(`${year}-06-30`),
			status: 'ACTIVE'
		}
	})

	// --- Positions catalog (unique on organizationId+title, so upsert is idempotent) ---
	const positions = [
		{ title: 'HR System Administrator', level: 5 },
		{ title: 'People Operations Manager', level: 4 },
		{ title: 'Software Engineer', level: 3 },
		{ title: 'Payroll Officer', level: 3 },
		{ title: 'Finance Analyst', level: 3 }
	]
	for (const p of positions) {
		await db.position.upsert({
			where: { organizationId_title: { organizationId: org.id, title: p.title } },
			update: {},
			create: { organizationId: org.id, departmentId: dept.id, ...p }
		})
	}

	// --- Sample timesheets (unique on employeeId+periodStart → idempotent) ---
	const weekEntries = (startISO: string) => {
		const start = new Date(startISO)
		const out: { date: Date; hoursWorked: number; notes: string }[] = []
		for (let i = 0; i < 5; i++) {
			// Mon–Fri
			const d = new Date(start)
			d.setUTCDate(start.getUTCDate() + i)
			out.push({ date: d, hoursWorked: 8, notes: 'Regular day' })
		}
		return out
	}
	const sampleSheets: {
		empId: string
		start: string
		status: 'APPROVED' | 'SUBMITTED' | 'REJECTED' | 'DRAFT'
		rejectionReason?: string
	}[] = [
		{ empId: employee.id, start: '2026-06-01', status: 'APPROVED' },
		{ empId: employee.id, start: '2026-06-08', status: 'SUBMITTED' },
		{
			empId: employee.id,
			start: '2026-06-15',
			status: 'REJECTED',
			rejectionReason: 'Friday hours look off — please recheck before resubmitting.'
		},
		{ empId: employee.id, start: '2026-06-22', status: 'DRAFT' },
		{ empId: managerEmployee.id, start: '2026-06-08', status: 'SUBMITTED' }
	]
	for (const s of sampleSheets) {
		const entries = weekEntries(s.start)
		const totalHours = entries.reduce((a, e) => a + e.hoursWorked, 0)
		const periodStart = new Date(s.start)
		const periodEnd = new Date(s.start)
		periodEnd.setUTCDate(periodEnd.getUTCDate() + 6)
		const reviewed = s.status === 'APPROVED' || s.status === 'REJECTED'
		await db.timesheet.upsert({
			where: { employeeId_periodStart: { employeeId: s.empId, periodStart } },
			update: {},
			create: {
				employeeId: s.empId,
				periodStart,
				periodEnd,
				status: s.status,
				totalHours,
				submittedAt: s.status !== 'DRAFT' ? new Date() : null,
				reviewedAt: reviewed ? new Date() : null,
				reviewedById: reviewed ? managerUser.id : null,
				rejectionReason: s.status === 'REJECTED' ? s.rejectionReason : null,
				entries: { create: entries }
			}
		})
	}

	console.log('Seed complete. Logins:')
	console.log('  Super Admin:     admin@veent.ph / Admin@1234')
	console.log('  Manager:         manager@veent.ph / Manager@1234')
	console.log('  Employee:        employee@veent.ph / Employee@1234')
	console.log('  Payroll Officer: payroll@veent.ph / Payroll@1234')
	console.log('  Finance:         finance@veent.ph / Finance@1234')
}

main()
	.catch(console.error)
	.finally(() => db.$disconnect())
