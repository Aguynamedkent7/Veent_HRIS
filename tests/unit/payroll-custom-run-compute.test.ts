import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'
import { periodOf } from '../../src/lib/utils/pay-periods'

/**
 * #163 — the two things `computePayroll` itself wires for a CUSTOM run, asserted on the
 * PayrollEntry it writes rather than on the pure engine:
 *
 *  1. `amortShare` — the flat monthly loan installment is scaled to the range before it reaches
 *     the engine. A standard period still passes the whole installment.
 *  2. Timesheet sourcing by INTERSECTION. A standard 1–15 sheet IS visible to a May 3–9 run, and
 *     only the entries dated inside the run are summed — the employee is paid the days they
 *     actually worked in range, not full scheduled hours.
 *  3. S8 — the schedule-fallback signal, which now fires only when no APPROVED entry falls in the
 *     range at all. That estimate is flagged on the entry, not shipped silently.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		payrollRun: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
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
	data: {
		hoursWorked: number
		sssEe: number
		isFlagged: boolean
		flagReason: string | null
		deductions: { create: Deduction[] }
	}
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
	dbMock.payrollRun.findMany.mockResolvedValue([])
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

describe('computePayroll sources timesheet hours by intersection', () => {
	// A standard May 1–15 sheet. Only May 5 and May 6 fall inside a May 3–9 run.
	type Entry = { date: Date; hoursWorked: number }
	type Sheet = { id: string; periodStart: Date; periodEnd: Date; entries: Entry[] }
	type TsWhere = {
		employeeId: string
		status: string
		periodStart: { lt: Date }
		periodEnd: { gte: Date }
	}
	type TsInclude = { entries: { where: { date: { gte: Date; lt: Date } } } }

	const sheet: Sheet = {
		id: 'ts1',
		periodStart: d('2026-05-01'),
		periodEnd: d('2026-05-15'),
		entries: [
			{ date: d('2026-05-01'), hoursWorked: 8 },
			{ date: d('2026-05-05'), hoursWorked: 8 },
			{ date: d('2026-05-06'), hoursWorked: 4 },
			{ date: d('2026-05-12'), hoursWorked: 8 }
		]
	}

	beforeEach(() => {
		// The real `where` and `include` the query builds are applied to an in-memory sheet — a
		// canned array would prove nothing about either level of the filter.
		dbMock.timesheet.findMany.mockImplementation(
			async ({ where, include }: { where: TsWhere; include: TsInclude }) =>
				[sheet]
					.filter(
						(t) =>
							where.status === 'APPROVED' &&
							t.periodStart < where.periodStart.lt &&
							t.periodEnd >= where.periodEnd.gte
					)
					.map((t) => ({
						...t,
						entries: t.entries.filter(
							(e) =>
								e.date >= include.entries.where.date.gte && e.date < include.entries.where.date.lt
						)
					}))
		)
	})

	it('sums only the entries dated inside the run, not the whole sheet', async () => {
		await computeFor(d('2026-05-03'), d('2026-05-09'))
		// May 5 (8h) + May 6 (4h). Not the sheet's 28h, and not the 40h schedule fallback.
		expect(entryWritten().hoursWorked).toBe(12)
	})

	it('does not fall back to scheduled hours when the sheet only partially overlaps', async () => {
		await computeFor(d('2026-05-03'), d('2026-05-09'))
		const entry = entryWritten()
		expect(entry.flagReason).not.toBe(
			'Hours estimated from schedule — no timesheet covers this custom period'
		)
	})

	it('still flags a range the sheet overlaps but has no entry in', async () => {
		// May 3–4 is inside the sheet's span, yet it carries no entry for either day.
		await computeFor(d('2026-05-03'), d('2026-05-04'))
		expect(entryWritten().flagReason).toBe(
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
