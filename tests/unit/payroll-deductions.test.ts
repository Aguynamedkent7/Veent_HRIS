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
		expect(computeTardiness(180, 60, 0)).toBeCloseTo(180, 2) // 1h late
		expect(computeTardiness(180, 30, 30)).toBeCloseTo(180, 2) // 30 late + 30 undertime = 1h
		expect(computeTardiness(180, 0, 0)).toBe(0)
	})
})

describe('applyAmortizations', () => {
	it('applies a fixed installment and reduces the balance + net', () => {
		const r = applyAmortizations([loan()], 10000)
		expect(r.applied).toHaveLength(1)
		expect(r.applied[0].amount).toBe(1000)
		expect(r.balances.L1).toBe(4000)
		expect(r.remainingNet).toBe(9000)
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
		expect(r.remainingNet).toBe(500)
	})

	it('applies items in order and stops covering once net is depleted', () => {
		const items = [loan({ refId: 'A', installment: 800 }), loan({ refId: 'B', installment: 800 })]
		const r = applyAmortizations(items, 1000)
		expect(r.applied.map((c) => c.refId)).toEqual(['A']) // B skipped, only 200 left
		expect(r.balances).toEqual({ A: 4200, B: 5000 })
	})
})

describe('computeDeductions — composition + ordering', () => {
	const statutory = { sssEe: 1350, philhealthEe: 750, pagibigEe: 100, withholdingTax: 1290 }

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
