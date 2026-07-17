import { describe, it, expect } from 'vitest'
import { canActOnStage, nextState } from '$lib/server/services/approvals'

const roleStage = (role: string) => ({ stageKind: 'ROLE' as const, role: role as never })
const supStage = { stageKind: 'SUPERVISOR' as const, role: null }

describe('canActOnStage', () => {
	// Signature: (step, actorRole, actorEmployeeId, employeeReportsToId, ownerEmployeeId)
	it('SUPER_ADMIN can act on any stage', () => {
		expect(canActOnStage(roleStage('HR_ADMIN'), 'SUPER_ADMIN', null, null, 'owner')).toBe(true)
		expect(canActOnStage(supStage, 'SUPER_ADMIN', null, null, 'owner')).toBe(true)
	})

	it('supervisor stage requires the employee’s direct supervisor', () => {
		expect(canActOnStage(supStage, 'MANAGER', 'mgr1', 'mgr1', 'emp1')).toBe(true)
		expect(canActOnStage(supStage, 'MANAGER', 'mgr2', 'mgr1', 'emp1')).toBe(false)
		expect(canActOnStage(supStage, 'MANAGER', null, 'mgr1', 'emp1')).toBe(false)
	})

	it('role stage requires the exact role (HR cannot act on a Payroll stage)', () => {
		expect(canActOnStage(roleStage('HR_ADMIN'), 'HR_ADMIN', null, null, 'owner')).toBe(true)
		expect(
			canActOnStage(roleStage('PAYROLL_OFFICER'), 'PAYROLL_OFFICER', null, null, 'owner')
		).toBe(true)
		expect(canActOnStage(roleStage('PAYROLL_OFFICER'), 'HR_ADMIN', null, null, 'owner')).toBe(false)
		expect(canActOnStage(roleStage('HR_ADMIN'), 'MANAGER', null, null, 'owner')).toBe(false)
	})

	// #75 — separation of duties: nobody decides their own submission.
	it('blocks acting on your own submission, regardless of role', () => {
		// actor is the owner ('self')
		expect(canActOnStage(roleStage('HR_ADMIN'), 'HR_ADMIN', 'self', null, 'self')).toBe(false)
		expect(
			canActOnStage(roleStage('PAYROLL_OFFICER'), 'PAYROLL_OFFICER', 'self', null, 'self')
		).toBe(false)
		// even SUPER_ADMIN, on a role or supervisor stage
		expect(canActOnStage(roleStage('HR_ADMIN'), 'SUPER_ADMIN', 'self', null, 'self')).toBe(false)
		expect(canActOnStage(supStage, 'SUPER_ADMIN', 'self', 'self', 'self')).toBe(false)
	})

	it('a different person holding the stage role can still act', () => {
		expect(canActOnStage(roleStage('HR_ADMIN'), 'HR_ADMIN', 'other', null, 'owner')).toBe(true)
		expect(canActOnStage(roleStage('HR_ADMIN'), 'SUPER_ADMIN', 'other', null, 'owner')).toBe(true)
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
