/**
 * Configurable PH premium pay multipliers (PAY-003).
 *
 * Per the clarified decision, rates live in config (seeded with DOLE defaults) so they can be
 * edited per organization without a code change. This module holds the defaults and a pure
 * resolver; the DB-backed loader (from `PayRateRule`/`EarningType`) wraps `resolveRates()` and
 * is wired in once the schema lands (PAY-001/PAY-009).
 *
 * Multipliers are expressed against the base hourly rate:
 *   - `overtime`        ordinary-day OT hourly = base × 1.25
 *   - `overtimePremium` extra factor for OT worked on a premium day (rest day / holiday): +30%
 *   - `nightDiff`       night-shift differential added on top for 10pm–6am hours: +10%
 *   - `restDay`         rest-day work = base × 1.30
 *   - `regularHoliday`  regular-holiday work = base × 2.00 (100% premium)
 *   - `specialHoliday`  special-non-working-holiday work = base × 1.30
 * Combined day-type OT is derived (e.g. rest-day OT = restDay × overtimePremium = 1.69).
 */

export interface PayRates {
	overtime: number
	overtimePremium: number
	nightDiff: number
	restDay: number
	regularHoliday: number
	specialHoliday: number
}

export const DOLE_DEFAULT_RATES: PayRates = {
	overtime: 1.25,
	overtimePremium: 1.3,
	nightDiff: 0.1,
	restDay: 1.3,
	regularHoliday: 2.0,
	specialHoliday: 1.3
}

/** Merge org-specific overrides over the DOLE defaults. */
export function resolveRates(overrides?: Partial<PayRates>): PayRates {
	return { ...DOLE_DEFAULT_RATES, ...(overrides ?? {}) }
}

/** The multiplier keys, in display order — the single source of truth for the config UI + schema. */
export const RATE_KEYS = [
	'overtime',
	'overtimePremium',
	'nightDiff',
	'restDay',
	'regularHoliday',
	'specialHoliday'
] as const

/**
 * Convert a persisted `PayRateRule` row (Prisma Decimals) into resolved `PayRates`, falling back to
 * the DOLE defaults when the org has no row yet. Accepts a loose shape so `rates.ts` stays Prisma-free.
 */
export function ratesFromRule(
	rule: Partial<Record<keyof PayRates, unknown>> | null | undefined
): PayRates {
	if (!rule) return { ...DOLE_DEFAULT_RATES }
	const out = { ...DOLE_DEFAULT_RATES }
	for (const k of RATE_KEYS) {
		const n = Number(rule[k])
		if (Number.isFinite(n)) out[k] = n
	}
	return out
}
