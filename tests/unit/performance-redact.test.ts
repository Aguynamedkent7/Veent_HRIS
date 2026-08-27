import { describe, it, expect } from 'vitest'
import { redactHrAuthored } from '../../src/lib/server/services/performance'

/**
 * #179: the reviewed employee must never receive the HR-authored parts of their review
 * (manager comments + overall rating). redactHrAuthored nulls exactly those two fields and
 * leaves everything else — self-assessment, status, cycle — intact.
 *
 * #178 item 126 adds `answers` — every rating, subtotal, total, band, narrative and
 * recommendation the evaluator typed, in one JSON column. Withheld by default until HR
 * releases (Phase 8). The employee-authored columns stay visible.
 */
describe('redactHrAuthored (#179, #178)', () => {
	const review = {
		id: 'r1',
		employeeId: 'emp1',
		reviewerId: 'mgr1',
		status: 'COMPLETED',
		selfAssessment: 'I shipped the payroll module.',
		managerComments: 'Exceeds expectations; promote next cycle.',
		overallRating: 5,
		employeeComments: 'Noted, thank you.',
		answers: {
			version: 1,
			criteria: { crit_1: { rating: 4, remark: 'Hit target in 5 of 6 months.' } },
			sectionSubtotals: { sec_1: 26 },
			totalScore: 88,
			interpretationBandId: 'band_3',
			narratives: { nb_strengths: 'Closes hard deals.' },
			recommendationIds: ['rec_regular']
		},
		cycle: { id: 'c1', name: 'H1 2026' }
	}

	it('strips manager comments and rating', () => {
		const r = redactHrAuthored(review)
		expect(r.managerComments).toBeNull()
		expect(r.overallRating).toBeNull()
	})

	it('strips the whole answers blob — every evaluator-typed value at once (#178)', () => {
		const r = redactHrAuthored(review)
		expect(r.answers).toBeNull()
	})

	it('leaves nothing of the ratings, total or narratives behind (#178)', () => {
		// Pins that redaction is `answers = null` and not field-picking inside the JSON: nothing
		// the evaluator typed may survive anywhere in the returned object.
		const serialized = JSON.stringify(redactHrAuthored(review))
		for (const leak of ['crit_1', '88', 'band_3', 'Closes hard deals.', 'Hit target']) {
			expect(serialized).not.toContain(leak)
		}
	})

	it('keeps the employee-authored comments, which are always visible (#178)', () => {
		const r = redactHrAuthored(review)
		expect(r.employeeComments).toBe('Noted, thank you.')
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
		expect(review.answers).not.toBeNull()
		expect(review.answers.totalScore).toBe(88)
	})
})
