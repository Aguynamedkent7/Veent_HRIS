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

const comp: EmployeeComp = { basicMonthlySalary: 30000, rateType: 'MONTHLY' }
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

describe('computeEmployeeResult (shared run/calculator engine)', () => {
	it('computes gross, prorated statutory, and net for a monthly employee', () => {
		const r = computeEmployeeResult(comp, att({ regularHours: 80 }), {}, cfg())
		expect(r.grossPay).toBeCloseTo(13636.36, 2)
		expect(r.basicPay).toBeCloseTo(13636.36, 2)
		// monthly statutory (SSS 900 / PH 750 / PI 100 / tax 1483.4) × 0.5 period share
		expect(r.statutory.sssEe).toBeCloseTo(450, 2)
		expect(r.statutory.philhealthEe).toBeCloseTo(375, 2)
		expect(r.statutory.pagibigEe).toBeCloseTo(50, 2)
		expect(r.statutory.withholdingTax).toBeCloseTo(741.7, 2)
		expect(r.totalDeductions).toBeCloseTo(1616.7, 2)
		expect(r.netPay).toBeCloseTo(r.grossPay - r.totalDeductions, 2)
	})

	it('honors taxability from config (BASIC set non-taxable → taxableGross 0)', () => {
		const r = computeEmployeeResult(
			comp,
			att({ regularHours: 80 }),
			{},
			cfg({ taxableByCode: new Map([['BASIC', false]]) })
		)
		expect(r.taxableGross).toBe(0)
		expect(r.earnings.find((c) => c.code === 'BASIC')?.taxable).toBe(false)
	})

	it('deducts a loan installment on top of statutory', () => {
		const r = computeEmployeeResult(
			comp,
			att({ regularHours: 80 }),
			{},
			cfg({ loans: [{ refId: 'L1', label: 'Loan', installment: 1000, balance: 3000 }] })
		)
		expect(r.deductions.find((c) => c.code === 'LOAN')?.amount).toBe(1000)
		expect(r.totalDeductions).toBeCloseTo(1616.7 + 1000, 2)
		expect(r.netPay).toBeCloseTo(r.grossPay - r.totalDeductions, 2)
	})

	it('is deterministic for identical inputs (calculator == run guarantee)', () => {
		const a = computeEmployeeResult(
			comp,
			att({ regularHours: 80, overtimeHours: 5 }),
			{ allowances: 1000 },
			cfg()
		)
		const b = computeEmployeeResult(
			comp,
			att({ regularHours: 80, overtimeHours: 5 }),
			{ allowances: 1000 },
			cfg()
		)
		expect(a).toEqual(b)
	})
})
