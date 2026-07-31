import { describe, it, expect } from 'vitest'
import { compensationForPeriod, type CompRow } from '$lib/server/services/payroll/compensation'
import {
	computeEmployeeResult,
	type EmployeeComputeConfig
} from '$lib/server/services/payroll/calculator'
import {
	emptyAttendance,
	type EmployeeComp,
	type AttendanceInput
} from '$lib/server/services/payroll/types'
import { periodDays } from '$lib/utils/pay-periods'

/**
 * #170 decision B — statutory follows the comp effective on the FIRST calendar day of the period's
 * month, threaded through the engine as `statutoryComp`. A raise effective mid-month therefore only
 * lifts SSS/PhilHealth/Pag-IBIG/tax the FOLLOWING month, while basic pay recognises it in-period.
 *
 * PhilHealth is the discriminating contribution here: 30000 → ₱750/mo EE, 50000 → ₱1250/mo EE, so a
 * half-period share reads 375 vs 625 and the deferral is visible.
 */

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day))
const calDays = (s: Date, e: Date) => periodDays(s, e)
const MAY = 5
const first = { start: d(2026, MAY, 1), end: d(2026, MAY, 15) } // FIRST_HALF
const second = { start: d(2026, MAY, 16), end: d(2026, MAY, 31) } // SECOND_HALF
const FALLBACK = { basicMonthlySalary: 30000, rateType: 'MONTHLY' as const }

const row = (effYMD: [number, number, number], salary: number): CompRow => ({
	basicMonthlySalary: salary,
	rateType: 'MONTHLY',
	effectiveDate: d(...effYMD),
	changedAt: d(2000, 1, 1)
})

const att = (over: Partial<AttendanceInput> = {}): AttendanceInput => ({
	...emptyAttendance(),
	...over
})

const cfg = (over: Partial<EmployeeComputeConfig> = {}): EmployeeComputeConfig => ({
	taxableByCode: new Map([['BASIC', true]]),
	periodShare: 0.5,
	loans: [],
	cashAdvances: [],
	...over
})

/** Run the engine for a resolved period, feeding periodEnd → comp and statutoryBasis → statutoryComp. */
function runFor(hist: CompRow[], period: { start: Date; end: Date }) {
	const pc = compensationForPeriod(hist, period.start, period.end, 0.5, FALLBACK, calDays)
	const comp: EmployeeComp = {
		basicMonthlySalary: pc.periodEnd.salary,
		rateType: pc.periodEnd.rateType
	}
	const statutoryComp: EmployeeComp = {
		basicMonthlySalary: pc.statutoryBasis.salary,
		rateType: pc.statutoryBasis.rateType
	}
	const segments = pc.segments
	const basicSegments =
		segments.length > 1 && segments.every((s) => s.rateType === 'MONTHLY') ? segments : undefined
	return computeEmployeeResult(
		comp,
		att({ regularHours: 88 }),
		{},
		cfg({ periodShare: 0.5, statutoryComp, basicSegments })
	)
}

describe('#170 decision B — statutory uses the day-1-of-month comp', () => {
	it('a change effective on day 1 counts that month for statutory (new salary)', () => {
		const r = runFor([row([2024, 1, 1], 30000), row([2026, MAY, 1], 50000)], first)
		expect(r.statutory.philhealthEe).toBeCloseTo(625, 2) // 50000 basis
		expect(r.basicPay).toBeCloseTo(25000, 2) // 50000 × 0.5
	})

	it('a change effective day 2..EOM defers statutory to the OLD salary this month', () => {
		const r = runFor([row([2024, 1, 1], 30000), row([2026, MAY, 5], 50000)], first)
		// Statutory lags on the day-1 (30000) basis…
		expect(r.statutory.philhealthEe).toBeCloseTo(375, 2)
		// …while basic recognises the raise in-period (30000 for May 1–4, 50000 for May 5–15).
		// 30000·(0.5·4/15) + 50000·(0.5·11/15) = 4000 + 18333.33 = 22333.33.
		expect(r.basicPay).toBeCloseTo(22333.33, 2)
	})

	it('the SECOND_HALF of the change month still uses the day-1 (old) basis', () => {
		const r = runFor([row([2024, 1, 1], 30000), row([2026, MAY, 5], 50000)], second)
		// The change predates this period → one segment at the new salary, but statutory for the whole
		// month is anchored to day 1 (the old 30000).
		expect(r.statutory.philhealthEe).toBeCloseTo(375, 2)
		expect(r.basicPay).toBeCloseTo(25000, 2) // 50000 × 0.5
	})

	it('the FOLLOWING month picks the raise up for statutory (basis has caught up)', () => {
		const JUN = 6
		const june = { start: d(2026, JUN, 1), end: d(2026, JUN, 15) }
		const r = runFor([row([2024, 1, 1], 30000), row([2026, MAY, 5], 50000)], june)
		expect(r.statutory.philhealthEe).toBeCloseTo(625, 2) // 50000 basis from June 1
	})
})

describe('#170 — HOURLY statutory basis is projected to a monthly equivalent', () => {
	it('an HOURLY statutoryComp lands the same bracket as its monthly projection (× 176)', () => {
		const comp: EmployeeComp = { basicMonthlySalary: 30000, rateType: 'MONTHLY' }
		const attendance = att({ regularHours: 88 })

		const hourly = computeEmployeeResult(
			comp,
			attendance,
			{},
			cfg({ statutoryComp: { basicMonthlySalary: 200, rateType: 'HOURLY' } })
		)
		const projected = computeEmployeeResult(
			comp,
			attendance,
			{},
			cfg({ statutoryComp: { basicMonthlySalary: 200 * 176, rateType: 'MONTHLY' } })
		)
		// monthlyBasisOf(HOURLY 200) == 200 × (22×8) == 35200, so the statutory figures must match.
		expect(hourly.statutory).toEqual(projected.statutory)
		// And 35200 × 0.05 / 2 × 0.5 = 440 PhilHealth EE.
		expect(hourly.statutory.philhealthEe).toBeCloseTo(440, 2)
	})
})
