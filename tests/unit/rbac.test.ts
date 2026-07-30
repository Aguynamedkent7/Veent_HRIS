import { describe, it, expect } from 'vitest'
import {
	CAPABILITIES,
	can,
	canAny,
	hasMinRole,
	hasAnyMinRole,
	ROLE_HIERARCHY
} from '../../src/lib/rbac'
import type { Role } from '@prisma/client'

const ALL_ROLES: Role[] = [
	'EMPLOYEE',
	'MANAGER',
	'HR_ADMIN',
	'SUPER_ADMIN',
	'PAYROLL_OFFICER',
	'FINANCE',
	'CEO',
	'VERIFIER',
	'APPROVER'
]

// The full matrix, written out longhand rather than derived from CAPABILITIES — a test
// that recomputes the table from the table proves nothing. Every cell here is a
// deliberate authorization decision, so widening one fails this test on purpose.
const EXPECTED: Record<string, Role[]> = {
	MANAGE_HR: ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN', 'CEO'],
	VIEW_TEAM: ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN', 'CEO'],
	ADMINISTER_SYSTEM: ['SUPER_ADMIN'],
	MANAGE_USER_ROLES: ['CEO'],
	APPROVE_REQUESTS: [
		'MANAGER',
		'HR_ADMIN',
		'SUPER_ADMIN',
		'PAYROLL_OFFICER',
		'CEO',
		'VERIFIER',
		'APPROVER'
	],
	VERIFY_REQUESTS: ['VERIFIER'],
	APPROVE_SIGNOFF: ['APPROVER'],
	APPROVE_FINANCE: ['CEO', 'SUPER_ADMIN'],
	MANAGE_STATUTORY_RATES: ['CEO', 'SUPER_ADMIN'],
	PROPOSE_STATUTORY_RATES: ['HR_ADMIN'],
	MANAGE_PAYROLL: ['MANAGER', 'SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'CEO'],
	VIEW_PAYROLL_REPORTS: ['MANAGER', 'SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'FINANCE', 'CEO']
}

// PROPOSE_STATUTORY_RATES is the MAKER leg of the statutory-rate maker-checker (#220): only
// HR_ADMIN proposes. CEO/SUPER_ADMIN hold the superior MANAGE_STATUTORY_RATES (edit directly +
// confirm) and MANAGER holds neither, so this capability is a deliberate exception to the "CEO and
// MANAGER hold every HR_ADMIN capability" invariants below.
const HR_ADMIN_SUPERSET_EXCEPTIONS: (keyof typeof CAPABILITIES)[] = ['PROPOSE_STATUTORY_RATES']

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

	// CEO's contract (#132): every capability HR_ADMIN holds, plus the exclusive
	// role-changer — but NOT system administration (that stays Super Admin).
	describe('CEO', () => {
		it('holds every capability HR_ADMIN holds', () => {
			for (const capability of Object.keys(CAPABILITIES) as (keyof typeof CAPABILITIES)[]) {
				if (HR_ADMIN_SUPERSET_EXCEPTIONS.includes(capability)) continue
				if (can('HR_ADMIN', capability)) {
					expect(can('CEO', capability)).toBe(true)
				}
			}
		})

		it('is the only role that can manage user roles', () => {
			for (const role of ALL_ROLES) {
				expect(can(role, 'MANAGE_USER_ROLES')).toBe(role === 'CEO')
			}
		})

		it('does not administer the system', () => {
			expect(can('CEO', 'ADMINISTER_SYSTEM')).toBe(false)
		})
	})
})

describe('hasMinRole', () => {
	it('ranks the HR ladder', () => {
		expect(hasMinRole('SUPER_ADMIN', 'HR_ADMIN')).toBe(true)
		expect(hasMinRole('HR_ADMIN', 'HR_ADMIN')).toBe(true)
		// Manager was promoted to on-branch HR (#133) — it now clears the HR_ADMIN floor.
		expect(hasMinRole('MANAGER', 'HR_ADMIN')).toBe(true)
		expect(hasMinRole('EMPLOYEE', 'MANAGER')).toBe(false)
	})

	// CEO mirrors HR_ADMIN on the ladder: it clears HR_ADMIN floors but NOT the
	// SUPER_ADMIN floor (e.g. payroll approval stays out of reach), so its extra
	// authority comes only from the capability table.
	it('ranks CEO level with HR_ADMIN, below SUPER_ADMIN', () => {
		expect(ROLE_HIERARCHY.CEO).toBe(ROLE_HIERARCHY.HR_ADMIN)
		expect(hasMinRole('CEO', 'HR_ADMIN')).toBe(true)
		expect(hasMinRole('CEO', 'MANAGER')).toBe(true)
		expect(hasMinRole('CEO', 'SUPER_ADMIN')).toBe(false)
	})

	// Off-ladder roles rank 0, so a minimum-role check must never let them through —
	// this is why payroll access goes via capabilities instead.
	it('does not let off-ladder roles clear a ladder floor', () => {
		for (const role of ['FINANCE', 'PAYROLL_OFFICER', 'VERIFIER', 'APPROVER'] as Role[]) {
			expect(ROLE_HIERARCHY[role]).toBe(0)
			expect(hasMinRole(role, 'MANAGER')).toBe(false)
		}
	})
})

// Manager is on-branch HR for JoJo/Sweetleaf (#133): every capability HR_ADMIN holds,
// but NOT the CEO/Super-Admin exclusives.
describe('MANAGER promotion', () => {
	it('holds every capability HR_ADMIN holds', () => {
		for (const capability of Object.keys(CAPABILITIES) as (keyof typeof CAPABILITIES)[]) {
			if (HR_ADMIN_SUPERSET_EXCEPTIONS.includes(capability)) continue
			if (can('HR_ADMIN', capability)) {
				expect(can('MANAGER', capability)).toBe(true)
			}
		}
	})

	it('does not gain the exclusives', () => {
		expect(can('MANAGER', 'MANAGE_USER_ROLES')).toBe(false)
		expect(can('MANAGER', 'ADMINISTER_SYSTEM')).toBe(false)
	})
})

// VERIFIER and APPROVER are pure sign-off roles (#133): they reach the approvals
// surface and hold only their stage capability — no HR/roster/payroll authority.
describe('sign-off roles', () => {
	it('grant only sign-off + approvals-surface capabilities', () => {
		expect(can('VERIFIER', 'VERIFY_REQUESTS')).toBe(true)
		expect(can('APPROVER', 'APPROVE_SIGNOFF')).toBe(true)
		for (const role of ['VERIFIER', 'APPROVER'] as Role[]) {
			expect(can(role, 'APPROVE_REQUESTS')).toBe(true)
			expect(can(role, 'MANAGE_HR')).toBe(false)
			expect(can(role, 'VIEW_TEAM')).toBe(false)
			expect(can(role, 'MANAGE_PAYROLL')).toBe(false)
			expect(can(role, 'VIEW_PAYROLL_REPORTS')).toBe(false)
		}
	})
})

// Multi-role (#133): capability checks match ANY role the user carries.
describe('multi-role (canAny / hasAnyMinRole)', () => {
	it('gives a [MANAGER, VERIFIER] user HR access AND verifier sign-off', () => {
		const roles: Role[] = ['MANAGER', 'VERIFIER']
		// HR-level access from the MANAGER half...
		expect(canAny(roles, 'MANAGE_HR')).toBe(true)
		expect(canAny(roles, 'VIEW_PAYROLL_REPORTS')).toBe(true)
		expect(hasAnyMinRole(roles, 'HR_ADMIN')).toBe(true)
		// ...verifier sign-off from the VERIFIER half.
		expect(canAny(roles, 'VERIFY_REQUESTS')).toBe(true)
		// but never a capability neither role holds.
		expect(canAny(roles, 'MANAGE_USER_ROLES')).toBe(false)
		expect(canAny(roles, 'ADMINISTER_SYSTEM')).toBe(false)
	})

	it('a lone VERIFIER gets no HR access', () => {
		expect(canAny(['VERIFIER'], 'MANAGE_HR')).toBe(false)
		expect(hasAnyMinRole(['VERIFIER'], 'MANAGER')).toBe(false)
		expect(canAny(['VERIFIER'], 'VERIFY_REQUESTS')).toBe(true)
	})
})

// #220 statutory-rate access contract, spelled out: CEO/Super-Admin edit + confirm; HR proposes;
// everyone else is locked out of both legs.
describe('statutory rate capabilities (#220)', () => {
	it('lets only CEO and Super Admin edit/confirm directly', () => {
		for (const role of ALL_ROLES) {
			expect(can(role, 'MANAGE_STATUTORY_RATES')).toBe(role === 'CEO' || role === 'SUPER_ADMIN')
		}
	})

	it('lets only HR Admin propose', () => {
		for (const role of ALL_ROLES) {
			expect(can(role, 'PROPOSE_STATUTORY_RATES')).toBe(role === 'HR_ADMIN')
		}
	})

	it('denies both legs to a plain manager and an employee', () => {
		for (const role of ['MANAGER', 'EMPLOYEE'] as Role[]) {
			expect(can(role, 'MANAGE_STATUTORY_RATES')).toBe(false)
			expect(can(role, 'PROPOSE_STATUTORY_RATES')).toBe(false)
		}
	})
})
