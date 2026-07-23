import { describe, it, expect } from 'vitest'
import { buildInterviewEmail } from '../../src/lib/server/notifications'

// #196 — the applicant and HR both receive the interview details by email. The body is
// assembled by buildInterviewEmail so a real mailer only delivers subject/body.
const base = {
	applicantName: 'Jamie Cruz',
	jobTitle: 'Software Engineer',
	scheduledAt: new Date('2026-07-30T02:00:00Z'), // 10:00 AM PHT
	interviewer: 'Alex Reyes',
	location: 'Level 5, Tower A'
}

describe('buildInterviewEmail (#196)', () => {
	it('addresses the applicant directly and lists every detail', () => {
		const { subject, body } = buildInterviewEmail('applicant', { ...base, mode: 'ONSITE' })
		expect(subject).toBe('Interview scheduled — Software Engineer')
		expect(body).toContain('Hi Jamie Cruz,')
		expect(body).toContain('Position: Software Engineer')
		expect(body).toContain('Mode: On-site')
		expect(body).toContain('Interviewer: Alex Reyes')
		expect(body).toContain('Location: Level 5, Tower A')
		// PHT wall-clock, not UTC.
		expect(body).toContain('10:00 AM PHT')
	})

	it('gives HR a candidate-focused subject and body', () => {
		const { subject, body } = buildInterviewEmail('hr', { ...base, mode: 'ONSITE' })
		expect(subject).toBe('Interview scheduled — Jamie Cruz (Software Engineer)')
		expect(body).toContain('An interview with Jamie Cruz has been scheduled')
		expect(body).not.toContain('Hi Jamie Cruz,')
	})

	it('labels the location line by mode', () => {
		const video = buildInterviewEmail('applicant', {
			...base,
			mode: 'VIDEO',
			location: 'https://meet.example/abc'
		})
		expect(video.body).toContain('Mode: Video call')
		expect(video.body).toContain('Meeting link: https://meet.example/abc')

		const phone = buildInterviewEmail('applicant', {
			...base,
			mode: 'PHONE',
			location: '+63 900 000'
		})
		expect(phone.body).toContain('Mode: Phone call')
		expect(phone.body).toContain('Phone number: +63 900 000')
	})

	it('omits the location line when there is none', () => {
		const { body } = buildInterviewEmail('applicant', { ...base, mode: 'PHONE', location: null })
		expect(body).not.toContain('Phone number:')
		expect(body).not.toContain('Location:')
	})
})
