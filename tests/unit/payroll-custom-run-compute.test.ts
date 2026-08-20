import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'
import { periodOf } from '../../src/lib/utils/pay-periods'

/**
 * #163 — the two things `computePayroll` itself wires for a CUSTOM run, asserted on the
 * PayrollEntry it writes rather than on the pure engine:
 *
 *  1. `amortShare` — the flat monthly loan installment is scaled to the range before it reaches
 *     the engine. A standard period still passes the whole installment.
 *  2. S8 — the schedule-fallback signal. Timesheets are sourced by CONTAINMENT, so a standard
 *     1–15 timesheet is invisible to a May 3–9 run: the employee falls back to full scheduled
 *     hours and gets PAID for them. That estimate is flagged on the entry, not shipped silently.
 *     The containment query itself is a known residual of #163 and is NOT fixed here.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		payrollRun: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
		payrollEntry: { deleteMany: vi.fn(), create: vi.fn() },
		employee: { findMany: vi.fn() },
		earningType: { findMany: vi.fn() },
		loan: { findMany: vi.fn() },
		cashAdvance: { findMany: vi.fn() },
		benefitEnrollment: { findMany: vi.fn() },
		payRateRule: { findUnique: vi.fn() },
		statutoryRateConfig: { findUnique: vi.fn() },
		employeeEarning: { findMany: vi.fn() },
		employeeDeduction: { findMany: vi.fn() },
		employeeStatutoryConfig: { findMany: vi.fn() },
		employeeCompensation: { findMany: vi.fn() },
		publicHoliday: { findMany: vi.fn() },
		timesheet: { findMany: vi.fn() },
		attendanceDay: { findMany: vi.fn() },
		approvalStep: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
		$transaction: vi.fn()
	}
}))
vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

const { computePayroll } = await import('$lib/server/services/payroll/index')

const ORG = 'org1'
const ctx = { organizationId: ORG, actorId: 'u1', actorRoles: ['SUPER_ADMIN'] as Role[] }
const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

type EntryData = {
	data: { isFlagged: boolean; flagReason: string | null; deductions: { create: Deduction[] } }
}
type Deduction = { code: string; amount: number }

const entryWritten = () => (dbMock.payrollEntry.create.mock.calls[0][0] as EntryData).data

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.employee.findMany.mockResolvedValue([
		{ id: 'emp1', basicMonthlySalary: 30000, rateType: 'MONTHLY' }
	])
	dbMock.loan.findMany.mockResolvedValue([
		{ id: 'L1', employeeId: 'emp1', type: 'Loan', installment: 1000, balance: 30000 }
	])
	for (const model of [
		'earningType',
		'cashAdvance',
		'benefitEnrollment',
		'employeeEarning',
		'employeeDeduction',
		'employeeStatutoryConfig',
		'employeeCompensation',
		'publicHoliday',
		'timesheet',
		'attendanceDay',
		'approvalStep'
	] as const) {
		dbMock[model].findMany.mockResolvedValue([])
	}
	dbMock.payRateRule.findUnique.mockResolvedValue(null)
	dbMock.statutoryRateConfig.findUnique.mockResolvedValue(null)
	dbMock.payrollEntry.create.mockResolvedValue({ id: 'e1' })
	dbMock.payrollRun.findUnique.mockResolvedValue({ id: 'run1' })
	dbMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(dbMock))
})

const computeFor = (start: Date, end: Date) => {
	dbMock.payrollRun.findFirst.mockResolvedValue({
		id: 'run1',
		organizationId: ORG,
		status: 'DRAFT',
		periodStart: start,
		periodEnd: end
	})
	return computePayroll('run1', ORG, ctx)
}

describe('computePayroll on a custom range', () => {
	it('scales the flat monthly loan installment to the range', async () => {
		await computeFor(d('2026-05-03'), d('2026-05-09')) // 7 of 31 days
		const loan = entryWritten().deductions.create.find((c) => c.code === 'LOAN')
		expect(loan?.amount).toBe(225.81) // 1000 × 7/31, quantized once
	})

	it('flags an employee whose hours were estimated from the schedule', async () => {
		await computeFor(d('2026-05-03'), d('2026-05-09'))
		const entry = entryWritten()
		expect(entry.isFlagged).toBe(true)
		expect(entry.flagReason).toBe(
			'Hours estimated from schedule — no timesheet covers this custom period'
		)
	})
})

describe('computePayroll on a standard period is unchanged', () => {
	const may = periodOf('FIRST_HALF', 2026, 4)

	it('still takes the whole installment', async () => {
		await computeFor(may.periodStart, may.periodEnd)
		const loan = entryWritten().deductions.create.find((c) => c.code === 'LOAN')
		expect(loan?.amount).toBe(1000)
	})

	it('does not raise the schedule-fallback flag', async () => {
		await computeFor(may.periodStart, may.periodEnd)
		const entry = entryWritten()
		expect(entry.flagReason).not.toBe(
			'Hours estimated from schedule — no timesheet covers this custom period'
		)
	})
})
