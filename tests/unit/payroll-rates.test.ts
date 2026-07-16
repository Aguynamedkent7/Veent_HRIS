import { describe, it, expect } from 'vitest'
import { ratesFromRule, DOLE_DEFAULT_RATES } from '$lib/server/services/payroll/rates'
import {
	computeEmployeeResult,
	type EmployeeComputeConfig
} from '$lib/server/services/payroll/calculator'
import { emptyAttendance, type EmployeeComp } from '$lib/server/services/payroll/types'

/**
 * #50 configurable premium-pay multipliers. Verifies the PayRateRule → PayRates conversion and that
 * cfg.rates actually threads into the earnings computation (so editing multipliers changes payroll).
 */

describe('ratesFromRule', () => {
	it('returns the DOLE defaults when there is no rule', () => {
		expect(ratesFromRule(null)).toEqual(DOLE_DEFAULT_RATES)
	})

	it('converts a PayRateRule row (Decimal-ish values) to numbers, keeping defaults for the rest', () => {
		const r = ratesFromRule({ overtime: '2.0', nightDiff: '0.25' })
		expect(r.overtime).toBe(2.0)
		expect(r.nightDiff).toBe(0.25)
		expect(r.restDay).toBe(DOLE_DEFAULT_RATES.restDay) // untouched → default
	})
})

describe('computeEmployeeResult — rates threading', () => {
	const comp: EmployeeComp = { basicMonthlySalary: 30000, rateType: 'MONTHLY' }
	const att = { ...emptyAttendance(), regularHours: 80, overtimeHours: 10 }
	const baseCfg: EmployeeComputeConfig = {
		taxableByCode: new Map(),
		periodShare: 0.5,
		loans: [],
		cashAdvances: []
	}
	const otOf = (r: ReturnType<typeof computeEmployeeResult>) =>
		r.earnings.find((e) => e.code === 'OT')?.amount ?? 0

	it('defaults to DOLE rates when cfg.rates is omitted', () => {
		expect(otOf(computeEmployeeResult(comp, att, {}, baseCfg))).toBeGreaterThan(0)
	})

	it('scales OT pay by the configured overtime multiplier', () => {
		const base = otOf(computeEmployeeResult(comp, att, {}, baseCfg))
		const hi = otOf(
			computeEmployeeResult(
				comp,
				att,
				{},
				{
					...baseCfg,
					rates: { ...DOLE_DEFAULT_RATES, overtime: 2.0 }
				}
			)
		)
		expect(hi).toBeCloseTo(base * (2.0 / DOLE_DEFAULT_RATES.overtime), 1)
	})
})
