import { describe, it, expect } from 'vitest'
import {
	formatCurrency,
	formatDateRange,
	formatFullName,
	maskAccountNumber
} from '$lib/utils/format'

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
		// Local-time construction so the rendered day is timezone-independent.
		expect(formatDateRange(new Date(2026, 6, 24), new Date(2026, 6, 24))).toBe('Jul 24, 2026')
	})

	it('renders a multi-day span', () => {
		expect(formatDateRange(new Date(2026, 6, 24), new Date(2026, 6, 26))).toBe(
			'Jul 24, 2026 – Jul 26, 2026'
		)
	})

	it('handles a missing end date', () => {
		expect(formatDateRange(new Date(2026, 6, 24), null)).toBe('Jul 24, 2026')
		// Date-time string without a zone parses as local time (a bare date would be UTC).
		expect(formatDateRange('2026-07-24T00:00:00')).toBe('Jul 24, 2026')
	})
})

describe('maskAccountNumber', () => {
	it('passes null through so “—” placeholders keep working', () => {
		expect(maskAccountNumber(null)).toBeNull()
	})

	it('fully masks values of 4 or fewer characters', () => {
		expect(maskAccountNumber('1234')).toBe('••••')
		expect(maskAccountNumber('89')).toBe('••••')
	})

	it('shows only the last 4 digits of longer values', () => {
		expect(maskAccountNumber('001234567890')).toBe('•••• 7890')
		expect(maskAccountNumber('09171234567')).toBe('•••• 4567')
	})

	it('ignores whitespace and dashes when isolating the last 4', () => {
		expect(maskAccountNumber('0012-3456-7890')).toBe('•••• 7890')
		expect(maskAccountNumber('0012 3456 7890')).toBe('•••• 7890')
		// Short-after-stripping stays fully masked.
		expect(maskAccountNumber('1-2-3-4')).toBe('••••')
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
