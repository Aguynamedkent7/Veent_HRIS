import { describe, it, expect } from 'vitest'
import {
	computeSSS,
	computePhilhealth,
	computePagibig,
	computeWithholdingTax,
	computeStatutoryDeductions
} from '$lib/server/services/payroll/ph-statutory'

describe('SSS', () => {
	it('applies minimum bracket for salary below floor', () => {
		const { ee, er } = computeSSS(3000)
		expect(ee).toBe(180)
		expect(er).toBe(390)
	})

	it('applies maximum bracket for salary above ceiling', () => {
		const { ee } = computeSSS(25000)
		expect(ee).toBe(900)
	})

	it('applies correct mid-bracket', () => {
		const { ee, er } = computeSSS(15000)
		expect(ee).toBe(675)
		expect(er).toBe(1380)
	})
})

describe('PhilHealth', () => {
	it('floors at minimum MSC for low salary', () => {
		const { ee } = computePhilhealth(5000)
		expect(ee).toBe(250) // 10000 * 0.05 / 2
	})

	it('caps at maximum MSC for high salary', () => {
		const { ee } = computePhilhealth(200000)
		expect(ee).toBe(2500) // 100000 * 0.05 / 2
	})

	it('computes proportionally in normal range', () => {
		const { ee } = computePhilhealth(30000)
		expect(ee).toBe(750) // 30000 * 0.05 / 2
	})
})

describe('Pag-IBIG', () => {
	it('caps at PHP 100 EE share', () => {
		const { ee } = computePagibig(20000)
		expect(ee).toBe(100)
	})

	it('applies 2% for low earner', () => {
		const { ee } = computePagibig(3000)
		expect(ee).toBe(60)
	})
})

describe('BIR Withholding Tax', () => {
	it('returns 0 for income below first bracket', () => {
		expect(computeWithholdingTax(20000)).toBe(0)
	})

	it('computes tax for 2nd bracket', () => {
		const tax = computeWithholdingTax(25000)
		expect(tax).toBeCloseTo(20 * (25000 - 20833) / 100, 0)
	})
})

describe('computeStatutoryDeductions', () => {
	it('netPay = grossPay - totalDeductions', () => {
		const result = computeStatutoryDeductions(30000)
		expect(result.netPay).toBeCloseTo(30000 - result.totalDeductions, 1)
	})

	it('totalDeductions includes all EE contributions + tax', () => {
		const r = computeStatutoryDeductions(30000)
		const manual = r.sssEe + r.philhealthEe + r.pagibigEe + r.withholdingTax
		expect(r.totalDeductions).toBeCloseTo(manual, 1)
	})
})
