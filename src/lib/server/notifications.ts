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

// ─── Offboarding transition notice (#185) ─────────────────────────────────────
// When a separation is opened, the departing employee gets a due-diligence /
// transition-period notice by email: their effective date and the clearance
// checklist they must complete before it. The body is assembled here (not at the
// call site) so a real mailer only delivers subject/body, and the wording is tested.
import { formatDateDisplay } from '$lib/utils/dates'

export interface OffboardingNoticeDetails {
	employeeName: string
	effectiveDate: Date
	/** Clearance tasks the employee must complete, each with the owning department. */
	checklist: { label: string; department: string }[]
}

/** Build the subject and body for the transition-period due-diligence notice. */
export function buildOffboardingNotice(d: OffboardingNoticeDetails): {
	subject: string
	body: string
} {
	const when = formatDateDisplay(d.effectiveDate)
	const tasks = d.checklist.length
		? d.checklist.map((c) => `  • ${c.label} (${c.department})`)
		: ['  • (No clearance items configured — HR will advise.)']
	return {
		subject: `Transition & clearance details — effective ${when}`,
		body: [
			`Hi ${d.employeeName},`,
			'',
			`This is a due-diligence notice regarding your transition, effective ${when}.`,
			'During the transition period, please complete the following clearance items:',
			'',
			...tasks,
			'',
			'HR will sign each item off as it is completed. Reach out to your HR contact with any questions.'
		].join('\n')
	}
}

export function sendOffboardingNoticeEmail(recipient: string, details: OffboardingNoticeDetails): void {
	const { subject } = buildOffboardingNotice(details)
	console.log(`[NOTIFY] Offboarding transition notice queued for <${recipient}>: ${subject}`)
}
