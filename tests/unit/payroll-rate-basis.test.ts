import { describe, it, expect } from 'vitest'
import {
	computeEmployeeResult,
	type EmployeeComputeConfig
} from '$lib/server/services/payroll/calculator'
import {
	emptyAttendance,
	hourlyRateOf,
	monthlyBasisOf,
	type EmployeeComp,
	type AttendanceInput
} from '$lib/server/services/payroll/types'

/**
 * Regression coverage for #121 — late/undertime minutes were deducted twice: once by shrinking
 * `regularHours` (and therefore an hours-derived BASIC), and again as a TARDINESS line.
 *
 * The fix branches basic pay on `rateType`: MONTHLY staff are on a fixed salary and take explicit
 * TARDINESS/ABSENCE lines; everyone else is paid for hours actually worked and takes neither.
 *
 * Figures use ₱35,200/month over the default 22×8 = 176 hours → exactly ₱200/hr, so the expected
 * peso amounts are exact rather than rounded.
 */

const SALARY = 35200
const HR = 200 // 35200 / (22 * 8)
const PERIOD_HOURS = 88 // semi-monthly: 11 working days × 8h

const monthly: EmployeeComp = { basicMonthlySalary: SALARY, rateType: 'MONTHLY' }
// #120: for HOURLY staff the stored figure IS the hourly rate, not a monthly salary — so this is
// the same ₱200/hr as the monthly employee above, expressed the way HR now enters it.
const hourly: EmployeeComp = { basicMonthlySalary: HR, rateType: 'HOURLY' }

const att = (over: Partial<AttendanceInput> = {}): AttendanceInput => ({
	...emptyAttendance(),
	...over
})

const cfg = (over: Partial<EmployeeComputeConfig> = {}): EmployeeComputeConfig => ({
	taxableByCode: new Map(),
	periodShare: 0.5,
	expectedHours: PERIOD_HOURS,
	loans: [],
	cashAdvances: [],
	...over
})

const earning = (r: ReturnType<typeof computeEmployeeResult>, code: string) =>
	r.earnings.find((c) => c.code === code)?.amount ?? 0
const deduction = (r: ReturnType<typeof computeEmployeeResult>, code: string) =>
	r.deductions.find((c) => c.code === code)?.amount ?? 0

/** What the employee loses for unrendered time: basic minus what basic already withheld. */
const attendanceCost = (r: ReturnType<typeof computeEmployeeResult>, fullBasic: number) =>
	fullBasic - earning(r, 'BASIC') + deduction(r, 'TARDINESS') + deduction(r, 'ABSENCE')

describe('#121 — MONTHLY (fixed basic)', () => {
	it('pays a fixed basic that does not shrink with hours worked', () => {
		const full = computeEmployeeResult(monthly, att({ regularHours: PERIOD_HOURS }), {}, cfg())
		const short = computeEmployeeResult(monthly, att({ regularHours: 80 }), {}, cfg())

		expect(earning(full, 'BASIC')).toBeCloseTo(SALARY * 0.5, 2) // 17600
		expect(earning(short, 'BASIC')).toBeCloseTo(SALARY * 0.5, 2) // unchanged by hours
	})

	it('charges one hour of lateness exactly once (the #121 regression)', () => {
		// 1 hour late: derive.ts records BOTH regularHours 87 AND lateMinutes 60.
		const r = computeEmployeeResult(
			monthly,
			att({ regularHours: PERIOD_HOURS - 1, lateMinutes: 60 }),
			{},
			cfg()
		)

		expect(earning(r, 'BASIC')).toBeCloseTo(SALARY * 0.5, 2) // basic stays whole
		expect(deduction(r, 'TARDINESS')).toBeCloseTo(HR, 2) // charged once
		expect(deduction(r, 'ABSENCE')).toBe(0) // late minutes are NOT also an absence
		// Before the fix this was 2 × HR (₱400 for a ₱200 infraction).
		expect(attendanceCost(r, SALARY * 0.5)).toBeCloseTo(HR, 2)
	})

	it('charges undertime exactly once, by the same mechanism', () => {
		const r = computeEmployeeResult(
			monthly,
			att({ regularHours: PERIOD_HOURS - 1, undertimeMinutes: 60 }),
			{},
			cfg()
		)
		expect(deduction(r, 'TARDINESS')).toBeCloseTo(HR, 2)
		expect(deduction(r, 'ABSENCE')).toBe(0)
		expect(attendanceCost(r, SALARY * 0.5)).toBeCloseTo(HR, 2)
	})

	it('charges a full absent day as ABSENCE, not TARDINESS', () => {
		// One 8h day not worked at all: no punches, so no late/undertime minutes are recorded.
		const r = computeEmployeeResult(monthly, att({ regularHours: PERIOD_HOURS - 8 }), {}, cfg())

		expect(deduction(r, 'TARDINESS')).toBe(0)
		expect(deduction(r, 'ABSENCE')).toBeCloseTo(8 * HR, 2) // 1600
		expect(attendanceCost(r, SALARY * 0.5)).toBeCloseTo(8 * HR, 2)
	})

	it('combines an absent day and a late day without overlap', () => {
		// One full day absent (8h) + one hour late on another day.
		const r = computeEmployeeResult(
			monthly,
			att({ regularHours: PERIOD_HOURS - 9, lateMinutes: 60 }),
			{},
			cfg()
		)
		expect(deduction(r, 'TARDINESS')).toBeCloseTo(HR, 2)
		expect(deduction(r, 'ABSENCE')).toBeCloseTo(8 * HR, 2)
		expect(attendanceCost(r, SALARY * 0.5)).toBeCloseTo(9 * HR, 2)
	})

	it('emits no attendance deductions for a fully rendered period', () => {
		const r = computeEmployeeResult(monthly, att({ regularHours: PERIOD_HOURS }), {}, cfg())
		expect(deduction(r, 'TARDINESS')).toBe(0)
		expect(deduction(r, 'ABSENCE')).toBe(0)
		expect(attendanceCost(r, SALARY * 0.5)).toBe(0)
	})

	it('never credits overtime hours against an absence', () => {
		// Working beyond the schedule is paid as OT; it must not cancel out unworked regular hours.
		const r = computeEmployeeResult(
			monthly,
			att({ regularHours: PERIOD_HOURS - 8, overtimeHours: 10 }),
			{},
			cfg()
		)
		expect(deduction(r, 'ABSENCE')).toBeCloseTo(8 * HR, 2)
		expect(earning(r, 'OT')).toBeGreaterThan(0)
	})
})

describe('#121 — HOURLY (hours-derived basic)', () => {
	it('pays for hours actually worked', () => {
		const r = computeEmployeeResult(hourly, att({ regularHours: PERIOD_HOURS }), {}, cfg())
		expect(earning(r, 'BASIC')).toBeCloseTo(PERIOD_HOURS * HR, 2) // 17600
	})

	it('does not charge TARDINESS — the unworked hour is already unpaid', () => {
		const r = computeEmployeeResult(
			hourly,
			att({ regularHours: PERIOD_HOURS - 1, lateMinutes: 60 }),
			{},
			cfg()
		)

		expect(earning(r, 'BASIC')).toBeCloseTo((PERIOD_HOURS - 1) * HR, 2) // 17400
		expect(deduction(r, 'TARDINESS')).toBe(0)
		expect(deduction(r, 'ABSENCE')).toBe(0)
		// Same net outcome as the monthly employee: exactly one hour lost, no more.
		expect(attendanceCost(r, PERIOD_HOURS * HR)).toBeCloseTo(HR, 2)
	})

	it('does not charge ABSENCE for unworked days', () => {
		const r = computeEmployeeResult(hourly, att({ regularHours: PERIOD_HOURS - 8 }), {}, cfg())
		expect(deduction(r, 'ABSENCE')).toBe(0)
		expect(attendanceCost(r, PERIOD_HOURS * HR)).toBeCloseTo(8 * HR, 2)
	})
})

describe('#121 — both bases price unrendered time identically', () => {
	it('costs the same hour the same amount regardless of rate type', () => {
		const m = computeEmployeeResult(
			monthly,
			att({ regularHours: PERIOD_HOURS - 1, lateMinutes: 60 }),
			{},
			cfg()
		)
		const h = computeEmployeeResult(
			hourly,
			att({ regularHours: PERIOD_HOURS - 1, lateMinutes: 60 }),
			{},
			cfg()
		)
		expect(m.grossPay - h.grossPay).toBeCloseTo(HR, 2) // monthly gross still whole
		expect(m.netPay).toBeCloseTo(h.netPay, 2) // ...but nets converge after TARDINESS
	})
})

describe('#120 — the hourly rate is used as entered, never divided', () => {
	// The headline acceptance case from #120: before rateType was readable, this employee's
	// internal rate came out as 100/176 = ₱0.57 and they grossed ₱45.45 instead of ₱8,000.
	it('grosses ₱8,000 for an employee at ₱100/hr over 80 hours', () => {
		const r = computeEmployeeResult(
			{ basicMonthlySalary: 100, rateType: 'HOURLY' },
			att({ regularHours: 80 }),
			{},
			cfg({ expectedHours: 80 })
		)
		expect(earning(r, 'BASIC')).toBeCloseTo(8000, 2)
		expect(r.grossPay).toBeCloseTo(8000, 2)
	})

	it('projects an hourly rate to a monthly basis for statutory brackets', () => {
		// ₱200/hr × 176 h = ₱35,200/month, so an hourly employee must be assessed exactly like the
		// monthly employee on ₱35,200 — not floored into the lowest bracket on a ₱200 "salary".
		const h = computeEmployeeResult(hourly, att({ regularHours: PERIOD_HOURS }), {}, cfg())
		const m = computeEmployeeResult(monthly, att({ regularHours: PERIOD_HOURS }), {}, cfg())

		expect(monthlyBasisOf(hourly).toNumber()).toBeCloseTo(SALARY, 2)
		expect(h.statutory.sssEe).toBeCloseTo(m.statutory.sssEe, 2)
		expect(h.statutory.philhealthEe).toBeCloseTo(m.statutory.philhealthEe, 2)
		expect(h.statutory.pagibigEe).toBeCloseTo(m.statutory.pagibigEe, 2)
	})

	it('round-trips: hourlyRateOf and monthlyBasisOf are inverses', () => {
		expect(hourlyRateOf(monthly).toNumber()).toBeCloseTo(HR, 2)
		expect(hourlyRateOf(hourly).toNumber()).toBeCloseTo(HR, 2)
		expect(monthlyBasisOf(monthly).toNumber()).toBeCloseTo(SALARY, 2)
		expect(monthlyBasisOf(hourly).toNumber()).toBeCloseTo(SALARY, 2)
	})
})

/**
 * #189 restored DAILY (removed by #122). It is paid for time actually worked, like HOURLY, but
 * its stored figure is a per-DAY rate — so it converts through the day length, not the month.
 *
 * ₱1,600/day over an 8h day is the same ₱200/hr as the two employees above, which makes every
 * expected peso figure below directly comparable to the MONTHLY and HOURLY cases.
 */
const DAILY_RATE = 1600 // 200/hr × 8h
const daily: EmployeeComp = { basicMonthlySalary: DAILY_RATE, rateType: 'DAILY' }

describe('#189 — DAILY', () => {
	it('converts the daily rate through the day length, not the month', () => {
		// The trap: dividing ₱1,600 by the 176 monthly hours yields ₱9.09/hr and underpays 22×.
		expect(hourlyRateOf(daily).toNumber()).toBeCloseTo(HR, 2)
	})

	it('projects to a monthly basis by working days, for statutory brackets', () => {
		// SSS/PhilHealth brackets are defined on a monthly salary credit, so a daily rate has to
		// be projected before lookup or the employee lands in the lowest bracket.
		expect(monthlyBasisOf(daily).toNumber()).toBeCloseTo(SALARY, 2)
	})

	it('pays exactly the daily rate for a full day, and half for a half day', () => {
		const oneDay = computeEmployeeResult(daily, att({ regularHours: 8 }), {}, cfg())
		const halfDay = computeEmployeeResult(daily, att({ regularHours: 4 }), {}, cfg())
		expect(earning(oneDay, 'BASIC')).toBeCloseTo(DAILY_RATE, 2)
		expect(earning(halfDay, 'BASIC')).toBeCloseTo(DAILY_RATE / 2, 2)
	})

	it('matches the MONTHLY employee’s basic over a full period', () => {
		// Same effective rate, same hours → same basic, whichever way the rate was entered.
		const asDaily = computeEmployeeResult(daily, att({ regularHours: PERIOD_HOURS }), {}, cfg())
		const asHourly = computeEmployeeResult(hourly, att({ regularHours: PERIOD_HOURS }), {}, cfg())
		expect(earning(asDaily, 'BASIC')).toBeCloseTo(earning(asHourly, 'BASIC'), 2)
	})

	it('charges no TARDINESS or ABSENCE — unworked time is already unpaid (#121)', () => {
		// The double-deduction guard has to cover DAILY too: regularHours is already net of
		// lateness, so an hours-derived basic plus a TARDINESS line docks the same minutes twice.
		const short = computeEmployeeResult(
			daily,
			att({ regularHours: 80, lateMinutes: 120 }),
			{},
			cfg()
		)
		expect(deduction(short, 'TARDINESS')).toBe(0)
		expect(deduction(short, 'ABSENCE')).toBe(0)
		expect(attendanceCost(short, DAILY_RATE * 11)).toBeCloseTo(HR * 8, 2)
	})

	it('prices overtime off the converted hourly rate', () => {
		const shift = att({ regularHours: PERIOD_HOURS, overtimeHours: 2 })
		const asDaily = computeEmployeeResult(daily, shift, {}, cfg())
		const asHourly = computeEmployeeResult(hourly, shift, {}, cfg())
		// Asserted against the equivalent hourly employee rather than a hardcoded multiplier:
		// the claim is that OT keys off the converted ₱200/hr, not the raw ₱1,600 stored figure,
		// and that holds whatever the premium happens to be.
		expect(earning(asDaily, 'OT')).toBeGreaterThan(0)
		expect(earning(asDaily, 'OT')).toBeCloseTo(earning(asHourly, 'OT'), 2)
	})
})
