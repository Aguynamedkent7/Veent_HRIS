/**
 * Philippines statutory deductions per TRAIN Law and latest contribution tables.
 * SSS: per EC table (January 2024 schedule), PhilHealth: 5% of MSC, Pag-IBIG: 2% capped PHP 100.
 */

import { round2 } from './types'

interface SSSBracket {
	salaryFloor: number
	salaryCeiling: number
	totalContribution: number
	eeShare: number
	erShare: number
}

export const SSS_TABLE_2024: SSSBracket[] = [
	{ salaryFloor: 0, salaryCeiling: 4249.99, totalContribution: 570, eeShare: 180, erShare: 390 },
	{
		salaryFloor: 4250,
		salaryCeiling: 4749.99,
		totalContribution: 637.5,
		eeShare: 202.5,
		erShare: 435
	},
	{ salaryFloor: 4750, salaryCeiling: 5249.99, totalContribution: 705, eeShare: 225, erShare: 480 },
	{
		salaryFloor: 5250,
		salaryCeiling: 5749.99,
		totalContribution: 772.5,
		eeShare: 247.5,
		erShare: 525
	},
	{ salaryFloor: 5750, salaryCeiling: 6249.99, totalContribution: 840, eeShare: 270, erShare: 570 },
	{
		salaryFloor: 6250,
		salaryCeiling: 6749.99,
		totalContribution: 907.5,
		eeShare: 292.5,
		erShare: 615
	},
	{ salaryFloor: 6750, salaryCeiling: 7249.99, totalContribution: 975, eeShare: 315, erShare: 660 },
	{
		salaryFloor: 7250,
		salaryCeiling: 7749.99,
		totalContribution: 1042.5,
		eeShare: 337.5,
		erShare: 705
	},
	{
		salaryFloor: 7750,
		salaryCeiling: 8249.99,
		totalContribution: 1110,
		eeShare: 360,
		erShare: 750
	},
	{
		salaryFloor: 8250,
		salaryCeiling: 8749.99,
		totalContribution: 1177.5,
		eeShare: 382.5,
		erShare: 795
	},
	{
		salaryFloor: 8750,
		salaryCeiling: 9249.99,
		totalContribution: 1245,
		eeShare: 405,
		erShare: 840
	},
	{
		salaryFloor: 9250,
		salaryCeiling: 9749.99,
		totalContribution: 1312.5,
		eeShare: 427.5,
		erShare: 885
	},
	{
		salaryFloor: 9750,
		salaryCeiling: 10249.99,
		totalContribution: 1380,
		eeShare: 450,
		erShare: 930
	},
	{
		salaryFloor: 10250,
		salaryCeiling: 10749.99,
		totalContribution: 1447.5,
		eeShare: 472.5,
		erShare: 975
	},
	{
		salaryFloor: 10750,
		salaryCeiling: 11249.99,
		totalContribution: 1515,
		eeShare: 495,
		erShare: 1020
	},
	{
		salaryFloor: 11250,
		salaryCeiling: 11749.99,
		totalContribution: 1582.5,
		eeShare: 517.5,
		erShare: 1065
	},
	{
		salaryFloor: 11750,
		salaryCeiling: 12249.99,
		totalContribution: 1650,
		eeShare: 540,
		erShare: 1110
	},
	{
		salaryFloor: 12250,
		salaryCeiling: 12749.99,
		totalContribution: 1717.5,
		eeShare: 562.5,
		erShare: 1155
	},
	{
		salaryFloor: 12750,
		salaryCeiling: 13249.99,
		totalContribution: 1785,
		eeShare: 585,
		erShare: 1200
	},
	{
		salaryFloor: 13250,
		salaryCeiling: 13749.99,
		totalContribution: 1852.5,
		eeShare: 607.5,
		erShare: 1245
	},
	{
		salaryFloor: 13750,
		salaryCeiling: 14249.99,
		totalContribution: 1920,
		eeShare: 630,
		erShare: 1290
	},
	{
		salaryFloor: 14250,
		salaryCeiling: 14749.99,
		totalContribution: 1987.5,
		eeShare: 652.5,
		erShare: 1335
	},
	{
		salaryFloor: 14750,
		salaryCeiling: 15249.99,
		totalContribution: 2055,
		eeShare: 675,
		erShare: 1380
	},
	{
		salaryFloor: 15250,
		salaryCeiling: 15749.99,
		totalContribution: 2122.5,
		eeShare: 697.5,
		erShare: 1425
	},
	{
		salaryFloor: 15750,
		salaryCeiling: 16249.99,
		totalContribution: 2190,
		eeShare: 720,
		erShare: 1470
	},
	{
		salaryFloor: 16250,
		salaryCeiling: 16749.99,
		totalContribution: 2257.5,
		eeShare: 742.5,
		erShare: 1515
	},
	{
		salaryFloor: 16750,
		salaryCeiling: 17249.99,
		totalContribution: 2325,
		eeShare: 765,
		erShare: 1560
	},
	{
		salaryFloor: 17250,
		salaryCeiling: 17749.99,
		totalContribution: 2392.5,
		eeShare: 787.5,
		erShare: 1605
	},
	{
		salaryFloor: 17750,
		salaryCeiling: 18249.99,
		totalContribution: 2460,
		eeShare: 810,
		erShare: 1650
	},
	{
		salaryFloor: 18250,
		salaryCeiling: 18749.99,
		totalContribution: 2527.5,
		eeShare: 832.5,
		erShare: 1695
	},
	{
		salaryFloor: 18750,
		salaryCeiling: 19249.99,
		totalContribution: 2595,
		eeShare: 855,
		erShare: 1740
	},
	{
		salaryFloor: 19250,
		salaryCeiling: 19749.99,
		totalContribution: 2662.5,
		eeShare: 877.5,
		erShare: 1785
	},
	{
		salaryFloor: 19750,
		salaryCeiling: 20249.99,
		totalContribution: 2730,
		eeShare: 900,
		erShare: 1830
	},
	{
		salaryFloor: 20250,
		salaryCeiling: Infinity,
		totalContribution: 2880,
		eeShare: 900,
		erShare: 1980
	}
]

export function computeSSS(monthlySalary: number): { ee: number; er: number } {
	const bracket =
		SSS_TABLE_2024.find(
			(b) => monthlySalary >= b.salaryFloor && monthlySalary <= b.salaryCeiling
		) ?? SSS_TABLE_2024[SSS_TABLE_2024.length - 1]

	return { ee: bracket.eeShare, er: bracket.erShare }
}

export function computePhilhealth(monthlySalary: number): { ee: number; er: number } {
	const RATE = 0.05
	const FLOOR = 10000
	const CEILING = 100000

	const msc = Math.min(Math.max(monthlySalary, FLOOR), CEILING)
	const totalContrib = msc * RATE
	const share = totalContrib / 2

	return { ee: share, er: share }
}

export function computePagibig(monthlySalary: number): { ee: number; er: number } {
	const RATE = 0.02
	const CAP = 100

	const ee = Math.min(monthlySalary * RATE, CAP)
	const er = Math.min(monthlySalary * RATE, CAP)

	return { ee, er }
}

interface TaxBracket {
	floor: number
	ceiling: number
	baseTax: number
	rate: number
	excessOver: number
}

export const BIR_MONTHLY_TAX_TABLE: TaxBracket[] = [
	{ floor: 0, ceiling: 20833, baseTax: 0, rate: 0, excessOver: 0 },
	{ floor: 20833, ceiling: 33332, baseTax: 0, rate: 0.2, excessOver: 20833 },
	{ floor: 33333, ceiling: 66666, baseTax: 2500, rate: 0.25, excessOver: 33333 },
	{ floor: 66667, ceiling: 166666, baseTax: 10833.33, rate: 0.3, excessOver: 66667 },
	{ floor: 166667, ceiling: 666666, baseTax: 40833.33, rate: 0.32, excessOver: 166667 },
	{ floor: 666667, ceiling: Infinity, baseTax: 200833.33, rate: 0.35, excessOver: 666667 }
]

export function computeWithholdingTax(taxableMonthlyIncome: number): number {
	const bracket =
		BIR_MONTHLY_TAX_TABLE.find(
			(b) => taxableMonthlyIncome >= b.floor && taxableMonthlyIncome <= b.ceiling
		) ?? BIR_MONTHLY_TAX_TABLE[BIR_MONTHLY_TAX_TABLE.length - 1]

	return bracket.baseTax + (taxableMonthlyIncome - bracket.excessOver) * bracket.rate
}

export interface StatutoryResult {
	sssEe: number
	sssEr: number
	philhealthEe: number
	philhealthEr: number
	pagibigEe: number
	pagibigEr: number
	withholdingTax: number
	totalDeductions: number
	netPay: number
}

export function computeStatutoryDeductions(grossPay: number): StatutoryResult {
	const sss = computeSSS(grossPay)
	const ph = computePhilhealth(grossPay)
	const pi = computePagibig(grossPay)

	const totalEeDeductions = sss.ee + ph.ee + pi.ee
	const taxableIncome = grossPay - totalEeDeductions
	const tax = Math.max(0, computeWithholdingTax(taxableIncome))

	const totalDeductions = totalEeDeductions + tax
	const netPay = grossPay - totalDeductions

	return {
		sssEe: round2(sss.ee),
		sssEr: round2(sss.er),
		philhealthEe: round2(ph.ee),
		philhealthEr: round2(ph.er),
		pagibigEe: round2(pi.ee),
		pagibigEr: round2(pi.er),
		withholdingTax: round2(tax),
		totalDeductions: round2(totalDeductions),
		netPay: round2(netPay)
	}
}
