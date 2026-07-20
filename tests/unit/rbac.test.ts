import { describe, it, expect } from 'vitest'
import { CAPABILITIES, can, hasMinRole, ROLE_HIERARCHY } from '../../src/lib/rbac'
import type { Role } from '@prisma/client'

const ALL_ROLES: Role[] = [
	'EMPLOYEE',
	'MANAGER',
	'HR_ADMIN',
	'SUPER_ADMIN',
	'PAYROLL_OFFICER',
	'FINANCE'
]

// The full matrix, written out longhand rather than derived from CAPABILITIES — a test
// that recomputes the table from the table proves nothing. Every cell here is a
// deliberate authorization decision, so widening one fails this test on purpose.
const EXPECTED: Record<string, Role[]> = {
	MANAGE_HR: ['HR_ADMIN', 'SUPER_ADMIN'],
	VIEW_TEAM: ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'],
	ADMINISTER_SYSTEM: ['SUPER_ADMIN'],
	APPROVE_REQUESTS: ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN', 'PAYROLL_OFFICER'],
	MANAGE_PAYROLL: ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER'],
	VIEW_PAYROLL_REPORTS: ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'FINANCE']
}

describe('capability table', () => {
	it('covers every capability with no extras', () => {
		expect(Object.keys(CAPABILITIES).sort()).toEqual(Object.keys(EXPECTED).sort())
	})

	for (const [capability, holders] of Object.entries(EXPECTED)) {
		describe(capability, () => {
			for (const role of ALL_ROLES) {
				const shouldHold = holders.includes(role)
				it(`${shouldHold ? 'grants' : 'denies'} ${role}`, () => {
					expect(can(role, capability as keyof typeof CAPABILITIES)).toBe(shouldHold)
				})
			}
		})
	}

	// The bug class this table exists to prevent: EMPLOYEE picking up a privileged
	// capability, and the off-ladder specialists silently inheriting HR authority.
	it('grants EMPLOYEE nothing', () => {
		for (const capability of Object.keys(CAPABILITIES)) {
			expect(can('EMPLOYEE', capability as keyof typeof CAPABILITIES)).toBe(false)
		}
	})

	it('keeps FINANCE and PAYROLL_OFFICER off the HR ladder', () => {
		for (const role of ['FINANCE', 'PAYROLL_OFFICER'] as Role[]) {
			expect(can(role, 'MANAGE_HR')).toBe(false)
			expect(can(role, 'VIEW_TEAM')).toBe(false)
			expect(can(role, 'ADMINISTER_SYSTEM')).toBe(false)
			// ...but they must not be locked out of payroll reporting.
			expect(can(role, 'VIEW_PAYROLL_REPORTS')).toBe(true)
		}
	})
})

describe('hasMinRole', () => {
	it('ranks the HR ladder', () => {
		expect(hasMinRole('SUPER_ADMIN', 'HR_ADMIN')).toBe(true)
		expect(hasMinRole('HR_ADMIN', 'HR_ADMIN')).toBe(true)
		expect(hasMinRole('MANAGER', 'HR_ADMIN')).toBe(false)
		expect(hasMinRole('EMPLOYEE', 'MANAGER')).toBe(false)
	})

	// Off-ladder roles rank 0, so a minimum-role check must never let them through —
	// this is why payroll access goes via capabilities instead.
	it('does not let off-ladder roles clear a ladder floor', () => {
		for (const role of ['FINANCE', 'PAYROLL_OFFICER'] as Role[]) {
			expect(ROLE_HIERARCHY[role]).toBe(0)
			expect(hasMinRole(role, 'MANAGER')).toBe(false)
		}
	})
})
