import { describe, it, expect } from 'vitest'
import { redactHrAuthored } from '../../src/lib/server/services/performance'

/**
 * #179: the reviewed employee must never receive the HR-authored parts of their review
 * (manager comments + overall rating). redactHrAuthored nulls exactly those two fields and
 * leaves everything else — self-assessment, status, cycle — intact.
 */
describe('redactHrAuthored (#179)', () => {
	const review = {
		id: 'r1',
		employeeId: 'emp1',
		reviewerId: 'mgr1',
		status: 'COMPLETED',
		selfAssessment: 'I shipped the payroll module.',
		managerComments: 'Exceeds expectations; promote next cycle.',
		overallRating: 5,
		cycle: { id: 'c1', name: 'H1 2026' }
	}

	it('strips manager comments and rating', () => {
		const r = redactHrAuthored(review)
		expect(r.managerComments).toBeNull()
		expect(r.overallRating).toBeNull()
	})

	it('keeps the self-assessment and other fields', () => {
		const r = redactHrAuthored(review)
		expect(r.selfAssessment).toBe('I shipped the payroll module.')
		expect(r.status).toBe('COMPLETED')
		expect(r.cycle).toEqual({ id: 'c1', name: 'H1 2026' })
	})

	it('does not mutate the original review', () => {
		redactHrAuthored(review)
		expect(review.managerComments).toBe('Exceeds expectations; promote next cycle.')
		expect(review.overallRating).toBe(5)
	})
})
