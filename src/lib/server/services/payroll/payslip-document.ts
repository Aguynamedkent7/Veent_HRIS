/**
 * PayslipDocument — the pre-formatted DTO the PDF renderer consumes.
 *
 * All display strings are baked here so the renderer stays a pure layout
 * concern. Keep this module DB-free: hydrateFromEntry() takes plain data;
 * a thin wrapper in the route pulls it from Prisma and calls in.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PayslipDocument {
	company: {
		name: string
		address: string
		logoUrl: string | null
	}
	employee: {
		fullName: string
		employeeNumber: string
		position: string
		status: string
	}
	period: {
		periodLabel: string
		payDate: string
		dailyRate: string
		daysOfWork: string
		daysOfPresent: string
		basicPay: string
	}
	summary: {
		overtime: string
		thirteenthMonth: string
		allowance: string
	}
	overtimeRows: { label: string; hours: string; pay: string }[]
	adjustments: { label: string; amount: string }[]
	deductions: { label: string; amount: string }[]
	totals: {
		grossPay: string
		deduction: string
		netPay: string
	}
}

export interface PayrollEntryLike {
	hoursWorked: number
	basicPay: number
	grossPay: number
	sssEe: number
	philhealthEe: number
	pagibigEe: number
	withholdingTax: number
	totalDeductions: number
	netPay: number
	earnings: { code: string; label: string; amount: number }[]
	deductions: { code: string; label: string; amount: number }[]
}

export interface EmployeeLike {
	firstName: string
	lastName: string
	middleName: string | null
	employeeNumber: string
	jobTitle: string
	employmentType: string
	basicMonthlySalary: number
}

export interface OrgLike {
	name: string
	address: string | null
	logoUrl: string | null
}

export interface PayrollRunLike {
	periodStart: Date
	periodEnd: Date
	approvedAt: Date | null
}

export interface AttendanceSummaryLike {
	daysOfWork: number
	daysOfPresent: number
	lateMinutes: number
	// OT hours per bucket (sum over the pay period) — used to fill the OVERTIME
	// table's "HRS" column since the engine's earning labels don't embed hours.
	overtimeHours?: number
	restDayOtHours?: number
	regularHolidayOtHours?: number
	specialHolidayOtHours?: number
}

export interface HydrateInput {
	entry: PayrollEntryLike
	employee: EmployeeLike
	organization: OrgLike
	run: PayrollRunLike
	attendance: AttendanceSummaryLike
	monthlyWorkingDays?: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Overtime codes as emitted by the payroll engine (earnings.ts).
const OT_CODES = new Set(['OT', 'REST_DAY_OT', 'REG_HOLIDAY_OT', 'SPECIAL_HOLIDAY_OT'])
const OT_LABEL: Record<string, string> = {
	OT: 'REGULAR',
	REST_DAY_OT: 'REST DAY',
	REG_HOLIDAY_OT: 'REG HOLIDAY',
	SPECIAL_HOLIDAY_OT: 'SPECIAL HOLIDAY'
}

// Holiday-pay codes: work performed on a holiday (regular-hours variants).
// The template's "HOLIDAY PAY" row aggregates these.
const HOLIDAY_PAY_CODES = new Set(['REG_HOLIDAY', 'SPECIAL_HOLIDAY', 'REST_DAY'])

// Adjustment/other codes.
const THIRTEENTH_CODE = '13TH_MONTH'
const INCENTIVE_CODE = 'INCENTIVE'
const PAID_LEAVE_CODE = 'PAID_LEAVE'
const ALLOWANCE_KIND_PREFIX = 'ALLOWANCE'
const BASIC_PAY_CODE = 'BASIC'

const TARDINESS_CODE = 'TARDINESS'
const ABSENCE_CODE = 'ABSENCE'
const LOAN_PREFIX = 'LOAN'

const EMPLOYMENT_STATUS_LABEL: Record<string, string> = {
	FULL_TIME: 'REGULAR',
	PROBATIONARY: 'PROBATIONARY',
	CONTRACTUAL: 'CONTRACTUAL',
	PART_TIME: 'PART TIME'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const money = (n: number) =>
	n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const shortDate = (d: Date) =>
	`${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear().toString().slice(-2)}`

const hoursStr = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

// The employee name on the template is uppercase "LAST, FIRST M."
function formatEmployeeName(e: EmployeeLike): string {
	const first = e.firstName.toUpperCase()
	const last = e.lastName.toUpperCase()
	const mi = e.middleName ? ` ${e.middleName[0].toUpperCase()}.` : ''
	return `${last}, ${first}${mi}`
}

function sumBy<T>(rows: T[], pick: (r: T) => number): number {
	return rows.reduce((acc, r) => acc + pick(r), 0)
}

// ─── Assembler ────────────────────────────────────────────────────────────────

export function assemblePayslipDocument(input: HydrateInput): PayslipDocument {
	const { entry, employee, organization, run, attendance } = input
	const workingDays = input.monthlyWorkingDays ?? 22
	const dailyRate = employee.basicMonthlySalary / workingDays

	// Overtime: split by code, with a REGULAR fallback so a row always shows.
	// Hours come from the attendance bucket that pairs with each earnings code.
	const otHoursByCode: Record<string, number> = {
		OT: attendance.overtimeHours ?? 0,
		REST_DAY_OT: attendance.restDayOtHours ?? 0,
		REG_HOLIDAY_OT: attendance.regularHolidayOtHours ?? 0,
		SPECIAL_HOLIDAY_OT: attendance.specialHolidayOtHours ?? 0
	}
	const otEarnings = entry.earnings.filter((e) => OT_CODES.has(e.code))
	const overtimeRows =
		otEarnings.length > 0
			? otEarnings.map((e) => ({
					label: OT_LABEL[e.code] ?? e.code,
					hours: hoursStr(otHoursByCode[e.code] ?? hoursFromLabel(e.label) ?? 0),
					pay: money(e.amount)
				}))
			: [{ label: 'REGULAR', hours: '0', pay: money(0) }]
	const overtimeTotal = sumBy(otEarnings, (e) => e.amount)

	// Adjustments column — bucket named categories; everything else → OTHERS.
	const named = new Set<string>([
		BASIC_PAY_CODE,
		THIRTEENTH_CODE,
		INCENTIVE_CODE,
		PAID_LEAVE_CODE,
		...OT_CODES,
		...HOLIDAY_PAY_CODES
	])
	const pickAmount = (code: string) =>
		sumBy(
			entry.earnings.filter((e) => e.code === code),
			(e) => e.amount
		)
	const holidayPayTotal = sumBy(
		entry.earnings.filter((e) => HOLIDAY_PAY_CODES.has(e.code)),
		(e) => e.amount
	)
	const allowanceTotal = sumBy(
		entry.earnings.filter((e) => e.code.startsWith(ALLOWANCE_KIND_PREFIX)),
		(e) => e.amount
	)
	const othersEarnings = sumBy(
		entry.earnings.filter((e) => !named.has(e.code) && !e.code.startsWith(ALLOWANCE_KIND_PREFIX)),
		(e) => e.amount
	)
	const adjustments = [
		{ label: '13TH MONTH', amount: money(pickAmount(THIRTEENTH_CODE)) },
		{ label: 'INCENTIVE', amount: money(pickAmount(INCENTIVE_CODE)) },
		{ label: 'PAID LEAVES', amount: money(pickAmount(PAID_LEAVE_CODE)) },
		{ label: 'HOLIDAY PAY', amount: money(holidayPayTotal) },
		{ label: 'OTHERS', amount: money(Math.max(0, othersEarnings)) }
	]

	// Deductions column — statutory rows come from PayrollEntry; loans/others aggregated.
	const loanTotal = sumBy(
		entry.deductions.filter((d) => d.code.startsWith(LOAN_PREFIX)),
		(d) => d.amount
	)
	// The paper template has one row for time not rendered. ABSENCE (#121) is the same kind of
	// deduction as TARDINESS — unworked hours valued at the hourly rate — so it shares that row
	// rather than disappearing into OTHERS alongside benefit costs. Totals are unaffected.
	const tardiness = sumBy(
		entry.deductions.filter((d) => d.code === TARDINESS_CODE || d.code === ABSENCE_CODE),
		(d) => d.amount
	)
	const namedDeductions = new Set<string>([TARDINESS_CODE, ABSENCE_CODE])
	const othersDeductions = sumBy(
		entry.deductions.filter((d) => !namedDeductions.has(d.code) && !d.code.startsWith(LOAN_PREFIX)),
		(d) => d.amount
	)
	const deductions = [
		{ label: 'W/H TAX', amount: money(entry.withholdingTax) },
		{ label: 'SSS', amount: money(entry.sssEe) },
		{ label: 'PHILHEALTH', amount: money(entry.philhealthEe) },
		{ label: 'PAG-IBIG', amount: money(entry.pagibigEe) },
		{ label: 'TARDINESS', amount: money(tardiness) },
		{ label: 'LOAN', amount: money(loanTotal) },
		{ label: 'OTHERS', amount: money(othersDeductions) }
	]

	return {
		company: {
			name: organization.name.toUpperCase(),
			address: organization.address ?? '',
			logoUrl: organization.logoUrl
		},
		employee: {
			fullName: formatEmployeeName(employee),
			employeeNumber: employee.employeeNumber,
			position: employee.jobTitle.toUpperCase(),
			status: EMPLOYMENT_STATUS_LABEL[employee.employmentType] ?? employee.employmentType
		},
		period: {
			periodLabel: `${shortDate(run.periodStart)} to  ${shortDate(run.periodEnd)}`,
			payDate: run.approvedAt ? shortDate(run.approvedAt) : shortDate(run.periodEnd),
			dailyRate: money(dailyRate),
			daysOfWork: String(attendance.daysOfWork),
			daysOfPresent: String(attendance.daysOfPresent),
			basicPay: money(entry.basicPay)
		},
		summary: {
			overtime: money(overtimeTotal),
			thirteenthMonth: money(pickAmount(THIRTEENTH_CODE)),
			allowance: money(allowanceTotal)
		},
		overtimeRows,
		adjustments,
		deductions,
		totals: {
			grossPay: money(entry.grossPay),
			deduction: money(entry.totalDeductions),
			netPay: money(entry.netPay)
		}
	}
}

// The payroll engine stores hours in a note-like `label` when it splits OT lines
// ("Regular OT (2.5h)"). If nothing parseable is found, fall back to the caller.
function hoursFromLabel(label: string): number | null {
	const m = label.match(/([\d.]+)\s*h/i)
	return m ? Number(m[1]) : null
}
