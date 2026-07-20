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
