import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'

/**
 * #224 — the CEO gained ADMINISTER_SYSTEM, so every irreversible operation that used to lean on
 * "Super Admin is the only system administrator" now has to name OVERRIDE_FINALIZED explicitly.
 * The failure mode this guards is a call site left pointing at ADMINISTER_SYSTEM, which would
 * silently hand the CEO the ability to void payroll they themselves approved (APPROVE_FINANCE)
 * and to reopen attendance days the payroll they run was computed from.
 *
 * So these exercise the enforcement points, not the capability table — `rbac.test.ts` already
 * pins who holds what, and a second copy of that would not catch a mis-pointed guard.
 *
 * All three writers now carry their own guard, matching the epic's rule that guards live in the
 * service and not the route. For the route-level tests `voidPeriod` and `unlockRange` stay mocked —
 * the assertion there is "was the service reached", and standing up voidPeriod's
 * amortization-reversal transaction to learn that would be disproportionate — while the real
 * implementations are pulled in separately below to pin the guard itself. `voidRun` is left real
 * throughout, so the API twin above it runs the real check.
 */

const { dbMock, periodsMock, attendanceMock } = vi.hoisted(() => ({
	dbMock: {
		payrollRun: { findFirst: vi.fn(), update: vi.fn() },
		employee: { findMany: vi.fn(), findUnique: vi.fn() }
	},
	periodsMock: {
		listPeriods: vi.fn(),
		openPeriod: vi.fn(),
		importAttendance: vi.fn(),
		generate: vi.fn(),
		lock: vi.fn(),
		release: vi.fn(),
		voidPeriod: vi.fn()
	},
	attendanceMock: {
		countAttendanceDays: vi.fn(),
		listAttendanceDays: vi.fn(),
		listTeamDay: vi.fn(),
		deriveRange: vi.fn(),
		autoDeriveFromPunches: vi.fn(),
		correctDay: vi.fn(),
		lockRange: vi.fn(),
		unlockRange: vi.fn(),
		resetDayToDerived: vi.fn(),
		createTimesheetFromAttendance: vi.fn()
	}
}))

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/services/payroll/periods', () => periodsMock)
vi.mock('$lib/server/services/attendance', () => attendanceMock)

const { voidRun } = await import('$lib/server/services/payroll/runs')
const { POST: runApi } = await import('../../src/routes/api/v1/payroll/[id]/+server')
const { POST: periodApi } = await import('../../src/routes/api/v1/payroll/periods/[id]/+server')
const { actions: periodActions } =
	await import('../../src/routes/(app)/payroll/periods/+page.server')
const { actions: attendanceActions } =
	await import('../../src/routes/(app)/attendance/+page.server')

const user = (role: Role) => ({ id: 'u1', organizationId: 'org1', role })
const ctx = (role: Role) => ({ organizationId: 'org1', actorId: 'u1', actorRole: role })

/** A form-action event; `body` becomes the POSTed fields. */
const formEvent = (role: Role, body: Record<string, string> = {}) =>
	({
		locals: { user: user(role) },
		request: { formData: async () => new Map(Object.entries(body)) },
		getClientAddress: () => 'test'
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any

/** An API event for POST /:id?action=void. */
const apiEvent = (role: Role) =>
	({
		locals: { user: user(role) },
		params: { id: 'x1' },
		url: new URL('http://localhost/?action=void'),
		request: { json: async () => ({}) },
		getClientAddress: () => 'test'
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any

const RANGE = { employeeId: 'emp1', from: '2026-07-01', to: '2026-07-15' }

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.payrollRun.findFirst.mockResolvedValue({ id: 'x1', status: 'APPROVED' })
	dbMock.payrollRun.update.mockResolvedValue({ id: 'x1', status: 'VOIDED' })
})

describe('voiding a payroll run (#224)', () => {
	it('denies the CEO and never reaches the database', async () => {
		await expect(voidRun('x1', 'org1', ctx('CEO'))).rejects.toMatchObject({ status: 403 })
		expect(dbMock.payrollRun.findFirst).not.toHaveBeenCalled()
	})

	it('still allows the Super Admin', async () => {
		await expect(voidRun('x1', 'org1', ctx('SUPER_ADMIN'))).resolves.toMatchObject({
			status: 'VOIDED'
		})
	})

	it('denies the CEO through the v1 API twin', async () => {
		expect((await runApi(apiEvent('CEO'))).status).toBe(403)
	})
})

describe('voiding a payroll period (#224)', () => {
	it('denies the CEO on the form action', async () => {
		await expect(periodActions.void!(formEvent('CEO', { id: 'p1' }))).rejects.toMatchObject({
			status: 403
		})
		expect(periodsMock.voidPeriod).not.toHaveBeenCalled()
	})

	it('still allows the Super Admin on the form action', async () => {
		await periodActions.void!(formEvent('SUPER_ADMIN', { id: 'p1' }))
		expect(periodsMock.voidPeriod).toHaveBeenCalled()
	})

	it('denies the CEO through the v1 API twin', async () => {
		expect((await periodApi(apiEvent('CEO'))).status).toBe(403)
		expect(periodsMock.voidPeriod).not.toHaveBeenCalled()
	})
})

describe('reopening locked attendance days (#224)', () => {
	it('denies the CEO on unlock', async () => {
		await expect(attendanceActions.unlock!(formEvent('CEO', RANGE))).rejects.toMatchObject({
			status: 403
		})
		expect(attendanceMock.unlockRange).not.toHaveBeenCalled()
	})

	it('denies the CEO on unlockTeam', async () => {
		await expect(
			attendanceActions.unlockTeam!(formEvent('CEO', { date: '2026-07-01' }))
		).rejects.toMatchObject({ status: 403 })
		expect(attendanceMock.unlockRange).not.toHaveBeenCalled()
	})

	it('still allows the Super Admin on both', async () => {
		await attendanceActions.unlock!(formEvent('SUPER_ADMIN', RANGE))
		await attendanceActions.unlockTeam!(formEvent('SUPER_ADMIN', { date: '2026-07-01' }))
		expect(attendanceMock.unlockRange).toHaveBeenCalledTimes(2)
	})

	// Locking is ordinary HR work and must NOT have been dragged along by the split.
	it('leaves locking to HR', async () => {
		await attendanceActions.lock!(formEvent('HR_ADMIN', RANGE))
		expect(attendanceMock.lockRange).toHaveBeenCalled()
	})
})

/**
 * The routes above call mocked services, so they prove the route checks. These call the real
 * implementations to prove a direct caller — a third route, a job, the next API twin — is refused
 * too. The guard runs before any lookup, so nothing below it needs standing up.
 */
describe('the services refuse a direct unauthorized caller (#224)', () => {
	it('voidPeriod denies the CEO', async () => {
		const { voidPeriod } = await vi.importActual<
			typeof import('$lib/server/services/payroll/periods')
		>('$lib/server/services/payroll/periods')
		await expect(voidPeriod('p1', 'org1', ctx('CEO'))).rejects.toMatchObject({ status: 403 })
	})

	it('unlockRange denies the CEO', async () => {
		const { unlockRange } = await vi.importActual<typeof import('$lib/server/services/attendance')>(
			'$lib/server/services/attendance'
		)
		await expect(
			unlockRange('org1', { from: new Date('2026-07-01'), to: new Date('2026-07-15') }, ctx('CEO'))
		).rejects.toMatchObject({ status: 403 })
	})
})
