import { describe, it, expect } from 'vitest'
import {
	computeEmployeeResult,
	type EmployeeComputeConfig
} from '$lib/server/services/payroll/calculator'
import {
	emptyAttendance,
	type EmployeeComp,
	type AttendanceInput
} from '$lib/server/services/payroll/types'

/**
 * #163 × #173 Feature E — where the employee's statutory share lands when the run is a CUSTOM
 * range.
 *
 * FIRST/SECOND load the WHOLE monthly EE contribution onto one designated cutoff. A custom range
 * is not that cutoff, so it must take ZERO: otherwise a month with an off-cycle run would collect
 * more than 100% of the monthly EE contribution. The cutoff run itself still takes the full month.
 *
 * The guard rail: WHOLE_MONTH and `undefined` (the preview, which never supplies a kind) are
 * resolved FIRST and stay on `× share`. Neither may ever fall into the ZERO branch.
 * ER share and withholding tax always keep `× share`.
 */

const comp: EmployeeComp = { basicMonthlySalary: 30000, rateType: 'MONTHLY' }
const att = (over: Partial<AttendanceInput> = {}): AttendanceInput => ({
	...emptyAttendance(),
	...over
})
const base = (over: Partial<EmployeeComputeConfig> = {}): EmployeeComputeConfig => ({
	taxableByCode: new Map([['BASIC', true]]),
	periodShare: 0.5,
	loans: [],
	cashAdvances: [],
	...over
})

const MONTHLY_SSS_EE = 900
const CUSTOM_SHARE = 7 / 31
const firstAlloc = { sss: 'FIRST' as const, philhealth: 'EVEN' as const, pagibig: 'EVEN' as const }

const run = (over: Partial<EmployeeComputeConfig>) =>
	computeEmployeeResult(comp, att({ regularHours: 56 }), {}, base(over))

describe('resolveEE for a custom range', () => {
	it('kind null + FIRST → zero EE (the cutoff run collects it instead)', () => {
		const r = run({
			periodShare: CUSTOM_SHARE,
			periodKind: null,
			statutoryAllocations: firstAlloc
		})
		expect(r.statutory.sssEe).toBe(0)
		// ER share and tax are untouched by the allocation — still × share.
		expect(r.statutory.sssEr).toBeGreaterThan(0)
		expect(r.statutory.withholdingTax).toBeCloseTo(1463.4 * CUSTOM_SHARE, 2)
	})

	it('kind FIRST_HALF + FIRST → the full monthly EE', () => {
		const r = run({ periodShare: 0.5, periodKind: 'FIRST_HALF', statutoryAllocations: firstAlloc })
		expect(r.statutory.sssEe).toBe(MONTHLY_SSS_EE)
	})

	it('kind SECOND_HALF + FIRST → zero, as before', () => {
		const r = run({ periodShare: 0.5, periodKind: 'SECOND_HALF', statutoryAllocations: firstAlloc })
		expect(r.statutory.sssEe).toBe(0)
	})

	// The guard rail. WHOLE_MONTH is resolved before the FIRST/SECOND branches, so an adjustment
	// run keeps taking its `× share` slice even under a FIRST allocation.
	it('kind WHOLE_MONTH + FIRST → monthly × share', () => {
		const r = run({ periodShare: 1, periodKind: 'WHOLE_MONTH', statutoryAllocations: firstAlloc })
		expect(r.statutory.sssEe).toBe(MONTHLY_SSS_EE * 1)
	})

	it('kind undefined (the preview path) + FIRST → monthly × share', () => {
		const r = run({ periodShare: 0.5, statutoryAllocations: firstAlloc })
		expect(r.statutory.sssEe).toBe(MONTHLY_SSS_EE * 0.5)
	})

	it('kind null + EVEN → monthly × share', () => {
		const r = run({ periodShare: CUSTOM_SHARE, periodKind: null })
		expect(r.statutory.sssEe).toBeCloseTo(MONTHLY_SSS_EE * CUSTOM_SHARE, 2)
		expect(r.statutory.sssEr).toBeGreaterThan(0)
		expect(r.statutory.withholdingTax).toBeCloseTo(1463.4 * CUSTOM_SHARE, 2)
	})

	it('a month never exceeds 100% of the monthly EE: custom + cutoff = one month', () => {
		const custom = run({
			periodShare: CUSTOM_SHARE,
			periodKind: null,
			statutoryAllocations: firstAlloc
		})
		const cutoff = run({
			periodShare: 0.5,
			periodKind: 'FIRST_HALF',
			statutoryAllocations: firstAlloc
		})
		const other = run({
			periodShare: 0.5,
			periodKind: 'SECOND_HALF',
			statutoryAllocations: firstAlloc
		})
		expect(custom.statutory.sssEe + cutoff.statutory.sssEe + other.statutory.sssEe).toBe(
			MONTHLY_SSS_EE
		)
	})
})

/**
 * #163 (review round 2) — the custom-ONLY month. `cutoffRunExists` tells the engine whether the
 * cutoff run the allocation designates actually exists. It cannot always: the overlap guard
 * refuses the month's 1–15 run once a custom run covers those days, and a month whose only runs
 * are custom would otherwise collect NOTHING from the employee.
 */
describe('resolveEE when the designated cutoff run does not exist', () => {
	const noCutoff = { FIRST: false, SECOND: false }
	const bothCutoffs = { FIRST: true, SECOND: true }

	it('FIRST + no 1–15 run in the month → the custom range prorates by day count', () => {
		const r = run({
			periodShare: CUSTOM_SHARE,
			periodKind: null,
			statutoryAllocations: firstAlloc,
			cutoffRunExists: noCutoff
		})
		expect(r.statutory.sssEe).toBeCloseTo(MONTHLY_SSS_EE * CUSTOM_SHARE, 2)
	})

	it('FIRST + the 1–15 run exists → still zero, the cutoff run collects it', () => {
		const r = run({
			periodShare: CUSTOM_SHARE,
			periodKind: null,
			statutoryAllocations: firstAlloc,
			cutoffRunExists: bothCutoffs
		})
		expect(r.statutory.sssEe).toBe(0)
	})

	// The two halves are separate rows: a May 3–9 custom run blocks 1–15 but not 16–31, so one
	// may exist without the other and each allocation must read its own answer.
	it('SECOND reads the 16–EOM run, not the 1–15 one', () => {
		const secondAlloc = {
			sss: 'SECOND' as const,
			philhealth: 'EVEN' as const,
			pagibig: 'EVEN' as const
		}
		const withFirstOnly = run({
			periodShare: CUSTOM_SHARE,
			periodKind: null,
			statutoryAllocations: secondAlloc,
			cutoffRunExists: { FIRST: true, SECOND: false }
		})
		expect(withFirstOnly.statutory.sssEe).toBeCloseTo(MONTHLY_SSS_EE * CUSTOM_SHARE, 2)
		const withSecond = run({
			periodShare: CUSTOM_SHARE,
			periodKind: null,
			statutoryAllocations: secondAlloc,
			cutoffRunExists: { FIRST: false, SECOND: true }
		})
		expect(withSecond.statutory.sssEe).toBe(0)
	})

	// The guard rails, re-asserted with the flag present: neither may reach the ZERO branch, and
	// neither may be diverted by it.
	it('WHOLE_MONTH + FIRST → the full monthly amount regardless of the flag', () => {
		const r = run({
			periodShare: 1,
			periodKind: 'WHOLE_MONTH',
			statutoryAllocations: firstAlloc,
			cutoffRunExists: noCutoff
		})
		expect(r.statutory.sssEe).toBe(MONTHLY_SSS_EE)
	})

	it('FIRST_HALF + FIRST → the full monthly amount regardless of the flag', () => {
		const r = run({
			periodShare: 0.5,
			periodKind: 'FIRST_HALF',
			statutoryAllocations: firstAlloc,
			cutoffRunExists: noCutoff
		})
		expect(r.statutory.sssEe).toBe(MONTHLY_SSS_EE)
	})

	it('EVEN is untouched — × share either way', () => {
		for (const flag of [noCutoff, bothCutoffs]) {
			const r = run({ periodShare: CUSTOM_SHARE, periodKind: null, cutoffRunExists: flag })
			expect(r.statutory.sssEe).toBeCloseTo(MONTHLY_SSS_EE * CUSTOM_SHARE, 2)
		}
	})
})
