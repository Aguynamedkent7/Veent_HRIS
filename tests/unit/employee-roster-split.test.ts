import { describe, it, expect } from 'vitest'
import { offboardedFilter } from '../../src/lib/server/services/employees'

// #184 — offboarded employees are kept and shown in their own roster section. The list
// query splits on this filter: the Offboarded tab is exactly OFFBOARDED; the Active tab
// is everyone still on the books (ACTIVE / ON_LEAVE), never offboarded records.
describe('offboardedFilter (#184)', () => {
	it('matches only OFFBOARDED for the offboarded section', () => {
		expect(offboardedFilter(true)).toBe('OFFBOARDED')
	})

	it('excludes OFFBOARDED for the active roster', () => {
		expect(offboardedFilter(false)).toEqual({ not: 'OFFBOARDED' })
	})
})
