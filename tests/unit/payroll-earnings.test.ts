import { describe, it, expect } from 'vitest'
import { computeEarnings } from '$lib/server/services/payroll/earnings'
import {
	emptyAttendance,
	type EmployeeComp,
	type AttendanceInput
} from '$lib/server/services/payroll/types'

const comp: EmployeeComp = { basicMonthlySalary: 30000, rateType: 'MONTHLY' } // 30000/(22*8) = 170.4545/hr
const att = (over: Partial<AttendanceInput> = {}): AttendanceInput => ({
	...emptyAttendance(),
	...over
})
const amt = (r: ReturnType<typeof computeEarnings>, code: string) =>
	r.components.find((c) => c.code === code)?.amount ?? 0

describe('computeEarnings — hourly rate + basic', () => {
	it('derives the hourly rate from monthly salary / (days*hours)', () => {
		const r = computeEarnings(comp, att({ regularHours: 80 }))
		expect(r.hourlyRate).toBeCloseTo(170.45, 2)
	})

	// #121: BASIC is hours-derived only for hourly staff — MONTHLY employees are on a fixed salary
	// and their basic does not vary with `regularHours` (the FIXED case below).
	// #120: and an HOURLY employee's stored figure IS their hourly rate, used as-is rather than
	// divided by 176 — dividing would pay ₱200/hr staff ₱1.14/hr.
	it('pays hourly staff for hours actually worked, at their stated rate', () => {
		const r = computeEarnings(
			{ basicMonthlySalary: 200, rateType: 'HOURLY' },
			att({ regularHours: 80 })
		)
		expect(r.hourlyRate).toBeCloseTo(200, 2)
		expect(amt(r, 'BASIC')).toBeCloseTo(16000, 2)
	})

	it('ignores the working-days divisor for hourly staff — there is nothing to divide', () => {
		const r = computeEarnings(
			{ basicMonthlySalary: 200, rateType: 'HOURLY', monthlyWorkingDays: 20, dailyWorkingHours: 8 },
			att({ regularHours: 8 })
		)
		expect(amt(r, 'BASIC')).toBeCloseTo(1600, 2)
	})

	it('respects custom working days/hours when deriving a monthly salary', () => {
		const r = computeEarnings(
			{ ...comp, monthlyWorkingDays: 20, dailyWorkingHours: 8 },
			att({ regularHours: 8, overtimeHours: 1 })
		)
		// 30000/(20*8) = 187.5/hr, which prices the OT line (basic is fixed for MONTHLY staff).
		expect(r.hourlyRate).toBeCloseTo(187.5, 2)
	})

	it('pays MONTHLY staff a fixed basic, prorated to the period (#121)', () => {
		const full = computeEarnings(comp, att({ regularHours: 80 }))
		expect(amt(full, 'BASIC')).toBeCloseTo(30000, 2)

		const half = computeEarnings(comp, att({ regularHours: 80 }), {}, undefined, {
			periodShare: 0.5
		})
		expect(amt(half, 'BASIC')).toBeCloseTo(15000, 2)
	})
})

describe('computeEarnings — premiums use DOLE default multipliers', () => {
	const hr = 30000 / (22 * 8)
	it('overtime = base × 1.25', () => {
		expect(amt(computeEarnings(comp, att({ overtimeHours: 10 })), 'OT')).toBeCloseTo(
			10 * hr * 1.25,
			2
		)
	})
	it('night differential = base × 0.10 (premium only)', () => {
		expect(amt(computeEarnings(comp, att({ nightDiffHours: 8 })), 'NIGHT_DIFF')).toBeCloseTo(
			8 * hr * 0.1,
			2
		)
	})
	it('rest day = base × 1.30', () => {
		expect(amt(computeEarnings(comp, att({ restDayHours: 8 })), 'REST_DAY')).toBeCloseTo(
			8 * hr * 1.3,
			2
		)
	})
	it('regular holiday = base × 2.00', () => {
		expect(amt(computeEarnings(comp, att({ regularHolidayHours: 8 })), 'REG_HOLIDAY')).toBeCloseTo(
			8 * hr * 2,
			2
		)
	})
	it('special holiday = base × 1.30', () => {
		expect(
			amt(computeEarnings(comp, att({ specialHolidayHours: 8 })), 'SPECIAL_HOLIDAY')
		).toBeCloseTo(8 * hr * 1.3, 2)
	})
})

describe('computeEarnings — stacked day-type overtime', () => {
	const hr = 30000 / (22 * 8)
	it('rest-day OT = base × restDay × overtimePremium (1.69)', () => {
		expect(amt(computeEarnings(comp, att({ restDayOtHours: 4 })), 'REST_DAY_OT')).toBeCloseTo(
			4 * hr * 1.3 * 1.3,
			2
		)
	})
	it('regular-holiday OT = base × 2.00 × 1.30 (2.60)', () => {
		expect(
			amt(computeEarnings(comp, att({ regularHolidayOtHours: 2 })), 'REG_HOLIDAY_OT')
		).toBeCloseTo(2 * hr * 2 * 1.3, 2)
	})
})

describe('computeEarnings — taxability + totals', () => {
	it('allowances are non-taxable; incentives are taxable', () => {
		const r = computeEarnings(comp, att({ regularHours: 80 }), {
			allowances: 2000,
			incentives: 1500
		})
		expect(amt(r, 'ALLOWANCE')).toBe(2000)
		expect(amt(r, 'INCENTIVE')).toBe(1500)
		expect(r.gross).toBeCloseTo(r.taxableGross + r.nonTaxableGross, 2)
		expect(r.nonTaxableGross).toBeCloseTo(2000, 2) // only the allowance
	})

	it('omits zero-value components', () => {
		const r = computeEarnings(comp, att({ regularHours: 80 }))
		expect(r.components.map((c) => c.code)).toEqual(['BASIC'])
	})
})

describe('computeEarnings — configurable rates', () => {
	it('applies an overtime rate override from config', () => {
		const hr = 30000 / (22 * 8)
		const r = computeEarnings(comp, att({ overtimeHours: 10 }), {}, { overtime: 1.5 })
		expect(amt(r, 'OT')).toBeCloseTo(10 * hr * 1.5, 2)
	})
})
