/**
 * Earnings engine (PAY-005) — pure, side-effect-free.
 * Turns an employee's compensation + a period's attendance buckets into itemized earning
 * components. Multipliers come from the resolved `PayRates` config, never hard-coded.
 */

import type {
	AttendanceInput,
	EarningsResult,
	EmployeeComp,
	PayAdjustments,
	PayComponent
} from './types'
import { hourlyRateOf, round2 } from './types'
import { resolveRates, type PayRates } from './rates'

function line(code: string, label: string, amount: number, taxable: boolean): PayComponent {
	return { code, label, amount: round2(amount), taxable }
}

export function computeEarnings(
	comp: EmployeeComp,
	att: AttendanceInput,
	adjustments: PayAdjustments = {},
	ratesOverride?: Partial<PayRates>
): EarningsResult {
	const rates = resolveRates(ratesOverride)
	const hr = hourlyRateOf(comp)

	const candidates: PayComponent[] = [
		line('BASIC', 'Basic pay', att.regularHours * hr, true),
		line('OT', 'Overtime', att.overtimeHours * hr * rates.overtime, true),
		line('NIGHT_DIFF', 'Night differential', att.nightDiffHours * hr * rates.nightDiff, true),
		line('REST_DAY', 'Rest day', att.restDayHours * hr * rates.restDay, true),
		line(
			'REST_DAY_OT',
			'Rest day OT',
			att.restDayOtHours * hr * rates.restDay * rates.overtimePremium,
			true
		),
		line(
			'REG_HOLIDAY',
			'Regular holiday',
			att.regularHolidayHours * hr * rates.regularHoliday,
			true
		),
		line(
			'REG_HOLIDAY_OT',
			'Regular holiday OT',
			att.regularHolidayOtHours * hr * rates.regularHoliday * rates.overtimePremium,
			true
		),
		line(
			'SPECIAL_HOLIDAY',
			'Special holiday',
			att.specialHolidayHours * hr * rates.specialHoliday,
			true
		),
		line(
			'SPECIAL_HOLIDAY_OT',
			'Special holiday OT',
			att.specialHolidayOtHours * hr * rates.specialHoliday * rates.overtimePremium,
			true
		),
		// Allowances are treated as non-taxable (de-minimis assumption); incentives are taxable.
		line('ALLOWANCE', 'Allowances', adjustments.allowances ?? 0, false),
		line('INCENTIVE', 'Incentives', adjustments.incentives ?? 0, true)
	]

	const components = candidates.filter((c) => c.amount !== 0)
	const gross = round2(components.reduce((s, c) => s + c.amount, 0))
	const taxableGross = round2(components.filter((c) => c.taxable).reduce((s, c) => s + c.amount, 0))

	return {
		hourlyRate: round2(hr),
		components,
		gross,
		taxableGross,
		nonTaxableGross: round2(gross - taxableGross)
	}
}
