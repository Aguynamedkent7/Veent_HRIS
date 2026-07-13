import { describe, it, expect } from 'vitest'
import { canActOnStage, nextState } from '$lib/server/services/approvals'

const roleStage = (role: string) => ({ stageKind: 'ROLE' as const, role: role as never })
const supStage = { stageKind: 'SUPERVISOR' as const, role: null }

describe('canActOnStage', () => {
	it('SUPER_ADMIN can act on any stage', () => {
		expect(canActOnStage(roleStage('HR_ADMIN'), 'SUPER_ADMIN', null, null)).toBe(true)
		expect(canActOnStage(supStage, 'SUPER_ADMIN', null, null)).toBe(true)
	})

	it('supervisor stage requires the employee’s direct supervisor', () => {
		expect(canActOnStage(supStage, 'MANAGER', 'mgr1', 'mgr1')).toBe(true)
		expect(canActOnStage(supStage, 'MANAGER', 'mgr2', 'mgr1')).toBe(false)
		expect(canActOnStage(supStage, 'MANAGER', null, 'mgr1')).toBe(false)
	})

	it('role stage requires the exact role (HR cannot act on a Payroll stage)', () => {
		expect(canActOnStage(roleStage('HR_ADMIN'), 'HR_ADMIN', null, null)).toBe(true)
		expect(canActOnStage(roleStage('PAYROLL_OFFICER'), 'PAYROLL_OFFICER', null, null)).toBe(true)
		expect(canActOnStage(roleStage('PAYROLL_OFFICER'), 'HR_ADMIN', null, null)).toBe(false)
		expect(canActOnStage(roleStage('HR_ADMIN'), 'MANAGER', null, null)).toBe(false)
	})
})

describe('nextState', () => {
	it('advances to the next stage on a non-final approval', () => {
		expect(nextState(0, 3, 'APPROVED')).toEqual({ status: 'PENDING', currentStage: 1 })
		expect(nextState(1, 3, 'APPROVED')).toEqual({ status: 'PENDING', currentStage: 2 })
	})

	it('marks APPROVED when the final stage approves', () => {
		expect(nextState(2, 3, 'APPROVED')).toEqual({ status: 'APPROVED', currentStage: 2 })
		expect(nextState(0, 1, 'APPROVED')).toEqual({ status: 'APPROVED', currentStage: 0 })
	})

	it('rejects terminally at any stage', () => {
		expect(nextState(0, 3, 'REJECTED')).toEqual({ status: 'REJECTED', currentStage: 0 })
		expect(nextState(1, 3, 'REJECTED')).toEqual({ status: 'REJECTED', currentStage: 1 })
	})

	it('returns to the employee without advancing', () => {
		expect(nextState(1, 3, 'RETURNED')).toEqual({ status: 'RETURNED', currentStage: 1 })
	})
})
