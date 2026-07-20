/**
 * Rate basis presentation (#120).
 *
 * `Employee.basicMonthlySalary` holds a fixed monthly salary for MONTHLY staff and a per-hour rate
 * for HOURLY staff — one column, two meanings. The amount field's LABEL is the only thing telling
 * HR which figure to type, so it is derived here and shared by the create and edit forms rather
 * than duplicated (a ₱100/hr rate typed into a monthly field is a 176× payroll error).
 *
 * Client-confirmed (#122): monthly and hourly are the only two bases. There is no daily rate.
 */

export type RateBasis = 'MONTHLY' | 'HOURLY'

export const RATE_BASIS_OPTIONS: { value: RateBasis; label: string }[] = [
	{ value: 'MONTHLY', label: 'Monthly salary' },
	{ value: 'HOURLY', label: 'Hourly rate' }
]

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
	return basis === 'HOURLY'
		? {
				label: 'Hourly Rate (PHP)',
				step: '1',
				hint: 'Paid per hour actually worked. Statutory contributions use a monthly equivalent.',
				suffix: '/hr'
			}
		: {
				label: 'Basic Monthly Salary (PHP)',
				step: '1000',
				hint: 'Fixed each period. Lateness and absences come off as separate deduction lines.',
				suffix: '/mo'
			}
}
