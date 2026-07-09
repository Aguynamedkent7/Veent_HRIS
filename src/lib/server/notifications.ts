// Stub notification functions — log to console in v1
export function sendWelcomeEmail(email: string, tempPassword: string): void {
	console.log('[NOTIFY] Welcome email to', email, 'temp password:', tempPassword)
}

export function sendTimesheetStatusEmail(email: string, status: string): void {
	console.log('[NOTIFY] Timesheet', status, 'for', email)
}

export function sendLeaveStatusEmail(email: string, status: string, reason?: string): void {
	console.log('[NOTIFY] Leave', status, 'for', email, reason ?? '')
}
