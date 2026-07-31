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
import { D } from '$lib/server/services/payroll/money'

/**
 * #170 Stage 1 — the PARITY gate for the engine wiring. The two new optional inputs
 * (`statutoryComp`, `basicSegments`) must reduce to today's numbers whenever the period carries no
 * real change: passing `statutoryComp === comp` and a single full-period `basicSegments` (weight ==
 * periodShare) must produce a result byte-for-byte equal to passing neither. This is what lets the
 * run add the wiring for every employee while only the ones that actually changed pay see new math.
 */

const att = (over: Partial<AttendanceInput> = {}): AttendanceInput => ({
	...emptyAttendance(),
	...over
})

const cfg = (over: Partial<EmployeeComputeConfig> = {}): EmployeeComputeConfig => ({
	taxableByCode: new Map([
		['BASIC', true],
		['OT', true],
		['ALLOWANCE', false],
		['INCENTIVE', true]
	]),
	periodShare: 0.5,
	loans: [],
	cashAdvances: [],
	...over
})

// salary is interpreted per rateType, so the amounts differ by basis (a ₱200 HOURLY rate, a ₱800
// DAILY rate, a ₱30k MONTHLY salary).
const COMPS: EmployeeComp[] = [
	{ basicMonthlySalary: 30000, rateType: 'MONTHLY' },
	{ basicMonthlySalary: 15000.5, rateType: 'MONTHLY' },
	{ basicMonthlySalary: 200, rateType: 'HOURLY' },
	{ basicMonthlySalary: 156.25, rateType: 'HOURLY' },
	{ basicMonthlySalary: 800, rateType: 'DAILY' }
]

const ATTS: AttendanceInput[] = [
	att({ regularHours: 88 }),
	att({
		regularHours: 80,
		overtimeHours: 10,
		nightDiffHours: 6,
		regularHolidayHours: 8,
		lateMinutes: 30,
		undertimeMinutes: 15
	}),
	att({ regularHours: 0 })
]

const ADJUSTMENTS = [{}, { allowances: 1000, incentives: 500 }]
const SHARES = [0.5, 1]

describe('#170 parity — statutoryComp===comp + single-full-period basicSegments == no args', () => {
	for (const comp of COMPS) {
		for (const periodShare of SHARES) {
			for (const [ai, attendance] of ATTS.entries()) {
				for (const [xi, adj] of ADJUSTMENTS.entries()) {
					it(`${comp.rateType} ${comp.basicMonthlySalary} · share ${periodShare} · att#${ai} · adj#${xi}`, () => {
						const baseline = computeEmployeeResult(comp, attendance, adj, cfg({ periodShare }))

						// statutoryComp is a DISTINCT object with equal values (parity is by value, not identity).
						const statutoryComp: EmployeeComp = {
							basicMonthlySalary: comp.basicMonthlySalary,
							rateType: comp.rateType
						}
						// basicSegments only affects the FIXED (MONTHLY) branch; the resolver would never emit
						// it for hourly/daily, so mirror that here.
						const basicSegments =
							comp.rateType === 'MONTHLY'
								? [
										{
											salary: D(comp.basicMonthlySalary),
											rateType: comp.rateType,
											weight: D(periodShare)
										}
									]
								: undefined

						const withArgs = computeEmployeeResult(
							comp,
							attendance,
							adj,
							cfg({ periodShare, statutoryComp, basicSegments })
						)

						expect(withArgs).toEqual(baseline)
					})
				}
			}
		}
	}
})

describe('#170 — a MONTHLY split reconciles to salary × periodShare', () => {
	it('two equal-salary segments whose weights sum to periodShare reproduce the un-split basic', () => {
		const comp: EmployeeComp = { basicMonthlySalary: 30000, rateType: 'MONTHLY' }
		const attendance = att({ regularHours: 88 })

		const baseline = computeEmployeeResult(comp, attendance, {}, cfg({ periodShare: 0.5 }))
		const split = computeEmployeeResult(
			comp,
			attendance,
			{},
			cfg({
				periodShare: 0.5,
				// 0.2 + 0.3 == 0.5 in exact decimal; both segments at the same salary.
				basicSegments: [
					{ salary: D(30000), rateType: 'MONTHLY', weight: D(0.2) },
					{ salary: D(30000), rateType: 'MONTHLY', weight: D(0.3) }
				]
			})
		)

		expect(split.basicPay).toBe(15000) // 30000 × 0.5
		expect(split.basicPay).toBe(baseline.basicPay)
		expect(split.grossPay).toBe(baseline.grossPay)
	})

	it('a single full-period FIXED ComputeSegment (Stage 2 seam) == the no-segments result', () => {
		const comp: EmployeeComp = { basicMonthlySalary: 30000, rateType: 'MONTHLY' }
		const attendance = att({ regularHours: 80, overtimeHours: 5, lateMinutes: 30 })
		const expectedHours = 88

		const baseline = computeEmployeeResult(
			comp,
			attendance,
			{},
			cfg({ periodShare: 0.5, expectedHours })
		)
		const withSeg = computeEmployeeResult(
			comp,
			attendance,
			{},
			cfg({
				periodShare: 0.5,
				expectedHours,
				segments: [{ comp, weight: D(0.5), attendance, expectedHours }]
			})
		)
		expect(withSeg).toEqual(baseline)
	})

	it('two DIFFERENT-salary segments blend by weight (30000@0.25 + 42000@0.25 = 18000)', () => {
		const comp: EmployeeComp = { basicMonthlySalary: 42000, rateType: 'MONTHLY' }
		const r = computeEmployeeResult(
			comp,
			att({ regularHours: 88 }),
			{},
			cfg({
				periodShare: 0.5,
				basicSegments: [
					{ salary: D(30000), rateType: 'MONTHLY', weight: D(0.25) },
					{ salary: D(42000), rateType: 'MONTHLY', weight: D(0.25) }
				]
			})
		)
		// 30000·0.25 + 42000·0.25 = 7500 + 10500 = 18000.
		expect(r.basicPay).toBe(18000)
	})
})
