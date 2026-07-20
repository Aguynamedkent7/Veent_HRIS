import { describe, it, expect } from 'vitest'
import {
	computeEmployeeResult,
	type EmployeeComputeConfig
} from '$lib/server/services/payroll/calculator'
import { emptyAttendance, type EmployeeComp } from '$lib/server/services/payroll/types'
import { D, sumQ } from '$lib/server/services/payroll/money'

/**
 * #119 acceptance — a payslip must always add up.
 *
 * Reconciliation is lines-authoritative: every line is computed exactly and quantized once, and
 * the totals are defined as the sum of those quantized lines. These properties are what Finance
 * would check by hand, so they are asserted EXACTLY (no `toBeCloseTo` tolerance anywhere).
 */

/** Deterministic LCG — a fixed seed keeps a failure reproducible, unlike Math.random. */
function* salaries(count: number): Generator<string> {
	let s = 12345
	for (let i = 0; i < count; i++) {
		s = (s * 1103515245 + 12345) % 2147483648
		const pesos = 8000 + (s % 92000) // ₱8k–₱100k, spanning every statutory bracket
		const centavos = s % 100
		yield `${pesos}.${String(centavos).padStart(2, '0')}`
	}
}

/** Salaries that land a statutory line exactly on a half-centavo — the hard cases. */
const HALF_CENT_CASES = [
	'10000.20', // PhilHealth: × 0.05 / 2 = 250.005
	'10000.60', // 250.015
	'12345.10',
	'20000.20',
	'33333.33', // repeating decimals into the hourly rate
	'50000.50'
]

const cfg = (over: Partial<EmployeeComputeConfig> = {}): EmployeeComputeConfig => ({
	taxableByCode: new Map(),
	periodShare: 0.5,
	expectedHours: 88,
	loans: [],
	cashAdvances: [],
	...over
})

const att = (over = {}) => ({ ...emptyAttendance(), ...over })

/** Every property a payslip must satisfy, asserted exactly. */
function assertReconciles(r: ReturnType<typeof computeEmployeeResult>, label: string) {
	const earningsSum = sumQ(r.earnings.map((c) => c.amount))
	const deductionsSum = sumQ(r.deductions.map((c) => c.amount))

	// 1. Printed earning lines sum to gross.
	expect(earningsSum.equals(D(r.grossPay)), `${label}: earnings must sum to gross`).toBe(true)

	// 2. Printed deduction lines sum to totalDeductions.
	expect(
		deductionsSum.equals(D(r.totalDeductions)),
		`${label}: deductions must sum to totalDeductions`
	).toBe(true)

	// 3. gross − totalDeductions == netPay, with no residual.
	expect(
		D(r.grossPay).minus(D(r.totalDeductions)).equals(D(r.netPay)),
		`${label}: gross - deductions must equal net`
	).toBe(true)

	// 4. Every published figure is a real payable amount at scale 2.
	for (const c of [...r.earnings, ...r.deductions]) {
		expect(D(c.amount).decimalPlaces(), `${label}: line ${c.code} must be scale-2`).toBeLessThanOrEqual(2)
	}
	for (const [name, v] of Object.entries({
		grossPay: r.grossPay,
		totalDeductions: r.totalDeductions,
		netPay: r.netPay,
		taxableGross: r.taxableGross
	})) {
		expect(D(v).decimalPlaces(), `${label}: ${name} must be scale-2`).toBeLessThanOrEqual(2)
	}
}

describe('#119 — payslip reconciliation (fuzz over centavo salaries)', () => {
	it('reconciles for 300 pseudo-random salaries with centavo values', () => {
		for (const salary of salaries(300)) {
			const comp: EmployeeComp = { basicMonthlySalary: salary, rateType: 'MONTHLY' }
			const r = computeEmployeeResult(comp, att({ regularHours: 88 }), {}, cfg())
			assertReconciles(r, `salary ${salary}`)
		}
	})

	it('reconciles on the half-centavo cases float arithmetic would perturb', () => {
		for (const salary of HALF_CENT_CASES) {
			for (const rateType of ['MONTHLY', 'HOURLY'] as const) {
				const comp: EmployeeComp = { basicMonthlySalary: salary, rateType }
				const r = computeEmployeeResult(comp, att({ regularHours: 88 }), {}, cfg())
				assertReconciles(r, `${rateType} ${salary}`)
			}
		}
	})

	it('reconciles with every line type present at once', () => {
		// Lateness, absence, allowances, incentives, a loan and a cash advance on one payslip —
		// the most lines that can round independently, which is where drift would surface.
		for (const salary of HALF_CENT_CASES) {
			const comp: EmployeeComp = { basicMonthlySalary: salary, rateType: 'MONTHLY' }
			const r = computeEmployeeResult(
				comp,
				att({ regularHours: 70, overtimeHours: 3.5, nightDiffHours: 2, lateMinutes: 45 }),
				{ allowances: 1234.56, incentives: 987.65 },
				cfg({
					loans: [{ refId: 'L1', label: 'Loan', installment: '833.33', balance: '5000.01' }],
					cashAdvances: [{ refId: 'A1', label: 'CA', installment: '416.67', balance: '1250.02' }],
					recurringDeductions: [
						{ code: 'UNIFORM', label: 'Uniform', amount: 333.33, taxable: false }
					]
				})
			)
			assertReconciles(r, `all-lines ${salary}`)
			// The deduction lines that actually round independently are all present.
			expect(r.deductions.length).toBeGreaterThanOrEqual(8)
		}
	})

	it('reconciles when deductions exceed gross (negative net, #103)', () => {
		// ROUND_HALF_UP is symmetric, unlike Math.round's half-toward-zero on negatives.
		const comp: EmployeeComp = { basicMonthlySalary: '9000.55', rateType: 'MONTHLY' }
		const r = computeEmployeeResult(
			comp,
			att({ regularHours: 20 }), // heavy absence against a fixed basic
			{},
			cfg({
				recurringDeductions: [
					{ code: 'BIG', label: 'Large deduction', amount: 9999.99, taxable: false }
				]
			})
		)
		expect(r.netPay).toBeLessThan(0)
		assertReconciles(r, 'negative net')
	})
})
