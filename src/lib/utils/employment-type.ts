/**
 * Effective-dated employment type (#222). Pure and DB-free, mirroring `currentCompensation`
 * (#170 Stage 1.5): the EmployeeEmploymentType snapshot is the truth, `Employee.employmentType` is a
 * cache healed on read, and a future-dated row stays dormant until its date arrives — so a promotion
 * effective next Monday needs no scheduler.
 */

import type { EmploymentType } from '@prisma/client'
import { utcMidnight } from './pay-periods'

/**
 * The employment types with their display labels, PROBATIONARY first so it is the browser's default
 * selection on the create form (#136/#188). Shared by the create and promote forms — a duplicated
 * copy is how "REGULAR" was still being shown as "Full Time" long after #172 renamed it.
 */
export const EMPLOYMENT_TYPE_OPTIONS = [
	['PROBATIONARY', 'Probationary'],
	['REGULAR', 'Regular'],
	['CONTRACTUAL', 'Contractual'],
	['PART_TIME', 'Part-time'],
	['ON_CALL', 'On-call'],
	['INTERN', 'Intern']
] as const satisfies readonly (readonly [EmploymentType, string])[]

/** The bare values, for `z.enum` — so adding an enum member can't leave a validator behind. */
export const EMPLOYMENT_TYPES = EMPLOYMENT_TYPE_OPTIONS.map(([value]) => value) as unknown as [
	EmploymentType,
	...EmploymentType[]
]

/** One persisted `EmployeeEmploymentType` row (loose shape — independent of the Prisma client type). */
export interface EmploymentTypeRow {
	employmentType: EmploymentType
	effectiveDate: Date
	changedAt: Date
}

/**
 * The employment type in effect at `asOf`: the latest snapshot with effectiveDate ≤ asOf
 * (UTC-midnight, `changedAt` tiebreak on a same-day pair), else `fallback`. A correction backdated
 * below a later change therefore never moves the current value.
 */
export function employmentTypeAt(
	history: EmploymentTypeRow[],
	asOf: Date,
	fallback: EmploymentType
): EmploymentType {
	const t = utcMidnight(asOf).getTime()
	let picked: { type: EmploymentType; eff: number; seq: number } | undefined
	for (const r of history) {
		const eff = utcMidnight(r.effectiveDate).getTime()
		if (eff > t) continue
		const seq = r.changedAt.getTime()
		if (!picked || eff > picked.eff || (eff === picked.eff && seq > picked.seq)) {
			picked = { type: r.employmentType, eff, seq }
		}
	}
	return picked?.type ?? fallback
}
