import { describe, it, expect } from 'vitest'
import { bandStatus } from '$lib/server/services/settings/master'

describe('bandStatus', () => {
	it('flags below the band', () => {
		expect(bandStatus(14000, 15000, 20000)).toBe('below')
	})
	it('flags above the band', () => {
		expect(bandStatus(21000, 15000, 20000)).toBe('above')
	})
	it('accepts values within (inclusive of bounds)', () => {
		expect(bandStatus(15000, 15000, 20000)).toBe('within')
		expect(bandStatus(20000, 15000, 20000)).toBe('within')
		expect(bandStatus(17500, 15000, 20000)).toBe('within')
	})
})
