import { describe, it, expect } from 'vitest'
import {
	computeTardiness,
	applyAmortizations,
	computeDeductions,
	type AmortItem
} from '$lib/server/services/payroll/deductions'

const loan = (over: Partial<AmortItem> = {}): AmortItem => ({
	refId: 'L1',
	label: 'SSS Loan',
	installment: 1000,
	balance: 5000,
	...over
})

describe('computeTardiness', () => {
	it('values unpaid minutes at the hourly rate', () => {
		// #119: exact `Decimal` now, so these hold to the last digit rather than to a tolerance.
		expect(computeTardiness(180, 60, 0).toNumber()).toBe(180) // 1h late
		expect(computeTardiness(180, 30, 30).toNumber()).toBe(180) // 30 late + 30 undertime = 1h
		expect(computeTardiness(180, 0, 0).toNumber()).toBe(0)
	})
})

describe('applyAmortizations', () => {
	it('applies a fixed installment and reduces the balance + net', () => {
		const r = applyAmortizations([loan()], 10000)
		expect(r.applied).toHaveLength(1)
		expect(r.applied[0].amount).toBe(1000)
		expect(r.balances.L1).toBe(4000)
		expect(r.remainingNet.toNumber()).toBe(9000)
	})

	it('caps the final installment at the remaining balance', () => {
		const r = applyAmortizations([loan({ balance: 700 })], 10000)
		expect(r.applied[0].amount).toBe(700)
		expect(r.balances.L1).toBe(0)
	})

	it('skips (does not partially apply) when net cannot cover the installment', () => {
		const r = applyAmortizations([loan()], 500)
		expect(r.applied).toHaveLength(0)
		expect(r.balances.L1).toBe(5000) // unchanged
		expect(r.remainingNet.toNumber()).toBe(500)
	})

	it('applies items in order and stops covering once net is depleted', () => {
		const items = [loan({ refId: 'A', installment: 800 }), loan({ refId: 'B', installment: 800 })]
		const r = applyAmortizations(items, 1000)
		expect(r.applied.map((c) => c.refId)).toEqual(['A']) // B skipped, only 200 left
		expect(r.balances).toEqual({ A: 4200, B: 5000 })
	})
})

/** Totals 3490 — shared by the composition and net-floor suites below. */
const statutory = { sssEe: 1350, philhealthEe: 750, pagibigEe: 100, withholdingTax: 1290 }

describe('computeDeductions — composition + ordering', () => {
	it('sums statutory + tax + tardiness and derives net', () => {
		const r = computeDeductions({
			gross: 15000,
			hourlyRate: 170.45,
			lateMinutes: 0,
			undertimeMinutes: 0,
			statutory
		})
		expect(r.total).toBeCloseTo(1350 + 750 + 100 + 1290, 2)
		expect(r.net).toBeCloseTo(15000 - r.total, 2)
		expect(r.components.map((c) => c.code)).toEqual([
			'SSS_EE',
			'PHILHEALTH_EE',
			'PAGIBIG_EE',
			'TAX'
		])
	})

	it('applies loans after mandatory deductions, against the remaining net', () => {
		const r = computeDeductions({
			gross: 15000,
			hourlyRate: 170.45,
			lateMinutes: 0,
			undertimeMinutes: 0,
			statutory,
			loans: [{ refId: 'L1', label: 'Pag-IBIG Loan', installment: 1000, balance: 3000 }]
		})
		expect(r.components.find((c) => c.code === 'LOAN')?.amount).toBe(1000)
		expect(r.loanBalances.L1).toBe(2000)
		expect(r.net).toBeCloseTo(15000 - (1350 + 750 + 100 + 1290 + 1000), 2)
	})

	it('applies recurring custom deductions as fixed lines before amortization (#66)', () => {
		const r = computeDeductions({
			gross: 15000,
			hourlyRate: 170.45,
			lateMinutes: 0,
			undertimeMinutes: 0,
			statutory,
			recurring: [
				{ code: 'UNIFORM', label: 'Uniform fee', amount: 250, taxable: false, refId: 'D1' }
			],
			loans: [{ refId: 'L1', label: 'Loan', installment: 1000, balance: 3000 }]
		})
		expect(r.components.map((c) => c.code)).toEqual([
			'SSS_EE',
			'PHILHEALTH_EE',
			'PAGIBIG_EE',
			'TAX',
			'UNIFORM',
			'LOAN'
		])
		expect(r.total).toBeCloseTo(1350 + 750 + 100 + 1290 + 250 + 1000, 2)
		expect(r.net).toBeCloseTo(15000 - r.total, 2)
	})

	it('recurring deductions reduce the net available to loans', () => {
		// Statutory (3490) + recurring 1000 leaves 510 of a 5000 gross — loan (1000) must skip.
		const r = computeDeductions({
			gross: 5000,
			hourlyRate: 170.45,
			lateMinutes: 0,
			undertimeMinutes: 0,
			statutory,
			recurring: [{ code: 'HMO_EXTRA', label: 'HMO dependent', amount: 1000, taxable: false }],
			loans: [{ refId: 'L1', label: 'Loan', installment: 1000, balance: 3000 }]
		})
		expect(r.components.some((c) => c.code === 'LOAN')).toBe(false)
		expect(r.loanBalances.L1).toBe(3000)
	})

	it('skips a loan when net after statutory is too small', () => {
		const r = computeDeductions({
			gross: 3500, // statutory (3490) leaves only 10
			hourlyRate: 170.45,
			lateMinutes: 0,
			undertimeMinutes: 0,
			statutory,
			loans: [{ refId: 'L1', label: 'Loan', installment: 1000, balance: 3000 }]
		})
		expect(r.components.some((c) => c.code === 'LOAN')).toBe(false)
		expect(r.loanBalances.L1).toBe(3000)
	})
})

describe('#103 — net never goes negative', () => {
	// The floor is achieved by not TAKING unaffordable lines, so `net === gross − Σ lines` (the
	// #119 lines-authoritative invariant) still holds. Clamping the total would break it.
	const sumLines = (r: { components: { amount: number }[] }) =>
		r.components.reduce((a, c) => a + c.amount, 0)

	it('skips a recurring deduction gross cannot fund, whole rather than partially', () => {
		const r = computeDeductions({
			gross: 5000,
			hourlyRate: 170.45,
			lateMinutes: 0,
			undertimeMinutes: 0,
			statutory, // 3490 → 1510 left
			recurring: [{ code: 'BIG', label: 'Big', amount: 4000, taxable: false }]
		})
		expect(r.components.some((c) => c.code === 'BIG')).toBe(false)
		expect(r.net).toBeCloseTo(1510, 2)
		expect(r.uncollected).toBeCloseTo(4000, 2)
		expect(r.net).toBeCloseTo(5000 - sumLines(r), 2)
	})

	it('takes an affordable recurring line ahead of loans, leaving net non-negative', () => {
		const r = computeDeductions({
			gross: 5000,
			hourlyRate: 170.45,
			lateMinutes: 0,
			undertimeMinutes: 0,
			statutory,
			recurring: [{ code: 'HMO', label: 'HMO', amount: 1000, taxable: false }],
			loans: [{ refId: 'L1', label: 'Loan', installment: 1000, balance: 3000 }]
		})
		expect(r.components.some((c) => c.code === 'HMO')).toBe(true)
		expect(r.components.some((c) => c.code === 'LOAN')).toBe(false) // only 510 left
		expect(r.loanBalances.L1).toBe(3000) // not collected → not decremented
		expect(r.net).toBeGreaterThanOrEqual(0)
		expect(r.uncollected).toBe(0)
	})

	it('credits UNRECOVERED when statutory alone exceeds gross, landing net on exactly 0', () => {
		const r = computeDeductions({
			gross: 1000, // statutory is 3490
			hourlyRate: 170.45,
			lateMinutes: 0,
			undertimeMinutes: 0,
			statutory,
			loans: [{ refId: 'L1', label: 'Loan', installment: 1000, balance: 3000 }]
		})
		expect(r.net).toBe(0)
		expect(r.components.find((c) => c.code === 'UNRECOVERED')?.amount).toBeCloseTo(-2490, 2)
		expect(r.uncollected).toBeCloseTo(2490, 2)
		expect(r.loanBalances.L1).toBe(3000) // nothing withheld → balance carried forward
		expect(r.net).toBeCloseTo(1000 - sumLines(r), 2)
	})
})
