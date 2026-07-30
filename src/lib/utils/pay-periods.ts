// Standard Philippine pay-period shapes (#129). The client runs a semi-monthly cadence:
//   • FIRST_HALF   — the 1st through the 15th
//   • SECOND_HALF  — the 16th through the (dynamic) end of month
//   • WHOLE_MONTH  — the 1st through the end of month (benefits / adjustment runs)
//
// Periods are represented as UTC-midnight calendar dates (`new Date(Date.UTC(y, m, d))`),
// matching the `<input type="date">` convention used across the app — a date input value
// of "2026-05-01" parses to exactly this instant, so pickers and stored rows round-trip
// without timezone drift. The data model is unchanged; the shape lives in this helper, the
// service layer, and the UI. Legacy off-cycle rows with arbitrary dates stay readable —
// `describePeriod`/`isValidStandardPeriod` simply report them as non-standard.

export type PeriodKind = 'FIRST_HALF' | 'SECOND_HALF' | 'WHOLE_MONTH'

export const PERIOD_KINDS: readonly PeriodKind[] = ['FIRST_HALF', 'SECOND_HALF', 'WHOLE_MONTH']

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
]

/** Number of days in the given month. `month0` is 0-based (0 = January). */
export function daysInMonth(year: number, month0: number): number {
	// Day 0 of the next month is the last day of this one.
	return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
}

/** UTC-midnight calendar date. */
function utcDay(year: number, month0: number, day: number): Date {
	return new Date(Date.UTC(year, month0, day))
}

/** Bounds of a standard period. `month0` is 0-based; the end date is inclusive. */
export function periodOf(
	kind: PeriodKind,
	year: number,
	month0: number
): { periodStart: Date; periodEnd: Date } {
	const eom = daysInMonth(year, month0)
	switch (kind) {
		case 'FIRST_HALF':
			return { periodStart: utcDay(year, month0, 1), periodEnd: utcDay(year, month0, 15) }
		case 'SECOND_HALF':
			return { periodStart: utcDay(year, month0, 16), periodEnd: utcDay(year, month0, eom) }
		case 'WHOLE_MONTH':
			return { periodStart: utcDay(year, month0, 1), periodEnd: utcDay(year, month0, eom) }
	}
}

/** Inclusive day count of a period (FIRST_HALF is always 15; the others vary by month). */
export function periodDays(start: Date, end: Date): number {
	const ms = utcMidnight(end).getTime() - utcMidnight(start).getTime()
	return Math.round(ms / (24 * 60 * 60 * 1000)) + 1
}

/** UTC-midnight first calendar day of `d`'s month — the statutory basis anchor for #170/#171. */
export function firstDayOfMonth(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

/** Drop any intra-day component so comparisons are on the calendar day only. */
export function utcMidnight(d: Date): Date {
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * Classify a stored (start, end) pair. Returns the matched `kind` (or null when the pair
 * isn't one of the three standard shapes) plus display metadata. `label` reads e.g.
 * "May 2026 · 1–15", "May 2026 · 16–31", or "May 2026 · Whole month"; non-standard pairs
 * fall back to a plain range label so legacy rows still render.
 */
export function describePeriod(
	start: Date,
	end: Date
): { kind: PeriodKind | null; year: number; month0: number; label: string } {
	const s = utcMidnight(start)
	const e = utcMidnight(end)
	const year = s.getUTCFullYear()
	const month0 = s.getUTCMonth()
	const monthName = MONTH_NAMES[month0]

	// A standard period never spans two months, so start and end share year+month.
	const sameMonth = e.getUTCFullYear() === year && e.getUTCMonth() === month0
	if (sameMonth) {
		const startDay = s.getUTCDate()
		const endDay = e.getUTCDate()
		const eom = daysInMonth(year, month0)
		if (startDay === 1 && endDay === 15)
			return { kind: 'FIRST_HALF', year, month0, label: `${monthName} ${year} · 1–15` }
		if (startDay === 16 && endDay === eom)
			return { kind: 'SECOND_HALF', year, month0, label: `${monthName} ${year} · 16–${eom}` }
		if (startDay === 1 && endDay === eom)
			return { kind: 'WHOLE_MONTH', year, month0, label: `${monthName} ${year} · Whole month` }
	}

	// Non-standard / legacy row: describe the raw range without a kind.
	return { kind: null, year, month0, label: `${formatDay(s)} – ${formatDay(e)}` }
}

function formatDay(d: Date): string {
	return `${MONTH_NAMES[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/** True when (start, end) is exactly one of the three standard period shapes. */
export function isValidStandardPeriod(start: Date, end: Date): boolean {
	return describePeriod(start, end).kind !== null
}

/**
 * Fraction of a monthly figure that accrues in this period, for statutory proration (#129):
 * a WHOLE_MONTH run carries the full month (1); FIRST_HALF / SECOND_HALF carry half (0.5).
 * Non-standard legacy periods fall back to the caller-supplied default (semi-monthly 0.5),
 * preserving prior behavior.
 */
export function periodShareOf(start: Date, end: Date, fallback = 0.5): number {
	const kind = describePeriod(start, end).kind
	if (kind === 'WHOLE_MONTH') return 1
	if (kind === 'FIRST_HALF' || kind === 'SECOND_HALF') return 0.5
	return fallback
}

/** Human range for a picker preview, e.g. "May 1 – May 15, 2026 (15 days)". */
export function formatPeriodPreview(start: Date, end: Date): string {
	const s = utcMidnight(start)
	const e = utcMidnight(end)
	const startStr = `${MONTH_NAMES[s.getUTCMonth()].slice(0, 3)} ${s.getUTCDate()}`
	const endStr = `${MONTH_NAMES[e.getUTCMonth()].slice(0, 3)} ${e.getUTCDate()}, ${e.getUTCFullYear()}`
	return `${startStr} – ${endStr} (${periodDays(s, e)} days)`
}

/** YYYY-MM-DD of a UTC-midnight period date, for `<input type="date">` / hidden fields. */
export function toPeriodInputValue(d: Date): string {
	return utcMidnight(d).toISOString().slice(0, 10)
}
