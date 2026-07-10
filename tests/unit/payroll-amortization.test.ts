import { describe, it, expect } from 'vitest'
import { applyAmortizations } from '$lib/server/services/payroll/deductions'

/** Simulate running the same loan through consecutive payroll periods. */
function amortizeAcrossPeriods(startBalance: number, installment: number, availableNet: number, periods: number) {
	let balance = startBalance
	const applied: number[] = []
	for (let i = 0; i < periods && balance > 0; i++) {
		const r = applyAmortizations([{ refId: 'L', label: 'Loan', installment, balance }], availableNet)
		applied.push(r.applied[0]?.amount ?? 0)
		balance = r.balances.L
	}
	return { applied, balance }
}

describe('multi-period amortization (PAY-023)', () => {
	it('amortizes a loan to exactly zero, capping the final installment', () => {
		const { applied, balance } = amortizeAcrossPeriods(3500, 1000, 10000, 6)
		expect(applied).toEqual([1000, 1000, 1000, 500])
		expect(balance).toBe(0)
	})

	it('skips a period entirely when net cannot cover the installment (no partial, no carry)', () => {
		const r = applyAmortizations([{ refId: 'L', label: 'Loan', installment: 1000, balance: 2000 }], 500)
		expect(r.applied).toHaveLength(0)
		expect(r.balances.L).toBe(2000) // unchanged — resumes next period
	})

	it('a skipped period does not accelerate later periods (installment stays fixed)', () => {
		// period 1: net too low → skip; period 2: net fine → normal 1000 installment
		let balance = 2000
		const skip = applyAmortizations([{ refId: 'L', label: 'Loan', installment: 1000, balance }], 400)
		balance = skip.balances.L
		const next = applyAmortizations([{ refId: 'L', label: 'Loan', installment: 1000, balance }], 10000)
		expect(next.applied[0].amount).toBe(1000)
		expect(next.balances.L).toBe(1000)
	})
})
