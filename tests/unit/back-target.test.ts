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

// Settings tabs chained Back through each other (tab → previous tab), stranding the index.
// `preferFallback` makes Back move UP instead of sideways.
describe('resolveBackTarget — preferFallback (section subpages)', () => {
	it('ignores a sibling origin under the fallback and goes up to the section index', () => {
		expect(resolveBackTarget('/settings/company', null, '/settings', true)).toBe('/settings')
	})

	it('ignores the sibling even when it carries a query string', () => {
		expect(resolveBackTarget('/settings/holidays?year=2026', null, '/settings', true)).toBe(
			'/settings'
		)
	})

	it('still honours an origin from outside the section', () => {
		expect(resolveBackTarget('/dashboard', null, '/settings', true)).toBe('/dashboard')
	})

	// The opt-out half: /requests/[id] deliberately goes back sideways to the approvals
	// queue, so the default must keep preferring the captured origin.
	it('leaves sideways navigation alone when not opted in', () => {
		expect(resolveBackTarget('/requests/approvals', null, '/requests')).toBe('/requests/approvals')
	})

	it('does not treat a prefix-sharing sibling directory as inside the section', () => {
		// '/settings-archive' merely starts with the same characters — it is not under /settings.
		expect(resolveBackTarget('/settings-archive', null, '/settings', true)).toBe(
			'/settings-archive'
		)
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
