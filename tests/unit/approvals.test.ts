import { describe, it, expect } from 'vitest'
import { canActOnStage, nextState } from '$lib/server/services/approvals'
import { buildApprovalChain } from '$lib/server/services/requests/routing'
import type { Role } from '@prisma/client'

// Maker-checker stage authority (#134): MAKE = MANAGE_HR, VERIFY = VERIFIER,
// APPROVE = APPROVER. Signature: (stage, actorRoles, actorEmployeeId, ownerEmployeeId).
describe('canActOnStage', () => {
	it('MAKE requires an HR-level maker', () => {
		for (const role of ['HR_ADMIN', 'MANAGER', 'SUPER_ADMIN', 'CEO'] as Role[]) {
			expect(canActOnStage('MAKE', [role], 'actor', 'owner')).toBe(true)
		}
		for (const role of ['EMPLOYEE', 'VERIFIER', 'APPROVER', 'FINANCE'] as Role[]) {
			expect(canActOnStage('MAKE', [role], 'actor', 'owner')).toBe(false)
		}
	})

	it('VERIFY requires the Verifier role', () => {
		expect(canActOnStage('VERIFY', ['VERIFIER'], 'actor', 'owner')).toBe(true)
		for (const role of ['HR_ADMIN', 'MANAGER', 'APPROVER', 'SUPER_ADMIN'] as Role[]) {
			expect(canActOnStage('VERIFY', [role], 'actor', 'owner')).toBe(false)
		}
	})

	it('APPROVE requires the Approver role', () => {
		expect(canActOnStage('APPROVE', ['APPROVER'], 'actor', 'owner')).toBe(true)
		for (const role of ['HR_ADMIN', 'MANAGER', 'VERIFIER', 'SUPER_ADMIN'] as Role[]) {
			expect(canActOnStage('APPROVE', [role], 'actor', 'owner')).toBe(false)
		}
	})

	// #75 — separation of duties: nobody decides their own submission, regardless of role.
	it('blocks acting on your own submission', () => {
		expect(canActOnStage('MAKE', ['HR_ADMIN'], 'self', 'self')).toBe(false)
		expect(canActOnStage('VERIFY', ['VERIFIER'], 'self', 'self')).toBe(false)
		expect(canActOnStage('APPROVE', ['APPROVER'], 'self', 'self')).toBe(false)
	})

	// Multi-role (#133/#134): one person carrying both roles can make AND verify —
	// though never on the same request (the own-submission guard still applies).
	it('a [MANAGER, VERIFIER] user can act on both MAKE and VERIFY', () => {
		const roles: Role[] = ['MANAGER', 'VERIFIER']
		expect(canActOnStage('MAKE', roles, 'actor', 'owner')).toBe(true)
		expect(canActOnStage('VERIFY', roles, 'actor', 'owner')).toBe(true)
		expect(canActOnStage('APPROVE', roles, 'actor', 'owner')).toBe(false)
	})
})

describe('nextState', () => {
	it('advances to the next stage on a non-final approval', () => {
		expect(nextState(0, 3, 'APPROVED')).toEqual({ status: 'PENDING', currentStage: 1 })
		expect(nextState(1, 3, 'APPROVED')).toEqual({ status: 'PENDING', currentStage: 2 })
	})

	it('marks APPROVED when the final stage approves', () => {
		expect(nextState(2, 3, 'APPROVED')).toEqual({ status: 'APPROVED', currentStage: 2 })
	})

	it('rejects terminally at any stage', () => {
		expect(nextState(1, 3, 'REJECTED')).toEqual({ status: 'REJECTED', currentStage: 1 })
	})

	it('returns to the maker without advancing', () => {
		expect(nextState(1, 3, 'RETURNED')).toEqual({ status: 'RETURNED', currentStage: 1 })
	})
})

// The chain builder (#134): three stages, MAKE auto-completed only when a maker files.
describe('buildApprovalChain', () => {
	const at = new Date('2026-07-20T00:00:00Z')

	it('leaves MAKE pending when an employee files (enters at stage 0)', () => {
		const { steps, currentStage } = buildApprovalChain({
			attempt: 1,
			makerUserId: null,
			decidedAt: at
		})
		expect(steps.map((s) => s.stage)).toEqual(['MAKE', 'VERIFY', 'APPROVE'])
		expect(steps.every((s) => s.decision == null)).toBe(true)
		expect(currentStage).toBe(0)
	})

	it('auto-completes MAKE when a maker files (enters at VERIFY)', () => {
		const { steps, currentStage } = buildApprovalChain({
			attempt: 1,
			makerUserId: 'hr-user',
			decidedAt: at
		})
		expect(steps[0]).toMatchObject({ stage: 'MAKE', decision: 'APPROVED', actorId: 'hr-user' })
		expect(steps[1].decision).toBeUndefined()
		expect(currentStage).toBe(1)
	})

	it('stamps the attempt number onto every step', () => {
		const { steps } = buildApprovalChain({ attempt: 3, makerUserId: null, decidedAt: at })
		expect(steps.every((s) => s.attempt === 3)).toBe(true)
	})
})
