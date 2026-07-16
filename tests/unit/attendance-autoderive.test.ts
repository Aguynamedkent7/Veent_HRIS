import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Guard behaviour of the page-load derive (`skipUnpunched`). The DB and audit log are mocked so
 * these stay in the pure/fast unit suite; the assertions are on which days get upserted.
 *
 * Regression target: a day materialised as ABSENT *before* the employee punched used to freeze,
 * because the old `onlyMissing` guard skipped every existing day. `skipUnpunched` instead skips
 * only existing days with no punches, so a freshly-punched "today" self-heals — while still never
 * touching a locked or hand-corrected day.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		employee: { findMany: vi.fn() },
		publicHoliday: { findMany: vi.fn() },
		timeLog: { findMany: vi.fn(), count: vi.fn() },
		request: { findMany: vi.fn() },
		attendanceDay: { findUnique: vi.fn(), upsert: vi.fn() }
	}
}))

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

const { deriveRange, autoDeriveFromPunches } = await import('$lib/server/services/attendance')

const EMP = { id: 'emp1', organizationId: 'org1', workSchedule: null }
const CTX = {
	organizationId: 'org1',
	actorId: 'user1',
	actorRole: 'EMPLOYEE' as const,
	ipAddress: 'test'
}
// Single PHT day: Mon 2026-07-13, a regular weekday under the default 09:00–18:00 shift.
const RANGE = { from: new Date('2026-07-13'), to: new Date('2026-07-13'), employeeId: 'emp1' }
// A full worked day: IN 09:00 PHT (01:00Z), OUT 18:00 PHT (10:00Z) → PRESENT, 8h regular.
const WORKED = [
	{ punchType: 'IN' as const, timestamp: new Date('2026-07-13T01:00:00Z') },
	{ punchType: 'OUT' as const, timestamp: new Date('2026-07-13T10:00:00Z') }
]
const machineDay = { isLocked: false, manuallyEdited: false }

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.employee.findMany.mockResolvedValue([EMP])
	dbMock.publicHoliday.findMany.mockResolvedValue([])
	dbMock.request.findMany.mockResolvedValue([])
	dbMock.attendanceDay.upsert.mockResolvedValue({})
})

describe('deriveRange — skipUnpunched guard', () => {
	it('self-heals a stale machine-written day once punches exist', async () => {
		// The exact bug: the day already exists (ABSENT, materialised before the punch) but now has
		// punches. skipUnpunched must re-derive it rather than skip it.
		dbMock.timeLog.findMany.mockResolvedValue(WORKED)
		dbMock.attendanceDay.findUnique.mockResolvedValue(machineDay)

		const res = await deriveRange('org1', RANGE, CTX, { skipUnpunched: true })

		expect(dbMock.attendanceDay.upsert).toHaveBeenCalledTimes(1)
		expect(dbMock.attendanceDay.upsert.mock.calls[0][0].update.status).toBe('PRESENT')
		expect(res.derived).toBe(1)
	})

	it('never re-derives a manually-edited day, even when it has punches', async () => {
		dbMock.timeLog.findMany.mockResolvedValue(WORKED)
		dbMock.attendanceDay.findUnique.mockResolvedValue({ isLocked: false, manuallyEdited: true })

		const res = await deriveRange('org1', RANGE, CTX, { skipUnpunched: true })

		expect(dbMock.attendanceDay.upsert).not.toHaveBeenCalled()
		expect(res.derived).toBe(0)
	})

	it('leaves an existing punch-less day untouched (no churn on cheap loads)', async () => {
		dbMock.timeLog.findMany.mockResolvedValue([])
		dbMock.attendanceDay.findUnique.mockResolvedValue(machineDay)

		await deriveRange('org1', RANGE, CTX, { skipUnpunched: true })

		expect(dbMock.attendanceDay.upsert).not.toHaveBeenCalled()
	})

	it('still fills a missing day from punches (gap derive)', async () => {
		dbMock.timeLog.findMany.mockResolvedValue(WORKED)
		dbMock.attendanceDay.findUnique.mockResolvedValue(null)

		await deriveRange('org1', RANGE, CTX, { skipUnpunched: true })

		expect(dbMock.attendanceDay.upsert).toHaveBeenCalledTimes(1)
		expect(dbMock.attendanceDay.upsert.mock.calls[0][0].update.status).toBe('PRESENT')
	})
})

describe('autoDeriveFromPunches — public entrypoint', () => {
	it('self-heals a stale ABSENT day through the page-load path', async () => {
		dbMock.timeLog.count.mockResolvedValue(2)
		dbMock.timeLog.findMany.mockResolvedValue(WORKED)
		dbMock.attendanceDay.findUnique.mockResolvedValue(machineDay)

		const res = await autoDeriveFromPunches('org1', RANGE, CTX)

		expect(dbMock.attendanceDay.upsert).toHaveBeenCalledTimes(1)
		expect(res.derived).toBe(1)
	})

	it('short-circuits when the window has no punches at all', async () => {
		dbMock.timeLog.count.mockResolvedValue(0)

		const res = await autoDeriveFromPunches('org1', RANGE, CTX)

		expect(dbMock.attendanceDay.findUnique).not.toHaveBeenCalled()
		expect(dbMock.attendanceDay.upsert).not.toHaveBeenCalled()
		expect(res).toEqual({ derived: 0, flagged: 0 })
	})
})
