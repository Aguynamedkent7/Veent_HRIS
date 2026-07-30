/**
 * Pure-engine types for payroll computation (PAY-002).
 * These carry no Prisma/DB coupling so the earnings/deductions engines stay unit-testable.
 */

import { D, q2n, type Money, type MoneyLike } from './money'

/**
 * MONTHLY = fixed monthly salary, HOURLY = paid per hour worked, DAILY = paid per day worked
 * (#189 restored DAILY, which #122 had removed).
 */
export type RateType = 'MONTHLY' | 'DAILY' | 'HOURLY'

/** An employee's compensation basis. */
export interface EmployeeComp {
	/**
	 * The employee's pay figure, interpreted per `rateType` (#120): a fixed monthly salary when
	 * MONTHLY, a per-hour rate when HOURLY. The column kept its `basicMonthlySalary` name — use
	 * `hourlyRateOf` / `monthlyBasisOf` rather than reading it raw.
	 *
	 * Exact at the boundary (#119) — accepts a DB `Decimal` without a lossy `Number()` cast.
	 */
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

/**
 * One day-split segment of a mid-period pay change (#170/#171 Stage 2). Carries its OWN comp basis
 * (an hourly/daily rate change or a MONTHLY↔hourly flip changes `comp.rateType` between segments),
 * its working-day `weight` (Σ weight == periodShare), its own attendance slice, and its own
 * holiday-aware `expectedHours` (wd_i × dailyHours) — absence for a FIXED segment is valued against
 * THIS, never the whole period, so a flip can't charge one basis for the other's unowed hours.
 */
export interface ComputeSegment {
	comp: EmployeeComp
	weight: Money
	attendance: AttendanceInput
	expectedHours: number
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

/** Hours in a full month for this employee — the MONTHLY↔HOURLY conversion factor.
 *  The 22×8 defaults are a placeholder until they become configurable (#110). */
function monthlyHoursOf(comp: EmployeeComp): Money {
	return D(comp.monthlyWorkingDays ?? 22).times(dailyHoursOf(comp))
}

/** Paid hours in one working day — the DAILY↔HOURLY conversion factor (#189). */
function dailyHoursOf(comp: EmployeeComp): Money {
	return D(comp.dailyWorkingHours ?? 8)
}

/**
 * The employee's hourly rate, exactly (#119).
 *
 * `basicMonthlySalary` is interpreted per `rateType` (#120): for HOURLY staff it already IS the
 * hourly rate and must be used as-is — dividing it by 176 would underpay them 176× on every line.
 * For MONTHLY staff it is derived, and is a repeating decimal for most salaries
 * (₱30,000 / 176 = 170.4545…). It feeds OT, night differential, holiday premiums and the
 * tardiness/absence valuation, so it is carried at decimal.js precision and quantized only where
 * a payable line is produced, never here.
 */
export function hourlyRateOf(comp: EmployeeComp): Money {
	if (comp.rateType === 'HOURLY') return D(comp.basicMonthlySalary)
	// DAILY holds a per-day rate, so it converts through the day length rather than the month:
	// dividing by the full monthly hours would pay a ₱800/day employee ₱4.55/hr (#189).
	if (comp.rateType === 'DAILY') return D(comp.basicMonthlySalary).dividedBy(dailyHoursOf(comp))
	return D(comp.basicMonthlySalary).dividedBy(monthlyHoursOf(comp))
}

/**
 * The employee's monthly-equivalent basis — the inverse of `hourlyRateOf` (#120).
 *
 * SSS/PhilHealth brackets are defined on a monthly salary credit, so an HOURLY employee's rate has
 * to be projected to a month before bracket lookup. Without this a ₱200/hr employee is assessed as
 * if they earned ₱200 a month and lands in the lowest bracket.
 */
export function monthlyBasisOf(comp: EmployeeComp): Money {
	if (comp.rateType === 'MONTHLY') return D(comp.basicMonthlySalary)
	// A daily rate projects by working days, not by hours — ₱800/day × 22 = ₱17,600, whereas
	// going via the hourly rate and back would be the same number by a longer route.
	if (comp.rateType === 'DAILY')
		return D(comp.basicMonthlySalary).times(comp.monthlyWorkingDays ?? 22)
	return D(comp.basicMonthlySalary).times(monthlyHoursOf(comp))
}

/**
 * How basic pay is derived for this employee (#121).
 *
 * - `FIXED`   — MONTHLY staff are on a fixed monthly salary (client-confirmed). Basic does not
 *               vary with hours worked; unworked time comes off as explicit TARDINESS/ABSENCE
 *               deduction lines.
 * - `HOURLY`  — everyone else (HOURLY and DAILY) is paid for hours actually worked. Unworked
 *               time is unpaid by construction, so TARDINESS/ABSENCE must NOT also be charged.
 *               A DAILY employee reaches this path with their rate already converted to an
 *               hourly one, so a full day pays exactly the daily rate and a half day pays half.
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
