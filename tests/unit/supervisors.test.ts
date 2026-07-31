import { describe, it, expect } from 'vitest'
import { sanitizeSupervisorIds } from '../../src/lib/server/services/supervisors'

// #176 — an employee can report to more than one supervisor. The additional-supervisor set
// never includes the employee themselves or their primary manager, and carries no dupes.
describe('sanitizeSupervisorIds (#176)', () => {
	it('keeps distinct valid supervisors', () => {
		expect(sanitizeSupervisorIds(['a', 'b'], 'self', 'primary')).toEqual(['a', 'b'])
	})

	it('drops the employee themselves and the primary manager', () => {
		expect(sanitizeSupervisorIds(['a', 'self', 'primary', 'b'], 'self', 'primary')).toEqual([
			'a',
			'b'
		])
	})

	it('dedupes and drops blanks', () => {
		expect(sanitizeSupervisorIds(['a', 'a', '', 'b'], 'self', null)).toEqual(['a', 'b'])
	})

	it('handles a null primary manager', () => {
		expect(sanitizeSupervisorIds(['a', 'self'], 'self', null)).toEqual(['a'])
	})
})
