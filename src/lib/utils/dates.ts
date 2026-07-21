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
	// All weekday and day-key math runs in Philippine Standard Time (#105). Mixing a
	// local `getDay()` with a UTC `toISOString()` slice let a UTC (or any non-PHT) server
	// bucket a boundary date onto the wrong calendar day, so leave/working-day counts
	// disagreed with the PHT attendance helpers by a day. Keying both the iterated day and
	// the holiday set through the same PHT helpers keeps them consistent on any server.
	const holidaySet = new Set(holidays.map(manilaDayKey))
	let count = 0
	let cur = manilaDayStart(start) // 00:00 PHT of start's PHT day
	const last = manilaDayStart(end) // 00:00 PHT of end's PHT day
	while (cur <= last) {
		const weekday = new Date(cur.getTime() + MANILA_OFFSET_MS).getUTCDay() // 0=Sun…6=Sat in PHT
		if (weekday !== 0 && weekday !== 6 && !holidaySet.has(manilaDayKey(cur))) {
			count++
		}
		cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000) // +1 PHT day (PHT has no DST)
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

// ─── Tenure (#136) ───────────────────────────────────────────────────────────
// Length of service, in whole calendar months. Both ends are bucketed through the
// PHT helpers above before comparing: mixing local and UTC parts is the same
// off-by-one-day bug class documented on computeWorkingDays, and here it would let
// an employee's displayed tenure disagree with the 6-month regularization gate.

/**
 * Whole calendar months from `startDate` to `endDate` (default: now). The month only
 * counts once the day-of-month is reached, so 11 months + 30 days is still 11.
 * Never negative — a future start date reads as 0.
 */
export function monthsOfService(startDate: Date, endDate: Date = new Date()): number {
	const [sy, sm, sd] = manilaDayKey(startDate).split('-').map(Number)
	const [ey, em, ed] = manilaDayKey(endDate).split('-').map(Number)
	let months = (ey - sy) * 12 + (em - sm)
	// The anniversary day hasn't come round yet this month.
	if (ed < sd) months--
	return Math.max(0, months)
}

/**
 * Human tenure, e.g. "2 years, 3 months" / "5 months" / "1 year". Anything under a
 * month reads "less than a month" rather than "0 months". Pass `endDate` for
 * offboarded staff so their tenure freezes at their last day.
 */
export function tenureLabel(startDate: Date, endDate?: Date): string {
	const total = monthsOfService(startDate, endDate ?? new Date())
	if (total < 1) return 'less than a month'
	const years = Math.floor(total / 12)
	const months = total % 12
	const parts: string[] = []
	if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`)
	if (months) parts.push(`${months} month${months === 1 ? '' : 's'}`)
	return parts.join(', ')
}
