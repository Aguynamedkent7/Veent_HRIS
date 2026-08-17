import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'

/**
 * #200 — `importBacklogCsv`, the write path.
 *
 * MOCK DISCIPLINE (mandatory — validate-contract E8). Every `db` mock below branches on the
 * `where` shape, never a flat `mockResolvedValue`. A flat mock returns its row for EVERY query,
 * which makes "the stranger was not resolved" and "the duplicate was skipped" pass even after the
 * guard that produces them is deleted. The canonical example of the technique in this repo is
 * `tests/unit/punch-access.test.ts:57-65` ("Discriminate on the where-shape, not call order").
 *
 * `deriveRange` is mocked because it is the neighbouring service, not this one; what matters here
 * is that it is called once, after the transaction, over the file's own date span.
 */

const { dbMock, txMock, writeAuditLog, deriveRange } = vi.hoisted(() => {
	const txMock = { timeLog: { createMany: vi.fn() } }
	return {
		txMock,
		writeAuditLog: vi.fn().mockResolvedValue(undefined),
		deriveRange: vi.fn().mockResolvedValue({ derived: 0, flagged: [] }),
		dbMock: {
			employee: { findMany: vi.fn() },
			attendanceDay: { findMany: vi.fn() },
			timeLog: { findMany: vi.fn() },
			$transaction: vi.fn(),
			__tx: txMock
		}
	}
})

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog }))
vi.mock('$lib/server/services/attendance', () => ({ deriveRange }))

const { importBacklogCsv } = await import('$lib/server/services/attendance/import')

const JOJO = 'org_jojo'
const SWEETLEAF = 'org_sweetleaf'

/** The employee directory the where-shape mock answers from: number → id + owning org. Only
 *  ACTIVE employees are listed, so an `employmentStatus` filter that is dropped is invisible here
 *  — the org scoping is what B7 pins. */
const DIRECTORY: Record<string, { id: string; org: string }> = {
	'JJ-001': { id: 'e1', org: JOJO },
	'JJ-002': { id: 'e2', org: JOJO },
	'SL-009': { id: 'e9', org: SWEETLEAF } // another tenant's employee — must never resolve for JoJo
}

/** Days that already exist, keyed `employeeId:YYYY-MM-DD`. */
let existingDays: Record<string, { isLocked: boolean; manuallyEdited: boolean }> = {}
/** dedupKeys already in `time_logs`. */
let storedKeys = new Set<string>()

const CTX = {
	organizationId: JOJO,
	actorId: 'user1',
	actorRoles: ['HR_ADMIN'] as Role[],
	ipAddress: 'test'
}

const upload = (text: string, name = 'backlog.csv') => ({
	name,
	size: Buffer.byteLength(text),
	text
})

const HEADER = 'employeeNumber,date,amIn,amOut,pmIn,pmOut\n'

/** Every record handed to `createMany` across all calls. */
const written = () => txMock.timeLog.createMany.mock.calls.flatMap((c) => c[0].data)

beforeEach(() => {
	vi.clearAllMocks()
	existingDays = {}
	storedKeys = new Set()

	// Resolve ONLY the numbers asked for, and only inside the org the query scopes to. Delete
	// `user: { organizationId }` from the service and SL-009 starts resolving for JoJo — which is
	// precisely what B7 asserts cannot happen.
	dbMock.employee.findMany.mockImplementation(
		({
			where
		}: {
			where: { employeeNumber: { in: string[] }; user?: { organizationId: string } }
		}) =>
			Promise.resolve(
				where.employeeNumber.in
					.filter(
						(n) => DIRECTORY[n] && (!where.user || DIRECTORY[n].org === where.user.organizationId)
					)
					.map((n) => ({ id: DIRECTORY[n].id, employeeNumber: n }))
			)
	)

	// Return a day only when the query actually covers that employee AND that date.
	dbMock.attendanceDay.findMany.mockImplementation(
		({ where }: { where: { employeeId: { in: string[] }; date: { in: Date[] } } }) =>
			Promise.resolve(
				Object.entries(existingDays)
					.map(([key, state]) => {
						const [employeeId, dayKey] = key.split(':')
						return { employeeId, date: new Date(dayKey), ...state }
					})
					.filter(
						(d) =>
							where.employeeId.in.includes(d.employeeId) &&
							where.date.in.some((q) => q.getTime() === d.date.getTime())
					)
			)
	)

	// Return a key only when the query asked for it (E8: a flat mock would report every punch a
	// duplicate no matter what the service looked up).
	dbMock.timeLog.findMany.mockImplementation(
		({ where }: { where: { dedupKey: { in: string[] } } }) =>
			Promise.resolve(
				where.dedupKey.in.filter((k) => storedKeys.has(k)).map((k) => ({ dedupKey: k }))
			)
	)

	txMock.timeLog.createMany.mockResolvedValue({ count: 0 })
	dbMock.$transaction.mockImplementation((fn: (tx: typeof txMock) => Promise<unknown>) =>
		fn(txMock)
	)
})

describe('B6 — the happy path writes every punch through one bulk insert', () => {
	const csv =
		HEADER +
		'JJ-001,2026-08-10,08:00,11:00,13:00,17:00\nJJ-002,2026-08-10,09:00,12:00,14:00,18:00\n'

	it('writes 8 records in a single createMany, all MANUAL and all backlog-keyed', async () => {
		const res = await importBacklogCsv(JOJO, upload(csv), CTX)
		expect(txMock.timeLog.createMany).toHaveBeenCalledTimes(1)
		const records = written()
		expect(records).toHaveLength(8)
		expect(records.every((r) => r.source === 'MANUAL')).toBe(true)
		expect(records.every((r) => r.dedupKey.startsWith('backlog:'))).toBe(true)
		// #177 has not shipped: a backlog punch must carry no location (criterion 12).
		expect(records.some((r) => 'latitude' in r)).toBe(false)
		expect(res).toMatchObject({ applied: 2, skippedDuplicate: 0, punchesWritten: 8 })
		expect(res.rejected).toEqual([])
	})

	it('writes the literal PHT instants, not UTC re-readings of the same clock face (E8)', async () => {
		await importBacklogCsv(JOJO, upload(csv), CTX)
		const jj1 = written().filter((r) => r.employeeId === 'e1')
		expect(jj1.map((r) => r.timestamp.toISOString())).toEqual([
			'2026-08-10T00:00:00.000Z', // 08:00 +08:00
			'2026-08-10T03:00:00.000Z', // 11:00 +08:00
			'2026-08-10T05:00:00.000Z', // 13:00 +08:00
			'2026-08-10T09:00:00.000Z' // 17:00 +08:00
		])
		expect(jj1.map((r) => r.punchType)).toEqual(['IN', 'OUT', 'IN', 'OUT'])
		expect(jj1.map((r) => r.dedupKey)).toEqual([
			'backlog:JJ-001:2026-08-10:amIn',
			'backlog:JJ-001:2026-08-10:amOut',
			'backlog:JJ-001:2026-08-10:pmIn',
			'backlog:JJ-001:2026-08-10:pmOut'
		])
	})

	it('materialises the days through deriveRange once, over the file’s own span', async () => {
		await importBacklogCsv(
			JOJO,
			upload(HEADER + 'JJ-001,2026-08-10,08:00,,,\nJJ-001,2026-08-14,08:00,,,\n'),
			CTX
		)
		expect(deriveRange).toHaveBeenCalledTimes(1)
		const [org, range] = deriveRange.mock.calls[0]
		expect(org).toBe(JOJO)
		expect((range.from as Date).toISOString().slice(0, 10)).toBe('2026-08-10')
		expect((range.to as Date).toISOString().slice(0, 10)).toBe('2026-08-14')
	})

	it('refuses a span wider than the 2-month cap before touching the database', async () => {
		await expect(
			importBacklogCsv(
				JOJO,
				upload(HEADER + 'JJ-001,2026-01-01,08:00,,,\nJJ-001,2026-08-10,08:00,,,\n'),
				CTX
			)
		).rejects.toMatchObject({ status: 400 })
		expect(dbMock.employee.findMany).not.toHaveBeenCalled()
		expect(txMock.timeLog.createMany).not.toHaveBeenCalled()
	})
})

describe('B7 — an employee number outside the caller’s org is rejected, never written', () => {
	it('rejects the stranger and still applies the row beside it', async () => {
		const res = await importBacklogCsv(
			JOJO,
			upload(HEADER + 'JJ-001,2026-08-10,08:00,11:00,,\nSL-009,2026-08-10,08:00,11:00,,\n'),
			CTX
		)
		expect(res.applied).toBe(1)
		expect(res.rejected).toEqual([
			{
				line: 3,
				employeeNumber: 'SL-009',
				date: '2026-08-10',
				reason: 'employee number not found in your organization'
			}
		])
		// The leak would be the write, not the count — assert the id never reaches createMany.
		expect(written().map((r) => r.employeeId)).toEqual(['e1', 'e1'])
		expect(written().some((r) => r.employeeId === 'e9')).toBe(false)
	})

	it('scopes the employee lookup through the user relation', async () => {
		await importBacklogCsv(JOJO, upload(HEADER + 'JJ-001,2026-08-10,08:00,,,\n'), CTX)
		expect(dbMock.employee.findMany).toHaveBeenCalledTimes(1)
		expect(dbMock.employee.findMany.mock.calls[0][0].where).toMatchObject({
			user: { organizationId: JOJO },
			employmentStatus: 'ACTIVE'
		})
	})
})

describe('B8/B9 — locked and hand-corrected days are refused BEFORE any TimeLog write', () => {
	/**
	 * The asymmetry is deliberate and must survive Phase 3: a LIVE web/Discord punch on a locked day
	 * still writes a `TimeLog` (the log is append-only; the locked `AttendanceDay` is what is
	 * protected). The BACKLOG import is stricter on purpose — a backlog punch written under a lock
	 * would silently resurrect the moment HR unlocks the day. Do not "fix" this into consistency.
	 */
	it('B8 refuses a locked day and writes nothing for it', async () => {
		existingDays = { 'e1:2026-08-10': { isLocked: true, manuallyEdited: false } }
		const res = await importBacklogCsv(
			JOJO,
			upload(HEADER + 'JJ-001,2026-08-10,08:00,11:00,,\nJJ-001,2026-08-11,08:00,11:00,,\n'),
			CTX
		)
		expect(res.rejected).toEqual([
			{ line: 2, employeeNumber: 'JJ-001', date: '2026-08-10', reason: 'this day is locked' }
		])
		expect(res.applied).toBe(1)
		// Zero records for the locked employee/date pair — the guard is not "reject, then write
		// anyway". Only the 08-11 row's two punches survive.
		expect(written().map((r) => r.dedupKey)).toEqual([
			'backlog:JJ-001:2026-08-11:amIn',
			'backlog:JJ-001:2026-08-11:amOut'
		])
	})

	it('B9 refuses a hand-corrected day and writes nothing for it', async () => {
		existingDays = { 'e1:2026-08-10': { isLocked: false, manuallyEdited: true } }
		const res = await importBacklogCsv(
			JOJO,
			upload(HEADER + 'JJ-001,2026-08-10,08:00,11:00,,\n'),
			CTX
		)
		expect(res.rejected).toEqual([
			{
				line: 2,
				employeeNumber: 'JJ-001',
				date: '2026-08-10',
				reason: 'this day was hand-corrected by HR'
			}
		])
		expect(txMock.timeLog.createMany).not.toHaveBeenCalled()
		expect(deriveRange).not.toHaveBeenCalled()
	})

	it('leaves an untouched day alone — the guard reads state, it does not assume it', async () => {
		existingDays = { 'e1:2026-08-10': { isLocked: false, manuallyEdited: false } }
		const res = await importBacklogCsv(
			JOJO,
			upload(HEADER + 'JJ-001,2026-08-10,08:00,11:00,,\n'),
			CTX
		)
		expect(res.rejected).toEqual([])
		expect(res.applied).toBe(1)
	})
})

describe('B10 — re-uploading the same file is a no-op', () => {
	const csv =
		HEADER + 'JJ-001,2026-08-10,08:00,11:00,13:00,17:00\nJJ-002,2026-08-10,09:00,12:00,,\n'

	it('skips every punch already stored and writes nothing', async () => {
		storedKeys = new Set([
			'backlog:JJ-001:2026-08-10:amIn',
			'backlog:JJ-001:2026-08-10:amOut',
			'backlog:JJ-001:2026-08-10:pmIn',
			'backlog:JJ-001:2026-08-10:pmOut',
			'backlog:JJ-002:2026-08-10:amIn',
			'backlog:JJ-002:2026-08-10:amOut'
		])
		const res = await importBacklogCsv(JOJO, upload(csv), CTX)
		expect(res).toMatchObject({ applied: 0, skippedDuplicate: 2, punchesWritten: 0 })
		expect(txMock.timeLog.createMany).not.toHaveBeenCalled()
	})

	it('still writes the punches that are genuinely new', async () => {
		storedKeys = new Set(['backlog:JJ-001:2026-08-10:amIn', 'backlog:JJ-001:2026-08-10:amOut'])
		const res = await importBacklogCsv(JOJO, upload(csv), CTX)
		expect(res.punchesWritten).toBe(4)
		expect(
			written()
				.map((r) => r.dedupKey)
				.sort()
		).toEqual([
			'backlog:JJ-001:2026-08-10:pmIn',
			'backlog:JJ-001:2026-08-10:pmOut',
			'backlog:JJ-002:2026-08-10:amIn',
			'backlog:JJ-002:2026-08-10:amOut'
		])
	})

	it('asks the DB to absorb a concurrent double-submit as well', async () => {
		await importBacklogCsv(JOJO, upload(csv), CTX)
		expect(txMock.timeLog.createMany.mock.calls[0][0].skipDuplicates).toBe(true)
	})
})

describe('B11 — exactly one bounded audit summary row per import', () => {
	it('records the counts inside the same transaction as the write', async () => {
		const res = await importBacklogCsv(
			JOJO,
			upload(HEADER + 'JJ-001,2026-08-10,08:00,11:00,,\n', 'august-backlog.csv'),
			CTX
		)
		expect(writeAuditLog).toHaveBeenCalledTimes(1)
		const [ctx, payload, client] = writeAuditLog.mock.calls[0]
		expect(ctx).toMatchObject({ organizationId: JOJO })
		expect(payload).toMatchObject({
			action: 'CREATE',
			entityType: 'AttendanceDay',
			entityId: JOJO
		})
		expect(payload.newValue).toMatchObject({
			source: 'backlog_csv',
			fileName: 'august-backlog.csv',
			rowsParsed: 1,
			applied: 1,
			skippedDuplicate: 0,
			rejected: 0
		})
		// Passed the tx client, so the audit row commits or rolls back with the punches.
		expect(client).toBe(txMock)
		expect(res.applied).toBe(1)
	})

	it('caps rejectedSample at 20 on a file with more rejections than that (E8)', async () => {
		// 25 unknown employee numbers → 25 rejections. A fixture with fewer would make the bound
		// trivially true and the assertion unable to fail.
		const rows = Array.from(
			{ length: 25 },
			(_, i) => `ZZ-${String(i).padStart(3, '0')},2026-08-10,08:00,11:00,,\n`
		).join('')
		const res = await importBacklogCsv(JOJO, upload(HEADER + rows), CTX)
		expect(res.rejected).toHaveLength(25)
		const payload = writeAuditLog.mock.calls[0][1]
		expect(payload.newValue.rejected).toBe(25)
		expect(payload.newValue.rejectedSample).toHaveLength(20)
	})

	it('audits an import in which every row was refused', async () => {
		existingDays = { 'e1:2026-08-10': { isLocked: true, manuallyEdited: false } }
		await importBacklogCsv(JOJO, upload(HEADER + 'JJ-001,2026-08-10,08:00,11:00,,\n'), CTX)
		expect(writeAuditLog).toHaveBeenCalledTimes(1)
		expect(writeAuditLog.mock.calls[0][1].newValue).toMatchObject({ applied: 0, rejected: 1 })
	})
})

describe('B12 — the queries stay bulk, whatever the row count', () => {
	it('runs one employee, one attendance and one timeLog query for a 50-row file', async () => {
		const rows = Array.from(
			{ length: 50 },
			(_, i) =>
				`JJ-00${(i % 2) + 1},2026-08-${String((i % 28) + 1).padStart(2, '0')},08:00,11:00,,\n`
		).join('')
		await importBacklogCsv(JOJO, upload(HEADER + rows), CTX)
		expect(dbMock.employee.findMany).toHaveBeenCalledTimes(1)
		expect(dbMock.attendanceDay.findMany).toHaveBeenCalledTimes(1)
		expect(dbMock.timeLog.findMany).toHaveBeenCalledTimes(1)
		expect(txMock.timeLog.createMany).toHaveBeenCalledTimes(1)
		// Bulk means one query carrying every id/date, not one query per row — assert the shape,
		// not the call count (E8: a count alone passes for a per-row loop that was mocked away).
		expect(dbMock.employee.findMany.mock.calls[0][0].where.employeeNumber.in.sort()).toEqual([
			'JJ-001',
			'JJ-002'
		])
		expect(dbMock.attendanceDay.findMany.mock.calls[0][0].where.employeeId.in.sort()).toEqual([
			'e1',
			'e2'
		])
		expect(dbMock.timeLog.findMany.mock.calls[0][0].where.dedupKey.in).toHaveLength(100)
	})
})

describe('the service repeats the caps as a second layer for any future caller', () => {
	it('refuses an oversize payload with 413', async () => {
		await expect(
			importBacklogCsv(JOJO, { name: 'big.csv', size: 3 * 1024 * 1024, text: HEADER }, CTX)
		).rejects.toMatchObject({ status: 413 })
	})

	it('refuses a non-.csv name with 415', async () => {
		await expect(importBacklogCsv(JOJO, upload(HEADER, 'punches.xlsx'), CTX)).rejects.toMatchObject(
			{ status: 415 }
		)
	})

	it('refuses a file with no usable rows', async () => {
		await expect(importBacklogCsv(JOJO, upload(HEADER), CTX)).rejects.toMatchObject({ status: 400 })
	})
})
