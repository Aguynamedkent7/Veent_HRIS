import type { EmploymentType } from '@prisma/client'

// One place both the client and server read employment-type wording from, so the
// dashboard status card, the 201 file and payslips can't drift (#167). FULL_TIME reads
// as "Regular" — the term the business uses for a regularised employee.
export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
	FULL_TIME: 'Regular',
	PROBATIONARY: 'Probationary',
	CONTRACTUAL: 'Contractual',
	PART_TIME: 'Part-time'
}

export function employmentTypeLabel(type: EmploymentType): string {
	return EMPLOYMENT_TYPE_LABEL[type] ?? type
}

// A contractual employee is flagged for renewal this many days before their end date.
export const RENEWAL_NOTICE_DAYS = 30

/** Whole calendar days between two dates in UTC (positive when `to` is later). */
function dayDiff(from: Date, to: Date): number {
	const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
	const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
	return Math.round((b - a) / 86_400_000)
}

/**
 * Renewal standing for a contractual employee as of `asOf` (default: now): whole days
 * until the contract ends (negative once expired), whether it has expired, and whether
 * it is inside the renewal-notice window and so due for a decision.
 */
export function contractRenewalStatus(endDate: Date, asOf: Date = new Date()) {
	const daysUntil = dayDiff(asOf, endDate)
	return {
		daysUntil,
		expired: daysUntil < 0,
		dueForRenewal: daysUntil >= 0 && daysUntil <= RENEWAL_NOTICE_DAYS
	}
}
