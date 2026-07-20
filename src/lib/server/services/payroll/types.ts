/**
 * Pure-engine types for payroll computation (PAY-002).
 * These carry no Prisma/DB coupling so the earnings/deductions engines stay unit-testable.
 */

import { D, q2n, type Money, type MoneyLike } from './money'

export type RateType = 'MONTHLY' | 'DAILY' | 'HOURLY'

/** An employee's compensation basis. */
export interface EmployeeComp {
	/** Exact at the boundary (#119) — accepts a DB `Decimal` without a lossy `Number()` cast. */
	basicMonthlySalary: MoneyLike
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

/**
 * Quantize to centavos. Thin alias over the single quantize helper in `money.ts` (#119) so there
 * is exactly ONE rounding policy in the engine: exact decimal, ROUND_HALF_UP.
 *
 * Prefer `q2`/`q2n` from `./money` in new code — this alias exists for boundary call sites that
 * already hold a plain `number`. It must never appear mid-pipeline: intermediate rounding is the
 * defect #119 exists to remove.
 */
export function round2(n: number): number {
	return q2n(n)
}

/**
 * Derive the hourly rate from a monthly salary, exactly (#119).
 *
 * This is a repeating decimal for most salaries (₱30,000 / 176 = 170.4545…) and it feeds OT,
 * night differential, holiday premiums and the tardiness/absence valuation — so it is carried at
 * decimal.js precision and quantized only where a payable line is produced, never here.
 */
export function hourlyRateOf(comp: EmployeeComp): Money {
	const days = comp.monthlyWorkingDays ?? 22
	const hours = comp.dailyWorkingHours ?? 8
	return D(comp.basicMonthlySalary).dividedBy(D(days).times(hours))
}

/**
 * How basic pay is derived for this employee (#121).
 *
 * - `FIXED`   — MONTHLY staff are on a fixed monthly salary (client-confirmed). Basic does not
 *               vary with hours worked; unworked time comes off as explicit TARDINESS/ABSENCE
 *               deduction lines.
 * - `HOURLY`  — everyone else is paid for hours actually worked. Unworked time is unpaid by
 *               construction, so TARDINESS/ABSENCE must NOT also be charged.
 *
 * Charging both is the double-deduction of #121: `regularHours` is already net of lateness, so
 * an hours-derived basic plus a TARDINESS line docks the same minutes twice.
 */
export function basicPayBasis(comp: EmployeeComp): 'FIXED' | 'HOURLY' {
	return comp.rateType === 'MONTHLY' ? 'FIXED' : 'HOURLY'
}

/** Full-period paid hours a fixed-basic employee is expected to render. */
export function expectedHoursOf(comp: EmployeeComp, periodShare: number): number {
	const days = comp.monthlyWorkingDays ?? 22
	const hours = comp.dailyWorkingHours ?? 8
	return days * hours * periodShare
}

/**
 * Unworked hours to charge a fixed-basic employee, EXCLUDING late/undertime minutes — those are
 * already charged by the TARDINESS line, and counting them here too would re-introduce #121.
 */
export function absenceHoursOf(att: AttendanceInput, expectedHours: number): number {
	const creditedHours = att.regularHours + (att.lateMinutes + att.undertimeMinutes) / 60
	return Math.max(0, expectedHours - creditedHours)
}
