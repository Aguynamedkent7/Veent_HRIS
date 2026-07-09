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

	await db.leaveType.createMany({
		data: [
			{ organizationId: org.id, name: 'Vacation Leave', isPaid: true, defaultDaysPerYear: 15, allowCarryOver: true, maxCarryOverDays: 5 },
			{ organizationId: org.id, name: 'Sick Leave', isPaid: true, defaultDaysPerYear: 15 },
			{ organizationId: org.id, name: 'Emergency Leave', isPaid: true, defaultDaysPerYear: 3 },
			{ organizationId: org.id, name: 'Maternity Leave', isPaid: true, defaultDaysPerYear: 105 },
			{ organizationId: org.id, name: 'Paternity Leave', isPaid: true, defaultDaysPerYear: 7 }
		],
		skipDuplicates: true
	})

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

	console.log('Seed complete. Login: admin@veent.ph / Admin@1234')
}

main()
	.catch(console.error)
	.finally(() => db.$disconnect())
