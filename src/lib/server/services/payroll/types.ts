/**
 * Pure-engine types for payroll computation (PAY-002).
 * These carry no Prisma/DB coupling so the earnings/deductions engines stay unit-testable.
 */

export type RateType = 'MONTHLY' | 'DAILY' | 'HOURLY'

/** An employee's compensation basis. */
export interface EmployeeComp {
	basicMonthlySalary: number
	rateType: RateType
	/** Working days used to derive the daily/hourly rate. Default 22. */
	monthlyWorkingDays?: number
	/** Paid hours per working day. Default 8. */
	dailyWorkingHours?: number
}

/**
 * Hour buckets for one payroll period, produced by the attendance engine (Phase 11.3).
 * Buckets are mutually exclusive — an hour is counted in exactly one bucket. `*OtHours`
 * are overtime hours worked on that day-type; night-diff hours overlap the day-type buckets
 * and contribute only the night premium on top.
 */
export interface AttendanceInput {
	regularHours: number
	overtimeHours: number
	nightDiffHours: number
	restDayHours: number
	restDayOtHours: number
	regularHolidayHours: number
	regularHolidayOtHours: number
	specialHolidayHours: number
	specialHolidayOtHours: number
	lateMinutes: number
	undertimeMinutes: number
}

export function emptyAttendance(): AttendanceInput {
	return {
		regularHours: 0,
		overtimeHours: 0,
		nightDiffHours: 0,
		restDayHours: 0,
		restDayOtHours: 0,
		regularHolidayHours: 0,
		regularHolidayOtHours: 0,
		specialHolidayHours: 0,
		specialHolidayOtHours: 0,
		lateMinutes: 0,
		undertimeMinutes: 0
	}
}

/** Manual earnings not derived from attendance. */
export interface PayAdjustments {
	allowances?: number
	incentives?: number
}

/** One itemized payslip line (earning or deduction). */
export interface PayComponent {
	code: string
	label: string
	amount: number
	taxable: boolean
	/** For deductions tied to a record (loan/cash-advance id). */
	refId?: string
}

export interface EarningsResult {
	hourlyRate: number
	components: PayComponent[]
	gross: number
	taxableGross: number
	nonTaxableGross: number
}

export function round2(n: number): number {
	return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Derive the hourly rate from a monthly salary. */
export function hourlyRateOf(comp: EmployeeComp): number {
	const days = comp.monthlyWorkingDays ?? 22
	const hours = comp.dailyWorkingHours ?? 8
	return comp.basicMonthlySalary / (days * hours)
}
