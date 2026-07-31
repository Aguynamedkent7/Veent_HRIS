/**
 * Rate basis presentation and the rate/employment-type pairing (#120, #189).
 *
 * `Employee.basicMonthlySalary` holds a fixed monthly salary for MONTHLY staff, a per-day rate for
 * DAILY staff and a per-hour rate for HOURLY staff — one column, three meanings. The amount
 * field's LABEL is the only thing telling HR which figure to type, so it is derived here and
 * shared by the create and edit forms rather than duplicated (a ₱100/hr rate typed into a monthly
 * field is a 176× payroll error).
 *
 * #122 removed DAILY on the basis that staff are either salaried or hourly. #189 reverses that
 * and additionally restricts HOURLY to part-time and on-call staff, which is why the allowed
 * pairing lives here too — the forms filter the dropdown with it and the server validates with
 * the same function, so the two cannot disagree.
 */

export type RateBasis = 'MONTHLY' | 'DAILY' | 'HOURLY'

export const RATE_BASIS_OPTIONS: { value: RateBasis; label: string }[] = [
	{ value: 'MONTHLY', label: 'Monthly salary' },
	{ value: 'DAILY', label: 'Daily rate' },
	{ value: 'HOURLY', label: 'Hourly rate' }
]

/**
 * Employment types that may be paid hourly (#189). Everyone else is salaried or on a daily rate;
 * an hourly regular employee is a data-entry mistake, not a scenario.
 */
export const HOURLY_EMPLOYMENT_TYPES = ['PART_TIME', 'ON_CALL'] as const

export function isRateBasisAllowed(basis: RateBasis, employmentType: string): boolean {
	if (basis !== 'HOURLY') return true
	return (HOURLY_EMPLOYMENT_TYPES as readonly string[]).includes(employmentType)
}

/** Bases offered for an employment type — used to build the dropdown. */
export function rateBasisOptionsFor(employmentType: string) {
	return RATE_BASIS_OPTIONS.filter((o) => isRateBasisAllowed(o.value, employmentType))
}

/** Message shown when the pairing is rejected. */
export const RATE_BASIS_MISMATCH =
	'An hourly rate applies only to part-time and on-call employees. Use a monthly salary or a daily rate.'

interface RateBasisCopy {
	/** Label for the amount input. */
	label: string
	/** Step increment — thousands for a salary, ones for an hourly rate. */
	step: string
	/** Helper text under the input. */
	hint: string
	/** Suffix for read-only displays of the amount. */
	suffix: string
}

export function rateBasisCopy(basis: RateBasis): RateBasisCopy {
	switch (basis) {
		case 'HOURLY':
			return {
				label: 'Hourly Rate (PHP)',
				step: '1',
				hint: 'Paid per hour actually worked. Statutory contributions use a monthly equivalent.',
				suffix: '/hr'
			}
		case 'DAILY':
			return {
				label: 'Daily Rate (PHP)',
				step: '50',
				hint: 'Paid per day actually worked — a half day pays half. Statutory contributions use a monthly equivalent.',
				suffix: '/day'
			}
		default:
			return {
				label: 'Basic Monthly Salary (PHP)',
				step: '1000',
				hint: 'Fixed each period. Lateness and absences come off as separate deduction lines.',
				suffix: '/mo'
			}
	}
}
