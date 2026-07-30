/**
 * Earnings engine (PAY-005) — pure, side-effect-free.
 * Turns an employee's compensation + a period's attendance buckets into itemized earning
 * components. Multipliers come from the resolved `PayRates` config, never hard-coded.
 *
 * Money is exact end to end (#119): every component is built in `Decimal` and quantized exactly
 * once, at the line itself. Totals are the sum of the already-quantized lines (lines-authoritative
 * reconciliation), so a payslip's earnings always add up to its gross.
 */

import type {
	AttendanceInput,
	ComputeSegment,
	EarningsResult,
	EmployeeComp,
	PayAdjustments,
	PayComponent
} from './types'
import { basicPayBasis, hourlyRateOf } from './types'
import { D, q2n, sum, sumQ, type Money } from './money'
import { resolveRates, type PayRates } from './rates'

/** Quantize a component's exact amount once — this is the line's last step. */
function line(code: string, label: string, amount: Money, taxable: boolean): PayComponent {
	return { code, label, amount: q2n(amount), taxable }
}

export function computeEarnings(
	comp: EmployeeComp,
	att: AttendanceInput,
	adjustments: PayAdjustments = {},
	ratesOverride?: Partial<PayRates>,
	opts: {
		periodShare?: number
		basicSegments?: { salary: Money; weight: Money }[]
		segments?: ComputeSegment[]
	} = {}
): EarningsResult {
	const rates = resolveRates(ratesOverride)
	const hr = hourlyRateOf(comp)
	const periodShare = D(opts.periodShare ?? 1)

	/** Hours × hourly rate × premium multiplier, all exact. */
	const at = (hours: number, ...multipliers: number[]) =>
		multipliers.reduce<Money>((acc, m) => acc.times(D(m)), D(hours).times(hr))

	// #121: MONTHLY staff are on a fixed salary, so basic is the prorated monthly amount and does
	// not shrink with hours. Everyone else is paid for hours actually worked. The hourly rate is
	// still needed either way — OT, night diff, holiday premiums and the tardiness valuation all
	// derive from it.
	//
	// #170: a mid-period salary change day-splits the fixed basic into weighted segments (Σ weight
	// == periodShare, working-day weighted). Carried exact and quantized once at the line below, so
	// a single full-period segment (weight == periodShare) reproduces the un-split figure byte for
	// byte. Absent → today's `× periodShare`.
	//
	// #170 Stage 2: a mixed-basis split (hourly/daily rate change, or a MONTHLY↔hourly flip) values
	// BASIC per segment by that segment's OWN basis — FIXED → salary × weight, hourly → segment hours
	// × its hourly rate — summed exact, one q2 at the line. Premiums below stay valued from the
	// AGGREGATE attendance at the period-end `hr` (decided; not split per segment).
	const segBasic = (s: ComputeSegment): Money =>
		basicPayBasis(s.comp) === 'FIXED'
			? D(s.comp.basicMonthlySalary).times(s.weight)
			: D(s.attendance.regularHours).times(hourlyRateOf(s.comp))

	const basicPay = opts.segments
		? sum(opts.segments.map(segBasic))
		: basicPayBasis(comp) === 'FIXED'
			? opts.basicSegments
				? sum(opts.basicSegments.map((s) => s.salary.times(s.weight)))
				: D(comp.basicMonthlySalary).times(periodShare)
			: at(att.regularHours)

	const candidates: PayComponent[] = [
		line('BASIC', 'Basic pay', basicPay, true),
		line('OT', 'Overtime', at(att.overtimeHours, rates.overtime), true),
		line('NIGHT_DIFF', 'Night differential', at(att.nightDiffHours, rates.nightDiff), true),
		line('REST_DAY', 'Rest day', at(att.restDayHours, rates.restDay), true),
		line(
			'REST_DAY_OT',
			'Rest day OT',
			at(att.restDayOtHours, rates.restDay, rates.overtimePremium),
			true
		),
		line('REG_HOLIDAY', 'Regular holiday', at(att.regularHolidayHours, rates.regularHoliday), true),
		line(
			'REG_HOLIDAY_OT',
			'Regular holiday OT',
			at(att.regularHolidayOtHours, rates.regularHoliday, rates.overtimePremium),
			true
		),
		line(
			'SPECIAL_HOLIDAY',
			'Special holiday',
			at(att.specialHolidayHours, rates.specialHoliday),
			true
		),
		line(
			'SPECIAL_HOLIDAY_OT',
			'Special holiday OT',
			at(att.specialHolidayOtHours, rates.specialHoliday, rates.overtimePremium),
			true
		),
		// Allowances are treated as non-taxable (de-minimis assumption); incentives are taxable.
		line('ALLOWANCE', 'Allowances', D(adjustments.allowances ?? 0), false),
		line('INCENTIVE', 'Incentives', D(adjustments.incentives ?? 0), true)
	]

	const components = candidates.filter((c) => c.amount !== 0)
	// Lines-authoritative: totals are sums of quantized lines, so they reconcile by construction
	// and need no further rounding.
	const gross = sumQ(components.map((c) => c.amount))
	const taxableGross = sumQ(components.filter((c) => c.taxable).map((c) => c.amount))

	return {
		hourlyRate: q2n(hr),
		components,
		gross: gross.toNumber(),
		taxableGross: taxableGross.toNumber(),
		nonTaxableGross: gross.minus(taxableGross).toNumber()
	}
}
