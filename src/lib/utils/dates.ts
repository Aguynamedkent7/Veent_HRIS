export function getWeekStart(date: Date): Date {
	const d = new Date(date)
	const day = d.getDay() // 0 = Sunday, 1 = Monday, ...
	// Adjust to Monday (if Sunday, go back 6 days; otherwise go back (day - 1) days)
	const diff = day === 0 ? -6 : 1 - day
	d.setDate(d.getDate() + diff)
	d.setHours(0, 0, 0, 0)
	return d
}

export function getWeekEnd(date: Date): Date {
	const start = getWeekStart(date)
	const d = new Date(start)
	d.setDate(d.getDate() + 6) // Sunday
	d.setHours(23, 59, 59, 0)
	return d
}

export function computeWorkingDays(start: Date, end: Date, holidays: Date[]): number {
	const holidaySet = new Set(holidays.map((h) => h.toISOString().slice(0, 10)))
	let count = 0
	const cur = new Date(start)
	cur.setHours(0, 0, 0, 0)
	const endDay = new Date(end)
	endDay.setHours(0, 0, 0, 0)

	while (cur <= endDay) {
		const day = cur.getDay()
		const iso = cur.toISOString().slice(0, 10)
		if (day !== 0 && day !== 6 && !holidaySet.has(iso)) {
			count++
		}
		cur.setDate(cur.getDate() + 1)
	}
	return count
}

export function formatDateISO(date: Date): string {
	const y = date.getFullYear()
	const m = String(date.getMonth() + 1).padStart(2, '0')
	const d = String(date.getDate()).padStart(2, '0')
	return `${y}-${m}-${d}`
}

export function formatDateDisplay(date: Date): string {
	return date.toLocaleDateString('en-PH', {
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	})
}
