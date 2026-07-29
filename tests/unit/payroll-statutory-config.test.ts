import { describe, it, expect } from 'vitest'
import { Prisma } from '@prisma/client'
import {
	computeStatutoryDeductions,
	type StatutoryRates
} from '$lib/server/services/payroll/ph-statutory'
import {
	statutoryRatesFromConfig,
	sssBracketsSchema,
	taxBracketsSchema,
	statutoryRateInputSchema
} from '$lib/server/services/payroll/statutory-rates'

/**
 * #220 configurable statutory rate tables. The parity block is the safety gate: with no config the
 * engine must reproduce today's hardcoded numbers exactly. Then: overrides change the result, and
 * incoherent tables are rejected on save.
 */

const s = (m: { toString(): string }) => m.toString()

// Baselines captured from the pre-#220 hardcoded engine (SSS_TABLE_2024, BIR_MONTHLY_TAX_TABLE,
// PhilHealth 0.05/10000/100000, Pag-IBIG 0.02/100). Byte-for-byte, not a tolerance.
const PARITY: Record<
	string,
	{
		sssEe: string
		philhealthEe: string
		pagibigEe: string
		tax: string
		total: string
		net: string
	}
> = {
	'3000': {
		sssEe: '180',
		philhealthEe: '250',
		pagibigEe: '60',
		tax: '0',
		total: '490',
		net: '2510'
	},
	'15000': {
		sssEe: '675',
		philhealthEe: '375',
		pagibigEe: '100',
		tax: '0',
		total: '1150',
		net: '13850'
	},
	'30000': {
		sssEe: '900',
		philhealthEe: '750',
		pagibigEe: '100',
		tax: '1483.4',
		total: '3233.4',
		net: '26766.6'
	},
	'50000': {
		sssEe: '900',
		philhealthEe: '1250',
		pagibigEe: '100',
		tax: '6104.25',
		total: '8354.25',
		net: '41645.75'
	},
	'250000': {
		sssEe: '900',
		philhealthEe: '2500',
		pagibigEe: '100',
		tax: '66379.89',
		total: '69879.89',
		net: '180120.11'
	},
	'10000.20': {
		sssEe: '450',
		philhealthEe: '250.005',
		pagibigEe: '100',
		tax: '0',
		total: '800.005',
		net: '9200.195'
	}
}

describe('parity — no config row reproduces the hardcoded engine exactly', () => {
	for (const [salary, exp] of Object.entries(PARITY)) {
		it(`salary ${salary}`, () => {
			// Both the "no argument" path and the empty resolver output (statutoryRatesFromConfig(null))
			// must land on the exact hardcoded numbers.
			for (const rates of [undefined, statutoryRatesFromConfig(null)] as (
				StatutoryRates | undefined
			)[]) {
				const r = computeStatutoryDeductions(salary, rates)
				expect(s(r.sssEe)).toBe(exp.sssEe)
				expect(s(r.philhealthEe)).toBe(exp.philhealthEe)
				expect(s(r.pagibigEe)).toBe(exp.pagibigEe)
				expect(s(r.withholdingTax)).toBe(exp.tax)
				expect(s(r.totalDeductions)).toBe(exp.total)
				expect(s(r.netPay)).toBe(exp.net)
			}
		})
	}
})

describe('overrides change the computed deduction', () => {
	it('a raised tax-exempt threshold zeroes tax that the default would charge', () => {
		const rates: StatutoryRates = {
			taxBrackets: [
				{ floor: 0, ceiling: 50000, baseTax: 0, rate: 0, excessOver: 0 },
				{ floor: 50000, ceiling: Infinity, baseTax: 0, rate: 0.2, excessOver: 50000 }
			]
		}
		// 30000 gross → default tax 1483.40; with the exemption up to 50k it becomes 0.
		expect(s(computeStatutoryDeductions(30000).withholdingTax)).toBe('1483.4')
		expect(s(computeStatutoryDeductions(30000, rates).withholdingTax)).toBe('0')
	})

	it('an edited SSS bracket changes the EE share', () => {
		const rates: StatutoryRates = {
			sssBrackets: [
				{
					salaryFloor: 0,
					salaryCeiling: Infinity,
					totalContribution: 1500,
					eeShare: 500,
					erShare: 1000
				}
			]
		}
		expect(s(computeStatutoryDeductions(30000, rates).sssEe)).toBe('500')
	})

	it('an edited PhilHealth rate changes the EE share; scalars are independent of brackets', () => {
		const rates: StatutoryRates = { philhealth: { rate: '0.03' } }
		// 30000 clamped in-range → 30000 × 0.03 / 2 = 450 (default is 750). SSS/tax untouched.
		const r = computeStatutoryDeductions(30000, rates)
		expect(s(r.philhealthEe)).toBe('450')
		expect(s(r.sssEe)).toBe('900')
	})
})

describe('statutoryRatesFromConfig resolver', () => {
	it('null config yields an empty override set (all defaults)', () => {
		expect(statutoryRatesFromConfig(null)).toEqual({})
	})

	it('revives a null JSON ceiling back to Infinity and keeps exact Decimal rates', () => {
		const resolved = statutoryRatesFromConfig({
			philhealthRate: new Prisma.Decimal('0.0400'),
			sssBrackets: [
				{
					salaryFloor: 0,
					salaryCeiling: 9999.99,
					totalContribution: 1000,
					eeShare: 400,
					erShare: 600
				},
				{
					salaryFloor: 10000,
					salaryCeiling: null,
					totalContribution: 2000,
					eeShare: 800,
					erShare: 1200
				}
			]
		})
		expect(resolved.sssBrackets?.[1].salaryCeiling).toBe(Infinity)
		// A very high salary lands the open-ended top bracket (proves Infinity revival works).
		expect(s(computeStatutoryDeductions(500000, resolved).sssEe)).toBe('800')
		expect(s(computeStatutoryDeductions(30000, resolved).philhealthEe)).toBe('600') // 30000×0.04/2
	})
})

describe('validation rejects incoherent tables (trust boundary)', () => {
	const validSss = [
		{ salaryFloor: 0, salaryCeiling: 9999.99, totalContribution: 1000, eeShare: 400, erShare: 600 },
		{
			salaryFloor: 10000,
			salaryCeiling: null,
			totalContribution: 2000,
			eeShare: 800,
			erShare: 1200
		}
	]
	const validTax = [
		{ floor: 0, ceiling: 20833, baseTax: 0, rate: 0, excessOver: 0 },
		{ floor: 20833, ceiling: null, baseTax: 0, rate: 0.2, excessOver: 20833 }
	]

	it('accepts a well-formed SSS and tax table', () => {
		expect(sssBracketsSchema.safeParse(validSss).success).toBe(true)
		expect(taxBracketsSchema.safeParse(validTax).success).toBe(true)
	})

	it('rejects an unsorted SSS table', () => {
		const bad = [validSss[1], validSss[0]] // descending floors
		expect(sssBracketsSchema.safeParse(bad).success).toBe(false)
	})

	it('rejects an SSS table whose first bracket does not cover 0', () => {
		const bad = [{ ...validSss[0], salaryFloor: 5000 }, validSss[1]]
		expect(sssBracketsSchema.safeParse(bad).success).toBe(false)
	})

	it('rejects overlapping tax brackets', () => {
		const bad = [
			{ floor: 0, ceiling: 30000, baseTax: 0, rate: 0, excessOver: 0 },
			{ floor: 20833, ceiling: null, baseTax: 0, rate: 0.2, excessOver: 20833 } // floor < prev ceiling
		]
		expect(taxBracketsSchema.safeParse(bad).success).toBe(false)
	})

	it('rejects a tax rate outside [0,1]', () => {
		const bad = [
			{ floor: 0, ceiling: 20833, baseTax: 0, rate: 0, excessOver: 0 },
			{ floor: 20833, ceiling: null, baseTax: 0, rate: 1.5, excessOver: 20833 }
		]
		expect(taxBracketsSchema.safeParse(bad).success).toBe(false)
	})

	it('rejects a table whose last bracket is not open-ended', () => {
		const bad = [
			{ floor: 0, ceiling: 20833, baseTax: 0, rate: 0, excessOver: 0 },
			{ floor: 20833, ceiling: 999999, baseTax: 0, rate: 0.2, excessOver: 20833 }
		]
		expect(taxBracketsSchema.safeParse(bad).success).toBe(false)
	})

	it('rejects a full payload whose PhilHealth floor exceeds its ceiling', () => {
		const parsed = statutoryRateInputSchema.safeParse({
			philhealthRate: 0.05,
			philhealthFloor: 20000,
			philhealthCeiling: 10000,
			pagibigRate: 0.02,
			pagibigCap: 100,
			sssBrackets: null,
			taxBrackets: null
		})
		expect(parsed.success).toBe(false)
	})

	it('accepts a full payload that clears every override (all null)', () => {
		const parsed = statutoryRateInputSchema.safeParse({
			philhealthRate: null,
			philhealthFloor: null,
			philhealthCeiling: null,
			pagibigRate: null,
			pagibigCap: null,
			sssBrackets: null,
			taxBrackets: null
		})
		expect(parsed.success).toBe(true)
	})
})
