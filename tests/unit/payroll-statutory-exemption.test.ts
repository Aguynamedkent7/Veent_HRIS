import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'
import {
	computeEmployeeResult,
	type EmployeeComputeConfig
} from '$lib/server/services/payroll/calculator'
import {
	emptyAttendance,
	type EmployeeComp,
	type AttendanceInput
} from '$lib/server/services/payroll/types'

/**
 * Per-employee statutory exemption (#173). Feature A only skips a contribution — it never
 * changes the statutory rates. An exempt contribution zeroes BOTH the EE and ER share; the other
 * two contributions and the withholding tax are computed exactly as they are without any exemption.
 */

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
const FULL_PERIOD_HOURS = 88

describe('computeEmployeeResult — statutory exemptions', () => {
	const base = computeEmployeeResult(comp, att({ regularHours: FULL_PERIOD_HOURS }), {}, cfg())

	it('no exemption is byte-for-byte identical to omitting the field', () => {
		const withField = computeEmployeeResult(
			comp,
			att({ regularHours: FULL_PERIOD_HOURS }),
			{},
			cfg({ statutoryExemptions: { sss: false, philhealth: false, pagibig: false } })
		)
		expect(withField).toEqual(base)
	})

	it('exempting SSS zeroes its EE and ER share, leaving PhilHealth/Pag-IBIG and tax intact', () => {
		const r = computeEmployeeResult(
			comp,
			att({ regularHours: FULL_PERIOD_HOURS }),
			{},
			cfg({ statutoryExemptions: { sss: true, philhealth: false, pagibig: false } })
		)
		expect(r.statutory.sssEe).toBe(0)
		expect(r.statutory.sssEr).toBe(0)
		// The others are untouched.
		expect(r.statutory.philhealthEe).toBeCloseTo(base.statutory.philhealthEe, 2)
		expect(r.statutory.philhealthEr).toBeCloseTo(base.statutory.philhealthEr, 2)
		expect(r.statutory.pagibigEe).toBeCloseTo(base.statutory.pagibigEe, 2)
		expect(r.statutory.pagibigEr).toBeCloseTo(base.statutory.pagibigEr, 2)
		// Tax is never exempted — computed from the full contributions, unchanged.
		expect(r.statutory.withholdingTax).toBeCloseTo(base.statutory.withholdingTax, 2)
		// The SSS EE line no longer appears among the deductions.
		expect(r.deductions.find((d) => d.code === 'SSS')?.amount ?? 0).toBe(0)
	})

	it('exempting all three zeroes every contribution but still computes tax', () => {
		const r = computeEmployeeResult(
			comp,
			att({ regularHours: FULL_PERIOD_HOURS }),
			{},
			cfg({ statutoryExemptions: { sss: true, philhealth: true, pagibig: true } })
		)
		expect(r.statutory.sssEe).toBe(0)
		expect(r.statutory.sssEr).toBe(0)
		expect(r.statutory.philhealthEe).toBe(0)
		expect(r.statutory.philhealthEr).toBe(0)
		expect(r.statutory.pagibigEe).toBe(0)
		expect(r.statutory.pagibigEr).toBe(0)
		// Tax base is unchanged (income exemption is the ₱0 bracket, not contribution exemption).
		expect(r.statutory.withholdingTax).toBeCloseTo(base.statutory.withholdingTax, 2)
	})
})

// ─── Service: setStatutoryExemption ────────────────────────────────────────────

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		employee: { findFirst: vi.fn() },
		employeeStatutoryConfig: { upsert: vi.fn(), findMany: vi.fn() }
	}
}))
vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

const { setStatutoryExemption } = await import('$lib/server/services/payroll/employee-statutory')

const ctx = {
	organizationId: 'org1',
	actorId: 'user1',
	actorRole: 'HR_ADMIN' as Role,
	ipAddress: 'test'
}

describe('setStatutoryExemption', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		dbMock.employee.findFirst.mockResolvedValue({
			id: 'emp1',
			basicMonthlySalary: 30000,
			rateType: 'MONTHLY'
		})
		dbMock.employeeStatutoryConfig.upsert.mockResolvedValue({ id: 'cfg1' })
	})

	it('upserts the exemption row and audits the change', async () => {
		const { writeAuditLog } = await import('$lib/server/audit')
		await setStatutoryExemption('emp1', 'org1', 'SSS', true, ctx)

		expect(dbMock.employeeStatutoryConfig.upsert).toHaveBeenCalledWith({
			where: { employeeId_contribution: { employeeId: 'emp1', contribution: 'SSS' } },
			create: { employeeId: 'emp1', contribution: 'SSS', exempt: true },
			update: { exempt: true }
		})
		expect(writeAuditLog).toHaveBeenCalledWith(
			ctx,
			expect.objectContaining({
				entityType: 'EmployeeStatutoryConfig',
				entityId: 'cfg1',
				newValue: { contribution: 'SSS', exempt: true }
			})
		)
	})

	it('toggling back to enrolled clears the exemption', async () => {
		await setStatutoryExemption('emp1', 'org1', 'PHILHEALTH', false, ctx)
		expect(dbMock.employeeStatutoryConfig.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ update: { exempt: false } })
		)
	})

	it('rejects an employee outside the caller’s organization', async () => {
		dbMock.employee.findFirst.mockResolvedValue(null)
		await expect(setStatutoryExemption('emp1', 'org1', 'SSS', true, ctx)).rejects.toMatchObject({
			status: 404
		})
		expect(dbMock.employeeStatutoryConfig.upsert).not.toHaveBeenCalled()
	})
})
