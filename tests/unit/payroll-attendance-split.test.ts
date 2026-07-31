import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #170/#171 Stage 2 — mid-period HOURLY/DAILY rate changes and MONTHLY↔hourly pay-type flips.
 * Only BASIC, TARDINESS and ABSENCE are segment-dependent; premiums/statutory/loans stay period-
 * aggregate. `buildSegmentAttendance` partitions the same rows `buildAttendanceInput` sums, so
 * `Σ segments == aggregate`. DB is mocked for the attendance/orchestration helpers; the engine tests
 * are pure.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: { attendanceDay: { findMany: vi.fn() } }
}))
vi.mock('$lib/server/db', () => ({ db: dbMock }))

const { buildAttendanceInput, buildSegmentAttendance } =
	await import('$lib/server/services/attendance/input')
const { buildComputeSegments } = await import('$lib/server/services/payroll/index')
const { computeEmployeeResult } = await import('$lib/server/services/payroll/calculator')
const { computeTardiness, computeAbsence } = await import('$lib/server/services/payroll/deductions')
const { D, q2n } = await import('$lib/server/services/payroll/money')
const { emptyAttendance, absenceHoursOf, hourlyRateOf } =
	await import('$lib/server/services/payroll/types')
const { computeWorkingDays } = await import('$lib/utils/dates')

import type {
	AttendanceInput,
	ComputeSegment,
	EmployeeComp
} from '$lib/server/services/payroll/types'
import type { EmployeeComputeConfig } from '$lib/server/services/payroll/calculator'
import type { CompSegment } from '$lib/server/services/payroll/compensation'

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day))
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

// One AttendanceDay row (UTC-midnight date → same PHT day-key).
const dayRow = (dayNum: number, over: Record<string, number> = {}) => ({
	date: d(2026, 5, dayNum),
	regularHours: 8,
	overtimeHours: 0,
	nightDiffHours: 0,
	restDayHours: 0,
	restDayOtHours: 0,
	regularHolidayHours: 0,
	regularHolidayOtHours: 0,
	specialHolidayHours: 0,
	specialHolidayOtHours: 0,
	lateMinutes: 0,
	undertimeMinutes: 0,
	...over
})

const sumBuckets = (buckets: AttendanceInput[]): AttendanceInput =>
	buckets.reduce((acc, b) => {
		for (const k of Object.keys(acc) as (keyof AttendanceInput)[]) acc[k] += b[k]
		return acc
	}, emptyAttendance())

beforeEach(() => vi.clearAllMocks())

describe('buildSegmentAttendance — partition invariant', () => {
	const segs = [
		{ start: d(2026, 5, 1), end: d(2026, 5, 4) },
		{ start: d(2026, 5, 5), end: d(2026, 5, 15) }
	]

	it('Σ segments == aggregate, with boundary days bucketed by PHT day-key', async () => {
		const rows = [
			dayRow(3, { regularHours: 8, lateMinutes: 10 }),
			dayRow(4, { regularHours: 8 }),
			dayRow(5, { regularHours: 8, overtimeHours: 2 }),
			dayRow(10, { regularHours: 8 })
		]
		dbMock.attendanceDay.findMany.mockResolvedValue(rows)

		const buckets = await buildSegmentAttendance('e', segs)
		const agg = await buildAttendanceInput('e', d(2026, 5, 1), d(2026, 5, 15))
		expect(buckets).not.toBeNull()
		expect(sumBuckets(buckets!)).toEqual(agg)

		// Day 4 → segment 0 (ends the 4th); day 5 → segment 1 (starts the 5th).
		expect(buckets![0].regularHours).toBe(16) // days 3 + 4
		expect(buckets![0].lateMinutes).toBe(10)
		expect(buckets![1].regularHours).toBe(16) // days 5 + 10
		expect(buckets![1].overtimeHours).toBe(2) // day 5
	})

	it('returns null when there are no attendance rows (caller falls back)', async () => {
		dbMock.attendanceDay.findMany.mockResolvedValue([])
		expect(await buildSegmentAttendance('e', segs)).toBeNull()
	})
})

describe('buildComputeSegments — working-day fallback split (no AttendanceDay rows)', () => {
	it('splits whole-period regularHours by working-day share; per-segment expectedHours = wd×dailyHours', async () => {
		dbMock.attendanceDay.findMany.mockResolvedValue([]) // → null → fallback split
		const compSegs: CompSegment[] = [
			{
				start: d(2026, 5, 1),
				end: d(2026, 5, 4),
				salary: D(30000),
				rateType: 'MONTHLY',
				weight: D(0.2)
			},
			{
				start: d(2026, 5, 5),
				end: d(2026, 5, 15),
				salary: D(40000),
				rateType: 'MONTHLY',
				weight: D(0.3)
			}
		]
		const wdWhole = computeWorkingDays(d(2026, 5, 1), d(2026, 5, 15), [])
		const out = await buildComputeSegments('e', compSegs, 88, wdWhole, [], 8)

		// Per-segment regular hours sum back to the whole-period 88 (working-day weighted).
		expect(out.reduce((a, s) => a + s.attendance.regularHours, 0)).toBeCloseTo(88, 6)
		// Each segment's expectedHours is ITS OWN working days × dailyHours (#121).
		expect(out[0].expectedHours).toBe(computeWorkingDays(d(2026, 5, 1), d(2026, 5, 4), []) * 8)
		expect(out[1].expectedHours).toBe(computeWorkingDays(d(2026, 5, 5), d(2026, 5, 15), []) * 8)
	})
})

describe('engine — mixed-basis BASIC (hourly / daily rate change)', () => {
	const hourlySeg = (rate: number, hours: number): ComputeSegment => ({
		comp: { basicMonthlySalary: rate, rateType: 'HOURLY' },
		weight: D(0.5),
		attendance: att({ regularHours: hours }),
		expectedHours: 0
	})

	it('an HOURLY rate change values each slice at its own rate', () => {
		const comp: EmployeeComp = { basicMonthlySalary: 250, rateType: 'HOURLY' }
		const r = computeEmployeeResult(
			comp,
			att({ regularHours: 88 }),
			{},
			cfg({ segments: [hourlySeg(200, 40), hourlySeg(250, 48)], statutoryComp: comp })
		)
		expect(r.basicPay).toBe(20000) // 40×200 + 48×250
		expect(r.deductions.find((c) => c.code === 'TARDINESS')).toBeUndefined()
		expect(r.deductions.find((c) => c.code === 'ABSENCE')).toBeUndefined()
	})

	it('a DAILY rate change converts each slice through its own daily→hourly rate', () => {
		const comp: EmployeeComp = { basicMonthlySalary: 1000, rateType: 'DAILY' }
		const daily = (rate: number, hours: number): ComputeSegment => ({
			comp: { basicMonthlySalary: rate, rateType: 'DAILY' },
			weight: D(0.5),
			attendance: att({ regularHours: hours }),
			expectedHours: 0
		})
		const r = computeEmployeeResult(
			comp,
			att({ regularHours: 64 }),
			{},
			cfg({ segments: [daily(800, 24), daily(1000, 40)], statutoryComp: comp })
		)
		// 24×(800/8) + 40×(1000/8) = 2400 + 5000
		expect(r.basicPay).toBe(7400)
	})
})

describe('engine — MONTHLY→HOURLY flip (#171)', () => {
	const monthly: EmployeeComp = { basicMonthlySalary: 30000, rateType: 'MONTHLY' }
	const hrM = hourlyRateOf(monthly)

	it('composes basic from both bases; tardiness/absence only from the MONTHLY segment; statutory day-1 basis', () => {
		const periodEnd: EmployeeComp = { basicMonthlySalary: 250, rateType: 'HOURLY' }
		const segments: ComputeSegment[] = [
			{
				comp: monthly,
				weight: D(0.25),
				attendance: att({ regularHours: 40, lateMinutes: 60 }),
				expectedHours: 44
			},
			{ comp: periodEnd, weight: D(0.5), attendance: att({ regularHours: 40 }), expectedHours: 0 }
		]
		const r = computeEmployeeResult(
			periodEnd,
			att({ regularHours: 80 }),
			{},
			cfg({ segments, statutoryComp: monthly }) // decision B: day-1 basis
		)

		// BASIC = 30000×0.25 (FIXED) + 40×250 (hourly).
		expect(r.basicPay).toBe(17500)
		// Tardiness/absence come ONLY from the MONTHLY segment, at its rate and its expectedHours.
		expect(r.deductions.find((c) => c.code === 'TARDINESS')!.amount).toBe(
			q2n(computeTardiness(hrM, 60, 0))
		)
		expect(r.deductions.find((c) => c.code === 'ABSENCE')!.amount).toBe(
			q2n(computeAbsence(hrM, absenceHoursOf(att({ regularHours: 40, lateMinutes: 60 }), 44)))
		)
		// Statutory follows the day-1 MONTHLY basis (30000 → PhilHealth 750/mo × 0.5).
		expect(r.statutory.philhealthEe).toBeCloseTo(375, 2)
	})

	it('#121: the MONTHLY segment absence uses ONLY its own expectedHours, not the whole period', () => {
		const periodEnd: EmployeeComp = { basicMonthlySalary: 250, rateType: 'HOURLY' }
		const segments: ComputeSegment[] = [
			{ comp: monthly, weight: D(0.25), attendance: att({ regularHours: 20 }), expectedHours: 44 },
			{ comp: periodEnd, weight: D(0.5), attendance: att({ regularHours: 30 }), expectedHours: 0 }
		]
		const r = computeEmployeeResult(
			periodEnd,
			att({ regularHours: 50 }),
			{},
			cfg({ segments, statutoryComp: monthly })
		)

		const absence = r.deductions.find((c) => c.code === 'ABSENCE')!.amount
		// 44 (its half) − 20 worked = 24 unworked hours — NOT 88 − 20 = 68 (the whole period).
		expect(absence).toBe(q2n(computeAbsence(hrM, 24)))
		expect(absence).not.toBe(q2n(computeAbsence(hrM, 68)))
	})
})
