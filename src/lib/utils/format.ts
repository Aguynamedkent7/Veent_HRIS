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

export function formatFullName(
	firstName: string,
	lastName: string,
	middleName?: string | null
): string {
	if (middleName) return `${lastName}, ${firstName} ${middleName[0]}.`
	return `${lastName}, ${firstName}`
}
