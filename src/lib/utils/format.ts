const PHP = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

export function formatCurrency(amount: number | string): string {
	return PHP.format(Number(amount))
}

export function formatDate(date: Date | string): string {
	return new Date(date).toLocaleDateString('en-PH', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	})
}

export function formatShortDate(date: Date | string): string {
	return new Date(date).toLocaleDateString('en-PH', {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	})
}

// Short date span, collapsing same-day ranges to a single date. Comparing the
// formatted strings (not Date identity — two Date objects are never ===) also
// collapses ranges that differ only by time-of-day.
export function formatDateRange(from: Date | string, to?: Date | string | null): string {
	const start = formatShortDate(from)
	if (!to) return start
	const end = formatShortDate(to)
	return end === start ? start : `${start} – ${end}`
}

// Mask a bank/GCash account number for display: separators stripped, everything but
// the last 4 characters hidden. Values that are 4 chars or shorter after stripping
// are fully masked so short numbers never leak. Null passes through so `?? '—'`
// placeholders keep working.
export function maskAccountNumber(value: string | null): string | null {
	if (value == null) return null
	const compact = value.replace(/[\s-]/g, '')
	if (compact.length <= 4) return '••••'
	return `•••• ${compact.slice(-4)}`
}

// Salary is masked whole, never last-4: even the trailing digits leak its magnitude (#111).
export const MASKED_SALARY = '••••••'

// The employee fields never sent to the client in cleartext (#111). The account-style numbers
// show their last 4 via maskAccountNumber; basicMonthlySalary is masked whole (below). Full
// values are reachable only through the audited revealEmployeeSensitive service call.
export const SENSITIVE_ACCOUNT_FIELDS = [
	'sssNumber',
	'philhealthNumber',
	'pagibigNumber',
	'tinNumber',
	'bankAccountNumber',
	'gcashNumber'
] as const

// Every masked field, for the reveal audit's field list.
export const SENSITIVE_FIELDS = [...SENSITIVE_ACCOUNT_FIELDS, 'basicMonthlySalary'] as const

// The masked shape of an employee record: salary comes back as the string sentinel (or null),
// never a number, so a masked value can never be used in arithmetic without a compile error.
// Account-style fields are already string | null, so they need no override.
export type MaskedEmployee<T> = Omit<T, 'basicMonthlySalary'> & {
	basicMonthlySalary: string | null
}

// Shallow copy of an employee record with every sensitive field masked: account-style numbers
// reduced to their last 4, salary replaced by a fixed sentinel. A field already null stays null
// (nothing to reveal); non-sensitive fields are untouched. Only masks keys that are present, so
// it is safe on partial selects. The single masking transform every consumer inherits (#111).
export function maskEmployee<T extends Record<string, unknown>>(employee: T): MaskedEmployee<T> {
	const masked: Record<string, unknown> = { ...employee }
	for (const field of SENSITIVE_ACCOUNT_FIELDS) {
		if (field in masked) masked[field] = maskAccountNumber(masked[field] as string | null)
	}
	if ('basicMonthlySalary' in masked) {
		masked.basicMonthlySalary = masked.basicMonthlySalary == null ? null : MASKED_SALARY
	}
	return masked as MaskedEmployee<T>
}

export function formatFullName(
	firstName: string,
	lastName: string,
	middleName?: string | null
): string {
	if (middleName) return `${lastName}, ${firstName} ${middleName[0]}.`
	return `${lastName}, ${firstName}`
}
