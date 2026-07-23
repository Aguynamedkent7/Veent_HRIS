import { describe, it, expect } from 'vitest'
import { canApprovePosting } from '../../src/lib/server/services/recruitment'
import type { Role } from '@prisma/client'

// #195 — a posting is approved by its department's designated approver, or by HR when no
// approver is mapped (the fallback). HR can also override on any mapped department.
describe('canApprovePosting (#195)', () => {
	const HR: Role[] = ['HR_ADMIN']
	const EMP: Role[] = ['EMPLOYEE']

	it('lets the mapped approver act', () => {
		expect(canApprovePosting('emp_senior', 'emp_senior', EMP)).toBe(true)
	})

	it('rejects a non-approver, non-HR employee', () => {
		expect(canApprovePosting('emp_senior', 'emp_other', EMP)).toBe(false)
	})

	it('lets HR act as the fallback when no approver is mapped', () => {
		expect(canApprovePosting(null, 'emp_hr', HR)).toBe(true)
	})

	it('lets HR override even when another approver is mapped', () => {
		expect(canApprovePosting('emp_senior', 'emp_hr', HR)).toBe(true)
	})

	it('rejects a non-HR user when no approver is mapped', () => {
		expect(canApprovePosting(null, 'emp_x', EMP)).toBe(false)
	})
})
