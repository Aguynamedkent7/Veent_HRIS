import { describe, it, expect } from 'vitest'
import { formatCurrency, formatDateRange, formatFullName } from '$lib/utils/format'

describe('formatCurrency', () => {
	it('formats PHP currency', () => {
		const result = formatCurrency(1234.5)
		expect(result).toContain('1,234')
	})

	it('accepts string input', () => {
		expect(() => formatCurrency('5000')).not.toThrow()
	})
})

describe('formatDateRange', () => {
	it('collapses a same-day range to a single date', () => {
		// Two distinct Date objects for the same day — the old !== comparison broke here.
		expect(formatDateRange(new Date('2026-07-24'), new Date('2026-07-24'))).toBe('Jul 24, 2026')
	})

	it('renders a multi-day span', () => {
		expect(formatDateRange(new Date('2026-07-24'), new Date('2026-07-26'))).toBe(
			'Jul 24, 2026 – Jul 26, 2026'
		)
	})

	it('handles a missing end date', () => {
		expect(formatDateRange(new Date('2026-07-24'), null)).toBe('Jul 24, 2026')
		expect(formatDateRange('2026-07-24')).toBe('Jul 24, 2026')
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
