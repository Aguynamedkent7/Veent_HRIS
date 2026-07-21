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

// ─── Philippine Standard Time (UTC+8) helpers ────────────────────────────────
// PHT has no daylight saving, so a fixed +8h offset is exact. Timestamps are
// stored in UTC; these helpers bucket a UTC instant into PHT calendar days and
// weeks. "Shift +8h then read the UTC parts" yields the PHT wall-clock values.

export const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000

/** Calendar day (YYYY-MM-DD) of `date` in Philippine Standard Time. */
export function manilaDayKey(date: Date): string {
	return new Date(date.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10)
}

/** Human-readable PHT timestamp for messages, e.g. "Jul 16, 2026, 5:00 PM PHT". */
export function manilaDateTime(date: Date): string {
	const s = date.toLocaleString('en-US', {
		timeZone: 'Asia/Manila',
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	})
	return `${s} PHT`
}

/** UTC instant corresponding to 00:00 PHT of the PHT day containing `date`. */
export function manilaDayStart(date: Date): Date {
	const [y, m, d] = manilaDayKey(date).split('-').map(Number)
	return new Date(Date.UTC(y, m - 1, d) - MANILA_OFFSET_MS)
}

/** UTC instant of 00:00 PHT on the Monday of the PHT week containing `date`. */
export function manilaWeekStart(date: Date): Date {
	const shifted = new Date(date.getTime() + MANILA_OFFSET_MS)
	const day = shifted.getUTCDay() // 0 = Sun … 6 = Sat, in PHT
	const diff = day === 0 ? -6 : 1 - day
	return new Date(
		Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + diff) -
			MANILA_OFFSET_MS
	)
}

/** UTC instant of the last millisecond of the PHT week containing `date` (Sun 23:59:59.999 PHT). */
export function manilaWeekEnd(date: Date): Date {
	return new Date(manilaWeekStart(date).getTime() + 7 * 24 * 60 * 60 * 1000 - 1)
}
