import { describe, it, expect } from 'vitest'
import { formatCurrency, formatFullName } from '$lib/utils/format'

describe('formatCurrency', () => {
	it('formats PHP currency', () => {
		const result = formatCurrency(1234.5)
		expect(result).toContain('1,234')
	})

	it('accepts string input', () => {
		expect(() => formatCurrency('5000')).not.toThrow()
	})
})

describe('formatFullName', () => {
	it('formats last-name-first without middle name', () => {
		expect(formatFullName('Juan', 'Dela Cruz')).toBe('Dela Cruz, Juan')
	})

	it('includes middle initial when provided', () => {
		expect(formatFullName('Juan', 'Dela Cruz', 'Reyes')).toBe('Dela Cruz, Juan R.')
	})
})
