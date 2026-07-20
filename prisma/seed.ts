import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const db = new PrismaClient()

async function main() {
	const org = await db.organization.upsert({
		where: { id: 'org_seed' },
		update: { name: 'Veent' },
		create: {
			id: 'org_seed',
			name: 'Veent',
			address: 'Makati City, Metro Manila, Philippines'
		}
	})

	// Three-org rollout (#131). The primary tenant above keeps id `org_seed` for
	// backwards-compat; JoJo and Sweetleaf are the two additional tenants. Managers
	// and cross-org memberships for these are seeded in #132/#140.
	await db.organization.upsert({
		where: { id: 'org_jojo' },
		update: { name: 'JoJo' },
		create: { id: 'org_jojo', name: 'JoJo' }
	})
	await db.organization.upsert({
		where: { id: 'org_sweetleaf' },
		update: { name: 'Sweetleaf' },
		create: { id: 'org_sweetleaf', name: 'Sweetleaf' }
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

	// Verifier + Approver (#134): pure sign-off accounts for the maker→verifier→approver
	// chain. No Employee record — they never file requests, they only check and approve.
	// Membership + roles=[role] are backfilled by the loop at the end of this seed.
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
	// Regular window is 08:00–17:00; Wednesday runs 07:00–18:00 to show 2h of OT.
	const weekEntries = (startISO: string) => {
		const start = new Date(startISO)
		const out: {
			date: Date
			timeIn: Date
			timeOut: Date
			hoursWorked: number
			otHours: number
			notes: string
		}[] = []
		for (let i = 0; i < 5; i++) {
			// Mon–Fri
			const d = new Date(start)
			d.setUTCDate(start.getUTCDate() + i)
			const day = d.toISOString().slice(0, 10)
			const ot = i === 2
			out.push({
				date: d,
				timeIn: new Date(`${day}T${ot ? '07' : '08'}:00:00+08:00`),
				timeOut: new Date(`${day}T${ot ? '18' : '17'}:00:00+08:00`),
				hoursWorked: ot ? 11 : 9,
				otHours: ot ? 2 : 0,
				notes: ot ? 'Overtime' : 'Regular day'
			})
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

	// A full month (all weekdays) in one timesheet to stress-test the review UI.
	const monthEntries = (year: number, month: number) => {
		const out: {
			date: Date
			timeIn: Date
			timeOut: Date
			hoursWorked: number
			otHours: number
			notes: string
		}[] = []
		const cur = new Date(Date.UTC(year, month - 1, 1))
		const last = new Date(Date.UTC(year, month, 0))
		for (; cur <= last; cur.setUTCDate(cur.getUTCDate() + 1)) {
			const dow = cur.getUTCDay()
			if (dow === 0 || dow === 6) continue // skip weekends
			const day = cur.toISOString().slice(0, 10)
			const ot = cur.getUTCDate() % 5 === 0 // OT every 5th of the month
			out.push({
				date: new Date(cur),
				timeIn: new Date(`${day}T${ot ? '07' : '08'}:00:00+08:00`),
				timeOut: new Date(`${day}T${ot ? '19' : '17'}:00:00+08:00`),
				hoursWorked: ot ? 12 : 9,
				otHours: ot ? 3 : 0,
				notes: ot ? 'Overtime' : 'Regular day'
			})
		}
		return out
	}
	{
		const entries = monthEntries(2026, 5) // May 2026
		const totalHours = entries.reduce((a, e) => a + e.hoursWorked, 0)
		await db.timesheet.upsert({
			where: {
				employeeId_periodStart: { employeeId: employee.id, periodStart: new Date('2026-05-01') }
			},
			update: {},
			create: {
				employeeId: employee.id,
				periodStart: new Date('2026-05-01'),
				periodEnd: new Date('2026-05-31'),
				status: 'SUBMITTED',
				totalHours,
				submittedAt: new Date(),
				entries: { create: entries }
			}
		})
	}

	// --- Raw time-log punches (source for the HR "aggregate from time logs" flow) ---
	// TimeLog has no natural unique key, so re-seeding would duplicate; delete this employee's
	// punches in the seeded window first, then recreate them. Reseeding must NOT destroy a
	// timesheet someone finalized: delete only punches that are unlinked or linked to a DRAFT
	// timesheet, and only recreate a week's data when that week has no finalized timesheet.
	const punchWindowStart = new Date('2026-07-06T00:00:00+08:00')
	const punchWindowEnd = new Date('2026-07-18T00:00:00+08:00')
	const cleanWeekStart = new Date('2026-07-05T16:00:00.000Z') // Mon 2026-07-06 00:00 PHT
	const cleanWeekEnd = new Date('2026-07-12T15:59:59.999Z') // Sun 2026-07-12 23:59:59.999 PHT
	const warnWeekStart = new Date('2026-07-12T16:00:00.000Z') // Mon 2026-07-13 00:00 PHT

	const at = (dayISO: string, hhmm: string) => new Date(`${dayISO}T${hhmm}:00+08:00`)
	const punch = (dayISO: string, hhmm: string, punchType: 'IN' | 'OUT') => ({
		employeeId: employee.id,
		punchType: punchType as 'IN' | 'OUT',
		source: 'DISCORD' as const,
		timestamp: at(dayISO, hhmm)
	})

	// Week of Mon 2026-07-06 — clean day shifts; aggregates warning-free. Kept as data so we
	// can both insert the raw punches and pre-build the aggregated timesheet from the same source.
	const cleanShifts = [
		{ day: '2026-07-06', in: '08:00', out: '17:00' },
		{ day: '2026-07-07', in: '08:00', out: '17:00' },
		{ day: '2026-07-08', in: '07:00', out: '19:00' }, // long day
		{ day: '2026-07-09', in: '08:00', out: '17:00' },
		{ day: '2026-07-10', in: '08:00', out: '17:00' }
	]
	// Split a day shift into paid total (less the unpaid 12:00–13:00 lunch) and its OT portion
	// (time outside the 08:00–17:00 window) — matches pairPunchesToDailyHours / the modal.
	const toMin = (t: string) => {
		const [h, m] = t.split(':').map(Number)
		return h * 60 + m
	}
	const workedHours = (inHHMM: string, outHHMM: string) => {
		const inM = toMin(inHHMM)
		const outM = toMin(outHHMM)
		const lunch = Math.max(0, Math.min(outM, 13 * 60) - Math.max(inM, 12 * 60))
		return (outM - inM - lunch) / 60
	}
	const otHours = (inHHMM: string, outHHMM: string) => {
		const inM = toMin(inHHMM)
		const outM = toMin(outHHMM)
		const regWindow = Math.max(0, Math.min(outM, 17 * 60) - Math.max(inM, 8 * 60))
		return (outM - inM - regWindow) / 60
	}

	const cleanPunches = cleanShifts.flatMap((s) => [
		punch(s.day, s.in, 'IN'),
		punch(s.day, s.out, 'OUT')
	])
	// Week of Mon 2026-07-13 — a couple of valid shifts plus two warning cases.
	const warnPunches = [
		punch('2026-07-13', '08:00', 'IN'),
		punch('2026-07-13', '17:00', 'OUT'), // clean day
		punch('2026-07-14', '22:00', 'IN'), // valid overnight shift…
		punch('2026-07-15', '06:00', 'OUT'), // …closes on the 15th: a normal 8h shift attributed to the 14th (PHT)
		punch('2026-07-16', '17:00', 'OUT'), // stray OUT → "OUT without a matching IN" warning
		punch('2026-07-17', '08:00', 'IN') // never closed → "Missing OUT" warning
	]

	// Is a given week already finalized (a non-DRAFT timesheet)? If so, leave it untouched.
	const isFinalized = async (periodStart: Date) => {
		const ts = await db.timesheet.findUnique({
			where: { employeeId_periodStart: { employeeId: employee.id, periodStart } },
			select: { status: true }
		})
		return ts != null && ts.status !== 'DRAFT'
	}
	const cleanFinalized = await isFinalized(cleanWeekStart)
	const warnFinalized = await isFinalized(warnWeekStart)

	await db.timeLog.deleteMany({
		where: {
			employeeId: employee.id,
			timestamp: { gte: punchWindowStart, lte: punchWindowEnd },
			OR: [{ timesheetId: null }, { timesheet: { status: 'DRAFT' } }]
		}
	})
	await db.timeLog.createMany({
		data: [...(cleanFinalized ? [] : cleanPunches), ...(warnFinalized ? [] : warnPunches)]
	})

	// A pre-aggregated, warning-free DRAFT timesheet built from the clean week's punches —
	// the same shape aggregateTimeLogsToTimesheet produces. Skipped if that week already has a
	// finalized timesheet (preserved above); the DRAFT delete keeps re-runs idempotent.
	if (!cleanFinalized) {
		await db.timesheet.deleteMany({
			where: { employeeId: employee.id, periodStart: cleanWeekStart, status: 'DRAFT' }
		})
		const aggEntries = cleanShifts.map((s) => ({
			date: new Date(`${s.day}T00:00:00.000Z`),
			hoursWorked: workedHours(s.in, s.out),
			otHours: otHours(s.in, s.out),
			notes: 'Aggregated from Discord time logs'
		}))
		const aggTimesheet = await db.timesheet.create({
			data: {
				employeeId: employee.id,
				periodStart: cleanWeekStart,
				periodEnd: cleanWeekEnd,
				status: 'DRAFT',
				totalHours: aggEntries.reduce((a, e) => a + e.hoursWorked, 0),
				entries: { create: aggEntries }
			}
		})
		await db.timeLog.updateMany({
			where: { employeeId: employee.id, timestamp: { gte: cleanWeekStart, lte: cleanWeekEnd } },
			data: { timesheetId: aggTimesheet.id }
		})
	}

	// Backfill cross-org memberships (#131) and the multi-role set (#133): every user
	// gets one membership mirroring their primary org, and `roles` seeded to [role] so
	// single-role behaviour is unchanged. Both idempotent.
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

	console.log('Seed complete. Logins:')
	console.log('  CEO:             ceo@veent.ph / Ceo@1234  (Veent + JoJo + Sweetleaf)')
	console.log('  Super Admin:     admin@veent.ph / Admin@1234')
	console.log('  Verifier:        verifier@veent.ph / Verifier@1234')
	console.log('  Approver:        approver@veent.ph / Approver@1234')
	console.log('  Manager:         manager@veent.ph / Manager@1234')
	console.log('  Employee:        employee@veent.ph / Employee@1234')
	console.log('  Payroll Officer: payroll@veent.ph / Payroll@1234')
	console.log('  Finance:         finance@veent.ph / Finance@1234')
	console.log('')
	console.log('Time-log punches seeded for Elena Employee (EMP-003), aggregatable at /timesheets:')
	console.log(
		'  Week of 2026-07-06 — clean; also pre-aggregated into a DRAFT timesheet (no warnings)'
	)
	console.log('  Week of 2026-07-13 — a valid overnight shift + stray-OUT and missing-OUT warnings')
}

main()
	.catch(console.error)
	.finally(() => db.$disconnect())
