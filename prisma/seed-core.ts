import type { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

// Shared seed logic. `seedProd` is the minimal production baseline (orgs, org-level
// config, and the three admin accounts). `seedE2E` layers the demo roster the
// Playwright suite logs in as on top. Neither runs on import — the thin runners in
// seed.ts / seed-e2e.ts instantiate the client and invoke these.

// Cross-org memberships (#131) + multi-role set (#133): every user gets one membership
// mirroring their primary org, and `roles` seeded to [role]. Idempotent; safe to re-run
// after adding more users (e.g. seedE2E calls it again once the demo roster exists).
async function backfillMembershipsAndRoles(db: PrismaClient) {
	const allUsers = await db.user.findMany({
		select: { id: true, organizationId: true, role: true, roles: true }
	})
	for (const u of allUsers) {
		await db.userOrganization.upsert({
			where: { userId_organizationId: { userId: u.id, organizationId: u.organizationId } },
			update: {},
			create: { userId: u.id, organizationId: u.organizationId }
		})
		if (u.roles.length === 0) {
			await db.user.update({ where: { id: u.id }, data: { roles: [u.role] } })
		}
	}
}

/**
 * Minimal production seed: the three tenants, org-level configuration, and the three
 * administrative accounts (CEO, Super Admin, HR Admin). No demo employees, timesheets,
 * leave balances, or time-log punches. Returns refs the E2E layer builds on.
 */
export async function seedProd(db: PrismaClient) {
	const org = await db.organization.upsert({
		where: { id: 'org_seed' },
		// Per-org branding (#135/#139): logo + brand colour. Veent keeps the red palette.
		update: { name: 'Veent', logoUrl: '/veent-logo.png', themePrimary: '0 79% 45%' },
		create: {
			id: 'org_seed',
			name: 'Veent',
			logoUrl: '/veent-logo.png',
			themePrimary: '0 79% 45%',
			address: 'Makati City, Metro Manila, Philippines'
		}
	})

	// Three-org rollout (#131). The primary tenant above keeps id `org_seed` for
	// backwards-compat; JoJo Potato and Sweetleaf are the two additional food-service tenants.
	await db.organization.upsert({
		where: { id: 'org_jojo' },
		update: {
			name: 'JoJo Potato',
			logoUrl: '/jojo-logo.svg',
			themePrimary: '32 95% 44%', // amber
			address: 'Quezon City, Metro Manila, Philippines'
		},
		create: {
			id: 'org_jojo',
			name: 'JoJo Potato',
			logoUrl: '/jojo-logo.svg',
			themePrimary: '32 95% 44%',
			address: 'Quezon City, Metro Manila, Philippines'
		}
	})
	await db.organization.upsert({
		where: { id: 'org_sweetleaf' },
		update: {
			name: 'Sweetleaf',
			logoUrl: '/sweetleaf-logo.svg',
			themePrimary: '142 71% 42%', // green
			address: 'Pasig City, Metro Manila, Philippines'
		},
		create: {
			id: 'org_sweetleaf',
			name: 'Sweetleaf',
			logoUrl: '/sweetleaf-logo.svg',
			themePrimary: '142 71% 42%',
			address: 'Pasig City, Metro Manila, Philippines'
		}
	})

	const dept = await db.department.upsert({
		where: { organizationId_name: { organizationId: org.id, name: 'Human Resources' } },
		update: {},
		create: { organizationId: org.id, name: 'Human Resources' }
	})

	// Default work schedule: Mon–Fri 8:00 AM – 5:00 PM PHT with a 1-hour unpaid lunch (8 paid
	// hours). Onboarding assigns this so a new hire has an explicit schedule that attendance
	// derivation reads (480 = 08:00, 1020 = 17:00, in PHT minutes-from-midnight).
	const defaultSchedule = await db.workSchedule.upsert({
		where: { id: 'ws_default_seed' },
		update: { name: 'Default (8 AM – 5 PM)', isDefault: true },
		create: {
			id: 'ws_default_seed',
			organizationId: org.id,
			name: 'Default (8 AM – 5 PM)',
			isDefault: true
		}
	})
	for (const weekday of [1, 2, 3, 4, 5]) {
		await db.workScheduleDay.upsert({
			where: { scheduleId_weekday: { scheduleId: defaultSchedule.id, weekday } },
			update: { startMinutes: 480, endMinutes: 1020, breakMinutes: 60 },
			create: {
				scheduleId: defaultSchedule.id,
				weekday,
				startMinutes: 480,
				endMinutes: 1020,
				breakMinutes: 60
			}
		})
	}

	// --- Super Admin (HR system administrator) ---
	const adminHash = await bcrypt.hash('Admin@1234', 12)
	const superAdmin = await db.user.upsert({
		where: { email: 'admin@veent.ph' },
		update: {},
		create: {
			organizationId: org.id,
			email: 'admin@veent.ph',
			passwordHash: adminHash,
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

	// CEO (#132): the exclusive role-changer, member of all three tenants. Executive
	// access account — no Employee record; its authority is cross-org via memberships.
	const ceoHash = await bcrypt.hash('Ceo@1234', 12)
	const ceo = await db.user.upsert({
		where: { email: 'ceo@veent.ph' },
		update: { role: 'CEO' },
		create: {
			organizationId: org.id,
			email: 'ceo@veent.ph',
			passwordHash: ceoHash,
			role: 'CEO'
		}
	})
	for (const orgId of ['org_seed', 'org_jojo', 'org_sweetleaf']) {
		await db.userOrganization.upsert({
			where: { userId_organizationId: { userId: ceo.id, organizationId: orgId } },
			update: {},
			create: { userId: ceo.id, organizationId: orgId }
		})
	}

	// --- HR Admin (HR-level access) ---
	const hrHash = await bcrypt.hash('Hr@1234', 12)
	const hrUser = await db.user.upsert({
		where: { email: 'hr@veent.ph' },
		update: { role: 'HR_ADMIN' },
		create: {
			organizationId: org.id,
			email: 'hr@veent.ph',
			passwordHash: hrHash,
			role: 'HR_ADMIN'
		}
	})
	await db.employee.upsert({
		where: { userId: hrUser.id },
		update: {},
		create: {
			userId: hrUser.id,
			organizationId: org.id,
			employeeNumber: 'EMP-002',
			firstName: 'Hannah',
			lastName: 'HR',
			departmentId: dept.id,
			jobTitle: 'HR Administrator',
			employmentType: 'FULL_TIME',
			startDate: new Date('2025-01-01'),
			basicMonthlySalary: 45000,
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
	const year = new Date().getFullYear()
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
		{ title: 'HR Administrator', level: 4 }
	]
	for (const p of positions) {
		await db.position.upsert({
			where: { organizationId_title: { organizationId: org.id, title: p.title } },
			update: {},
			create: { organizationId: org.id, departmentId: dept.id, ...p }
		})
	}

	await backfillMembershipsAndRoles(db)

	return { org, dept }
}

/**
 * E2E / local-dev seed: the production baseline plus the demo roster the Playwright suite
 * logs in as (manager, employee, verifier, approver), the employee's reporting line, and
 * current-year leave balances. Still no timesheets or time-log punches — global-setup
 * pins the employee's discordId and manages punches/timesheets per run.
 */
export async function seedE2E(db: PrismaClient) {
	const { org, dept } = await seedProd(db)

	// Verifier + Approver (#134): pure sign-off accounts for the maker→verifier→approver
	// chain. No Employee record — they only check and approve, never file requests.
	const verifierHash = await bcrypt.hash('Verifier@1234', 12)
	await db.user.upsert({
		where: { email: 'verifier@veent.ph' },
		update: { role: 'VERIFIER' },
		create: {
			organizationId: org.id,
			email: 'verifier@veent.ph',
			passwordHash: verifierHash,
			role: 'VERIFIER'
		}
	})
	const approverHash = await bcrypt.hash('Approver@1234', 12)
	await db.user.upsert({
		where: { email: 'approver@veent.ph' },
		update: { role: 'APPROVER' },
		create: {
			organizationId: org.id,
			email: 'approver@veent.ph',
			passwordHash: approverHash,
			role: 'APPROVER'
		}
	})

	// --- Manager (direct supervisor; approves the employee's timesheets in the E2E suite) ---
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
			employeeNumber: 'EMP-003',
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

	// --- Regular employee reporting to the manager. Required by the E2E suite:
	// global-setup pins a known discordId and resets this employee's punches/leave. ---
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
			employeeNumber: 'EMP-004',
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

	// --- Leave balances for the employee (current year) so leave-filing E2E validates ---
	const balanceYear = new Date().getFullYear()
	const employeeLeaveTypes = await db.leaveType.findMany({ where: { organizationId: org.id } })
	for (const lt of employeeLeaveTypes) {
		await db.leaveBalance.upsert({
			where: {
				employeeId_leaveTypeId_year: {
					employeeId: employee.id,
					leaveTypeId: lt.id,
					year: balanceYear
				}
			},
			update: {},
			create: {
				employeeId: employee.id,
				leaveTypeId: lt.id,
				year: balanceYear,
				allocated: lt.defaultDaysPerYear,
				used: 0,
				remaining: lt.defaultDaysPerYear
			}
		})
	}

	// Cover the demo roster just added (seedProd already ran this for the admin accounts).
	await backfillMembershipsAndRoles(db)
}
