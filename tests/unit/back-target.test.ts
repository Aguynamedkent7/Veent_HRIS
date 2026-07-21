import { describe, it, expect } from 'vitest'
import { resolveBackTarget, backLabel } from '$lib/utils/back'

describe('resolveBackTarget', () => {
	it('prefers the captured origin over everything else', () => {
		expect(resolveBackTarget('/team', '/requests/approvals', '/employees')).toBe('/team')
	})

	it('keeps the origin search string', () => {
		expect(resolveBackTarget('/requests?tab=pending', null, '/requests')).toBe(
			'/requests?tab=pending'
		)
	})

	it('uses a valid ?from path when there is no origin', () => {
		expect(resolveBackTarget(null, '/requests/approvals', '/requests')).toBe('/requests/approvals')
	})

	it('rejects protocol-relative ?from values', () => {
		expect(resolveBackTarget(null, '//evil.example', '/requests')).toBe('/requests')
	})

	it('rejects absolute-URL ?from values', () => {
		expect(resolveBackTarget(null, 'https://evil.example/x', '/requests')).toBe('/requests')
	})

	it('rejects an empty ?from', () => {
		expect(resolveBackTarget(null, '', '/requests')).toBe('/requests')
	})

	it('falls back when neither origin nor ?from is present', () => {
		expect(resolveBackTarget(null, null, '/payroll')).toBe('/payroll')
	})
})

describe('backLabel', () => {
	it('shows the destination label when the target is the fallback', () => {
		expect(backLabel('/payroll', '/payroll', 'Payroll')).toBe('Payroll')
	})

	it('matches on pathname, ignoring the query string', () => {
		expect(backLabel('/payroll?tab=runs', '/payroll', 'Payroll')).toBe('Payroll')
	})

	it('shows generic Back when the target differs from the fallback', () => {
		expect(backLabel('/team', '/employees', 'Employees')).toBe('Back')
	})
})
