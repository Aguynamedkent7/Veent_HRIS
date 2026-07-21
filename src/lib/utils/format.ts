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

export function formatFullName(
	firstName: string,
	lastName: string,
	middleName?: string | null
): string {
	if (middleName) return `${lastName}, ${firstName} ${middleName[0]}.`
	return `${lastName}, ${firstName}`
}
