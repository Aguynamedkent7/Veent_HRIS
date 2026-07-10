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
				{ organizationId: org.id, name: 'Vacation Leave', isPaid: true, defaultDaysPerYear: 15, allowCarryOver: true, maxCarryOverDays: 5 },
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
		update: { reportsToId: managerEmployee.id },
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
			reportsToId: managerEmployee.id
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

	console.log('Seed complete. Logins:')
	console.log('  Super Admin: admin@veent.ph / Admin@1234')
	console.log('  Manager:     manager@veent.ph / Manager@1234')
	console.log('  Employee:    employee@veent.ph / Employee@1234')
}

main()
	.catch(console.error)
	.finally(() => db.$disconnect())
