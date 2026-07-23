// Stub notification functions — log to console in v1.
//
// Passwords never appear in logs (#96): even a "development-only" console line
// ends up in log aggregators and container stdout captures. The parameter is
// kept so callers still hand the credential through the seam, but it must be
// delivered out-of-band once a real notifier is wired in.
export function sendWelcomeEmail(email: string, _tempPassword: string): void {
	console.log('[NOTIFY] Welcome email queued for', email)
}

export function sendTimesheetStatusEmail(email: string, status: string): void {
	console.log('[NOTIFY] Timesheet', status, 'for', email)
}

export function sendLeaveStatusEmail(email: string, status: string, reason?: string): void {
	console.log('[NOTIFY] Leave', status, 'for', email, reason ?? '')
}

// ─── Interview scheduling (#196) ──────────────────────────────────────────────
// When an interview is booked, both the applicant and HR get an email with the
// full details. The message body is assembled here (not at the call site) so a
// real mailer only has to deliver `subject`/`body`, and the wording is unit-tested.
import { manilaDateTime } from '$lib/utils/dates'
import type { InterviewMode } from '@prisma/client'

export interface InterviewEmailDetails {
	applicantName: string
	jobTitle: string
	scheduledAt: Date
	mode: InterviewMode
	interviewer: string
	/** Room / address for ONSITE, meeting link for VIDEO, number for PHONE. */
	location: string | null
}

const MODE_LABEL: Record<InterviewMode, string> = {
	ONSITE: 'On-site',
	VIDEO: 'Video call',
	PHONE: 'Phone call'
}

// The label for the `location` line depends on the mode — an address for on-site,
// a link for video, a number for phone.
const MODE_LOCATION_LABEL: Record<InterviewMode, string> = {
	ONSITE: 'Location',
	VIDEO: 'Meeting link',
	PHONE: 'Phone number'
}

/**
 * Build the subject and body for an interview-scheduled email. `audience` tailors the
 * greeting: the applicant is addressed directly, HR gets a heads-up about the candidate.
 */
export function buildInterviewEmail(
	audience: 'applicant' | 'hr',
	d: InterviewEmailDetails
): { subject: string; body: string } {
	const when = manilaDateTime(d.scheduledAt)
	const lines = [
		`Position: ${d.jobTitle}`,
		`When: ${when}`,
		`Mode: ${MODE_LABEL[d.mode]}`,
		`Interviewer: ${d.interviewer}`
	]
	if (d.location) lines.push(`${MODE_LOCATION_LABEL[d.mode]}: ${d.location}`)

	if (audience === 'applicant') {
		return {
			subject: `Interview scheduled — ${d.jobTitle}`,
			body: [
				`Hi ${d.applicantName},`,
				'',
				'Your interview has been scheduled. Details:',
				'',
				...lines,
				'',
				'Please reply to this email if you need to reschedule. Good luck!'
			].join('\n')
		}
	}
	return {
		subject: `Interview scheduled — ${d.applicantName} (${d.jobTitle})`,
		body: [
			`An interview with ${d.applicantName} has been scheduled. Details:`,
			'',
			...lines
		].join('\n')
	}
}

export function sendInterviewScheduledEmail(
	recipient: string,
	audience: 'applicant' | 'hr',
	details: InterviewEmailDetails
): void {
	const { subject } = buildInterviewEmail(audience, details)
	console.log(`[NOTIFY] Interview email queued for ${audience} <${recipient}>: ${subject}`)
}
