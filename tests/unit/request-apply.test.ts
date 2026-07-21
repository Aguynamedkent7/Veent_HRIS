import { describe, it, expect } from 'vitest'
import { resolveInfoUpdateColumn } from '$lib/server/services/requests/apply'

describe('resolveInfoUpdateColumn', () => {
	it('maps known self-service fields', () => {
		expect(resolveInfoUpdateColumn('contactPhone')).toBe('contactPhone')
		expect(resolveInfoUpdateColumn('phone')).toBe('contactPhone')
		expect(resolveInfoUpdateColumn('contactAddress')).toBe('contactAddress')
		expect(resolveInfoUpdateColumn('address')).toBe('contactAddress')
	})
	it('returns null for unmapped / sensitive fields', () => {
		expect(resolveInfoUpdateColumn('basicMonthlySalary')).toBeNull()
		expect(resolveInfoUpdateColumn('sssNumber')).toBeNull()
		expect(resolveInfoUpdateColumn('whatever')).toBeNull()
	})
})
