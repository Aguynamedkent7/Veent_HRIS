import { describe, it, expect } from 'vitest'
import {
	employmentTypeLabel,
	contractRenewalStatus,
	RENEWAL_NOTICE_DAYS
} from '../../src/lib/utils/employment'

// #167 — the dashboard status card reads employment wording and contract-renewal standing
// from these shared helpers.
describe('employmentTypeLabel (#167)', () => {
	it('reads FULL_TIME as "Regular"', () => {
		expect(employmentTypeLabel('FULL_TIME')).toBe('Regular')
	})
	it('labels the other types', () => {
		expect(employmentTypeLabel('PROBATIONARY')).toBe('Probationary')
		expect(employmentTypeLabel('CONTRACTUAL')).toBe('Contractual')
		expect(employmentTypeLabel('PART_TIME')).toBe('Part-time')
	})
})

describe('contractRenewalStatus (#167)', () => {
	const asOf = new Date('2026-07-23T00:00:00Z')

	it('reports a healthy contract far from its end date', () => {
		const s = contractRenewalStatus(new Date('2026-12-31T00:00:00Z'), asOf)
		expect(s.expired).toBe(false)
		expect(s.dueForRenewal).toBe(false)
		expect(s.daysUntil).toBeGreaterThan(RENEWAL_NOTICE_DAYS)
	})

	it('flags a contract inside the renewal-notice window', () => {
		const s = contractRenewalStatus(new Date('2026-08-10T00:00:00Z'), asOf) // 18 days out
		expect(s.daysUntil).toBe(18)
		expect(s.dueForRenewal).toBe(true)
		expect(s.expired).toBe(false)
	})

	it('treats the end date itself as due, not expired', () => {
		const s = contractRenewalStatus(asOf, asOf)
		expect(s.daysUntil).toBe(0)
		expect(s.dueForRenewal).toBe(true)
		expect(s.expired).toBe(false)
	})

	it('flags an expired contract with negative days', () => {
		const s = contractRenewalStatus(new Date('2026-07-01T00:00:00Z'), asOf)
		expect(s.daysUntil).toBe(-22)
		expect(s.expired).toBe(true)
		expect(s.dueForRenewal).toBe(false)
	})
})
