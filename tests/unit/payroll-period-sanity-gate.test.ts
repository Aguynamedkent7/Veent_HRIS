import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'
import { periodOf } from '../../src/lib/utils/pay-periods'

/**
 * #163 — the standard-shape gate on the three write paths is replaced by a SANITY gate, not
 * deleted. `isValidStandardPeriod` was the only thing stopping `end < start`, and a negative day
 * count would produce a negative share and negative deductions.
 *
 * Both messages are verbatim the copy the PeriodPicker shows inline, so client and server agree.
 */

const { dbMock, writeAuditLog } = vi.hoisted(() => ({
	dbMock: {
		payrollRun: {
			findUnique: vi.fn(),
			findMany: vi.fn(),
			findFirst: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			findUniqueOrThrow: vi.fn()
		},
		payrollPeriod: { create: vi.fn() },
		payrollEntry: { deleteMany: vi.fn(), create: vi.fn() },
		timesheet: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
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
		approvalStep: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
		$transaction: vi.fn(),
		// #163: createPayrollRun / openPeriod / createTimesheet each take an advisory lock as the
		// first statement of their transaction.
		$executeRaw: vi.fn()
	},
	writeAuditLog: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog }))

const { createPayrollRun } = await import('$lib/server/services/payroll/index')
const { openPeriod } = await import('$lib/server/services/payroll/periods')
const { createTimesheet } = await import('$lib/server/services/timesheets')

const ORG = 'org1'
const ctx = { organizationId: ORG, actorId: 'u1', actorRoles: ['SUPER_ADMIN'] as Role[] }
const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

const REVERSED = 'End date must be on or after the start date.'
const CROSS_MONTH = 'A custom period must start and end in the same month.'

beforeEach(() => {
	vi.clearAllMocks()
	// Nothing already exists, and computePayroll finds an empty roster so the run loop is a no-op.
	dbMock.payrollRun.findUnique.mockResolvedValue(null)
	dbMock.payrollRun.findMany.mockResolvedValue([])
	dbMock.payrollRun.create.mockResolvedValue({ id: 'run1' })
	dbMock.payrollRun.findFirst.mockResolvedValue({
		id: 'run1',
		organizationId: ORG,
		status: 'DRAFT',
		periodStart: d('2026-05-03'),
		periodEnd: d('2026-05-09')
	})
	dbMock.payrollRun.findUniqueOrThrow.mockResolvedValue({ id: 'run1' })
	dbMock.payrollPeriod.create.mockResolvedValue({ id: 'per1' })
	dbMock.timesheet.findMany.mockResolvedValue([])
	dbMock.timesheet.findUnique.mockResolvedValue(null)
	dbMock.timesheet.create.mockResolvedValue({ id: 'ts1', entries: [] })
	for (const model of [
		'employee',
		'earningType',
		'loan',
		'cashAdvance',
		'benefitEnrollment',
		'employeeEarning',
		'employeeDeduction',
		'employeeStatutoryConfig',
		'employeeCompensation',
		'publicHoliday',
		'approvalStep'
	] as const) {
		dbMock[model].findMany.mockResolvedValue([])
	}
	dbMock.payRateRule.findUnique.mockResolvedValue(null)
	dbMock.statutoryRateConfig.findUnique.mockResolvedValue(null)
	dbMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
		typeof fn === 'function' ? fn(dbMock) : []
	)
})

const run = (start: string, end: string) => createPayrollRun(ORG, d(start), d(end), ctx)
const period = (start: string, end: string) =>
	openPeriod(ORG, { name: 'P', startDate: d(start), endDate: d(end) }, ctx)
const timesheet = (start: string, end: string) => createTimesheet('emp1', d(start), d(end), [], ctx)

describe('createPayrollRun — same-month sanity gate', () => {
	it('refuses a reversed range with the exact copy, before any write', async () => {
		await expect(run('2026-05-21', '2026-05-13')).rejects.toMatchObject({
			status: 400,
			body: { message: REVERSED }
		})
		expect(dbMock.payrollRun.create).not.toHaveBeenCalled()
	})
	it('refuses a cross-month range with the exact copy, before any write', async () => {
		await expect(run('2026-05-20', '2026-06-05')).rejects.toMatchObject({
			status: 400,
			body: { message: CROSS_MONTH }
		})
		expect(dbMock.payrollRun.create).not.toHaveBeenCalled()
	})
	it('accepts a custom same-month range', async () => {
		await run('2026-05-03', '2026-05-09')
		expect(dbMock.payrollRun.create).toHaveBeenCalledTimes(1)
	})
	it('still accepts the three standard shapes', async () => {
		for (const kind of ['FIRST_HALF', 'SECOND_HALF', 'WHOLE_MONTH'] as const) {
			dbMock.payrollRun.create.mockClear()
			const p = periodOf(kind, 2026, 4)
			await createPayrollRun(ORG, p.periodStart, p.periodEnd, ctx)
			expect(dbMock.payrollRun.create).toHaveBeenCalledTimes(1)
		}
	})
})

describe('openPeriod — same-month sanity gate', () => {
	it('refuses a reversed range with the exact copy, before any write', async () => {
		await expect(period('2026-05-21', '2026-05-13')).rejects.toMatchObject({
			status: 400,
			body: { message: REVERSED }
		})
		expect(dbMock.$transaction).not.toHaveBeenCalled()
	})
	it('refuses a cross-month range with the exact copy, before any write', async () => {
		await expect(period('2026-05-20', '2026-06-05')).rejects.toMatchObject({
			status: 400,
			body: { message: CROSS_MONTH }
		})
		expect(dbMock.$transaction).not.toHaveBeenCalled()
	})
	it('accepts a custom same-month range', async () => {
		await period('2026-05-03', '2026-05-09')
		expect(dbMock.payrollPeriod.create).toHaveBeenCalledTimes(1)
	})
	it('still accepts the three standard shapes', async () => {
		for (const kind of ['FIRST_HALF', 'SECOND_HALF', 'WHOLE_MONTH'] as const) {
			dbMock.payrollPeriod.create.mockClear()
			const p = periodOf(kind, 2026, 4)
			await openPeriod(ORG, { name: 'P', startDate: p.periodStart, endDate: p.periodEnd }, ctx)
			expect(dbMock.payrollPeriod.create).toHaveBeenCalledTimes(1)
		}
	})
})

describe('createTimesheet — same-month sanity gate', () => {
	it('refuses a reversed range with the exact copy, before any write', async () => {
		await expect(timesheet('2026-05-21', '2026-05-13')).rejects.toMatchObject({
			status: 400,
			body: { message: REVERSED }
		})
		expect(dbMock.timesheet.create).not.toHaveBeenCalled()
	})
	it('refuses a cross-month range with the exact copy, before any write', async () => {
		await expect(timesheet('2026-05-20', '2026-06-05')).rejects.toMatchObject({
			status: 400,
			body: { message: CROSS_MONTH }
		})
		expect(dbMock.timesheet.create).not.toHaveBeenCalled()
	})
	it('accepts a custom same-month range', async () => {
		await timesheet('2026-05-03', '2026-05-09')
		expect(dbMock.timesheet.create).toHaveBeenCalledTimes(1)
	})
	it('still accepts the three standard shapes', async () => {
		for (const kind of ['FIRST_HALF', 'SECOND_HALF', 'WHOLE_MONTH'] as const) {
			dbMock.timesheet.create.mockClear()
			const p = periodOf(kind, 2026, 4)
			await createTimesheet('emp1', p.periodStart, p.periodEnd, [], ctx)
			expect(dbMock.timesheet.create).toHaveBeenCalledTimes(1)
		}
	})
})
