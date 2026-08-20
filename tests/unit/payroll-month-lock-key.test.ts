import { describe, it, expect, vi } from 'vitest'

/**
 * #163 (review round 2) — the advisory-lock keys that serialize the overlap checks.
 *
 * The lock only works if two overlapping ranges hash to the SAME key. Deriving it from the
 * overlap query's widened `from` bound (one day BEFORE the period start) broke exactly that: an
 * Aug 1–5 range keyed on July while an overlapping Aug 2–6 range keyed on August, so the two
 * writers never serialized. Both keys are now taken from the REQUESTED period's Manila calendar
 * month.
 *
 * Postgres locking itself is not unit-testable; the key string is, and it is the whole mechanism.
 */

vi.mock('$lib/server/db', () => ({ db: {} }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn() }))

const { payrollRunLockKey } = await import('$lib/server/services/payroll/index')
const { timesheetLockKey } = await import('$lib/server/services/timesheets')

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

describe('payrollRunLockKey', () => {
	it('gives the 1st and the 2nd of the same month the SAME key', () => {
		expect(payrollRunLockKey('org1', d('2026-08-01'))).toBe(
			payrollRunLockKey('org1', d('2026-08-02'))
		)
	})

	it('gives a different month a different key', () => {
		expect(payrollRunLockKey('org1', d('2026-08-01'))).not.toBe(
			payrollRunLockKey('org1', d('2026-07-31'))
		)
	})

	it('gives a different org a different key', () => {
		expect(payrollRunLockKey('org1', d('2026-08-01'))).not.toBe(
			payrollRunLockKey('org2', d('2026-08-01'))
		)
	})

	// A row stored on a PHT day boundary is 2026-07-31T16:00Z = August 1 in Manila; it must lock
	// the month it means, not the UTC month it happens to sit in.
	it('buckets a PHT-boundary start into its Manila month', () => {
		expect(payrollRunLockKey('org1', new Date('2026-07-31T16:00:00.000Z'))).toBe(
			payrollRunLockKey('org1', d('2026-08-10'))
		)
	})
})

describe('timesheetLockKey', () => {
	it('gives the 1st and the 2nd of the same month the SAME key', () => {
		expect(timesheetLockKey('emp1', d('2026-08-01'))).toBe(
			timesheetLockKey('emp1', d('2026-08-02'))
		)
	})

	it('gives a different month a different key', () => {
		expect(timesheetLockKey('emp1', d('2026-08-01'))).not.toBe(
			timesheetLockKey('emp1', d('2026-07-31'))
		)
	})

	it('gives a different employee a different key', () => {
		expect(timesheetLockKey('emp1', d('2026-08-01'))).not.toBe(
			timesheetLockKey('emp2', d('2026-08-01'))
		)
	})

	it('buckets a PHT-boundary start into its Manila month', () => {
		expect(timesheetLockKey('emp1', new Date('2026-07-31T16:00:00.000Z'))).toBe(
			timesheetLockKey('emp1', d('2026-08-10'))
		)
	})
})
