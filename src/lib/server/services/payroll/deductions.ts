/**
 * Deductions engine (PAY-007) — pure, side-effect-free.
 *
 * Covers the NEW deduction logic (tardiness + loan/cash-advance amortization) and composes it
 * with the already-tested statutory results from `ph-statutory.ts`. Amortization is a fixed
 * installment per period, capped at the outstanding balance, and SKIPPED (not carried or
 * partially applied) when the remaining net can't cover it — per the clarified decision.
 *
 * Money is exact end to end (#119). Each line is computed in `Decimal` and quantized exactly once;
 * `total` is the sum of the quantized lines and `net` is `gross − total`, so the payslip
 * reconciles by construction (lines-authoritative — see `money.ts`).
 */

import type { PayComponent } from './types'
import { D, q2, q2n, sumQ, ZERO, type Money, type MoneyLike } from './money'

export interface AmortItem {
	refId: string
	label: string
	installment: MoneyLike
	balance: MoneyLike
}

export interface AmortResult {
	applied: PayComponent[]
	/** Exact remaining net after the applied installments. */
	remainingNet: Money
	/** New balance per refId after applying installments, at the column's scale-2. */
	balances: Record<string, number>
}

/**
 * Tardiness/undertime deduction: unpaid minutes valued at the hourly rate, EXACT.
 *
 * Only meaningful for fixed-basic (MONTHLY) employees — see `basicPayBasis`. Callers must pass
 * 0 minutes for hourly staff, whose `regularHours` is already net of the lateness (#121).
 */
export function computeTardiness(
	hourlyRate: MoneyLike,
	lateMinutes: number,
	undertimeMinutes: number
): Money {
	return D(lateMinutes).plus(undertimeMinutes).dividedBy(60).times(D(hourlyRate))
}

/**
 * Absence deduction: unworked scheduled hours valued at the hourly rate, EXACT. Fixed-basic
 * employees only — with a salary that does not shrink with hours, absences would otherwise be
 * free (#121).
 */
export function computeAbsence(hourlyRate: MoneyLike, absenceHours: MoneyLike): Money {
	const hours = D(absenceHours)
	return hours.lt(0) ? ZERO : hours.times(D(hourlyRate))
}

/**
 * Apply fixed installments in order against the available net. Each installment is capped at the
 * item's balance; an item is skipped entirely if `availableNet` can't cover the due amount.
 */
export function applyAmortizations(
	items: AmortItem[],
	availableNet: MoneyLike,
	codePrefix = 'LOAN'
): AmortResult {
	const applied: PayComponent[] = []
	const balances: Record<string, number> = {}
	let net = D(availableNet)

	for (const item of items) {
		const installment = D(item.installment)
		const balance = D(item.balance)
		// The installment is a payable line, so it quantizes here — once.
		const due = q2(installment.lt(balance) ? installment : balance)

		if (due.gt(0) && net.gte(due)) {
			applied.push({
				code: codePrefix,
				label: item.label,
				amount: due.toNumber(),
				taxable: false,
				refId: item.refId
			})
			net = net.minus(due)
			// Balance and installment are both scale-2, so the decrement introduces no drift and
			// the running balance stays reconcilable against the original principal (#119 §5).
			balances[item.refId] = q2n(balance.minus(due))
		} else {
			// Skipped this period — balance unchanged.
			balances[item.refId] = q2n(balance)
		}
	}

	return { applied, remainingNet: net, balances }
}

export interface StatutoryEe {
	sssEe: MoneyLike
	philhealthEe: MoneyLike
	pagibigEe: MoneyLike
	withholdingTax: MoneyLike
}

export interface DeductionsResult {
	components: PayComponent[]
	total: number
	net: number
	loanBalances: Record<string, number>
	cashAdvanceBalances: Record<string, number>
	/**
	 * Deductions gross could not fund this period (#103): discretionary lines skipped whole, plus
	 * any mandatory excess written off via `UNRECOVERED`. Zero in the normal case. Callers surface
	 * this as a review flag — a floored net is never silent.
	 */
	uncollected: number
}

/**
 * Take fixed lines in order for as long as gross can fund them (#103). A line that does not fit
 * is skipped WHOLE rather than partially taken — the same rule `applyAmortizations` uses for
 * loans, so a payslip never shows a half-collected deduction.
 */
function applyIfAffordable(
	items: PayComponent[],
	availableNet: MoneyLike
): { applied: PayComponent[]; remainingNet: Money; skipped: Money } {
	const applied: PayComponent[] = []
	let net = D(availableNet)
	let skipped = ZERO

	for (const item of items) {
		const due = q2(item.amount)
		if (due.gt(0) && net.gte(due)) {
			applied.push(item)
			net = net.minus(due)
		} else if (due.gt(0)) {
			skipped = skipped.plus(due)
		}
	}

	return { applied, remainingNet: net, skipped }
}

/**
 * Compose all deductions for one payroll entry and return the itemized list + net pay.
 * Order: statutory EE (SSS/PhilHealth/Pag-IBIG) → withholding tax → tardiness → absence →
 * recurring custom deductions → loans → cash advances.
 *
 * #103 — **net never goes negative.** The floor is achieved by not TAKING what gross can't fund,
 * never by clamping the total, so the lines-authoritative invariant (`net === gross − Σ lines`)
 * survives and the payslip still adds up. Everything from `recurring` onward is discretionary and
 * gated on the remaining net; only the mandatory block above it is unconditional, and if that
 * alone exceeds gross a balancing `UNRECOVERED` credit brings net to exactly 0.
 *
 * Skipped amounts are a write-off for the period, not arrears — loan/cash-advance balances are
 * left untouched for anything not actually withheld, so nothing is collected twice later.
 */
export function computeDeductions(params: {
	gross: MoneyLike
	hourlyRate: MoneyLike
	lateMinutes: number
	undertimeMinutes: number
	/** Unworked scheduled hours (fixed-basic employees only); 0 for hourly staff. */
	absenceHours?: MoneyLike
	statutory: StatutoryEe
	loans?: AmortItem[]
	cashAdvances?: AmortItem[]
	/** Recurring custom deductions (#66) — fixed lines, applied before amortization. */
	recurring?: PayComponent[]
}): DeductionsResult {
	const { hourlyRate, lateMinutes, undertimeMinutes, statutory } = params
	const gross = D(params.gross)

	// Each line quantizes once, here. Statutory amounts arrive already prorated and quantized by
	// the caller (they are per-line remittance figures); `q2` is idempotent on them.
	const mandatory: PayComponent[] = [
		{ code: 'SSS_EE', label: 'SSS', amount: q2n(statutory.sssEe), taxable: false },
		{
			code: 'PHILHEALTH_EE',
			label: 'PhilHealth',
			amount: q2n(statutory.philhealthEe),
			taxable: false
		},
		{ code: 'PAGIBIG_EE', label: 'Pag-IBIG', amount: q2n(statutory.pagibigEe), taxable: false },
		{
			code: 'TAX',
			label: 'Withholding tax',
			amount: q2n(statutory.withholdingTax),
			taxable: false
		},
		{
			code: 'TARDINESS',
			label: 'Tardiness/undertime',
			amount: q2n(computeTardiness(hourlyRate, lateMinutes, undertimeMinutes)),
			taxable: false
		},
		{
			code: 'ABSENCE',
			label: 'Absences',
			amount: q2n(computeAbsence(hourlyRate, params.absenceHours ?? 0)),
			taxable: false
		}
	].filter((c) => c.amount !== 0)

	// Mandatory block: statutory + attendance. These are owed regardless of what gross can fund.
	const mandatoryTotal = sumQ(mandatory.map((c) => c.amount))

	// If the mandatory block alone outruns gross there is nothing left to gate — no discretionary
	// line can be taken, and the shortfall is credited back so net lands on exactly 0.
	if (mandatoryTotal.gte(gross)) {
		const shortfall = mandatoryTotal.minus(gross)
		const components = [...mandatory]
		if (shortfall.gt(0)) {
			components.push({
				code: 'UNRECOVERED',
				label: 'Uncollected — exceeds pay',
				amount: q2n(shortfall.negated()),
				taxable: false
			})
		}
		const skippedDiscretionary = sumQ((params.recurring ?? []).map((c) => c.amount))
		return {
			components,
			total: q2n(gross),
			net: 0,
			// Nothing was withheld, so every balance is carried forward unchanged.
			loanBalances: balancesUnchanged(params.loans ?? []),
			cashAdvanceBalances: balancesUnchanged(params.cashAdvances ?? []),
			uncollected: q2n(shortfall.plus(skippedDiscretionary))
		}
	}

	// Discretionary block, in priority order, each gated on what gross still has left.
	const recurringRes = applyIfAffordable(params.recurring ?? [], gross.minus(mandatoryTotal))
	const loanRes = applyAmortizations(params.loans ?? [], recurringRes.remainingNet, 'LOAN')
	const caRes = applyAmortizations(params.cashAdvances ?? [], loanRes.remainingNet, 'CASH_ADVANCE')

	const components = [...mandatory, ...recurringRes.applied, ...loanRes.applied, ...caRes.applied]
	// Lines-authoritative: the total IS the sum of the printed lines, so a payslip always adds up.
	const total = sumQ(components.map((c) => c.amount))

	return {
		components,
		total: total.toNumber(),
		net: gross.minus(total).toNumber(),
		loanBalances: loanRes.balances,
		cashAdvanceBalances: caRes.balances,
		uncollected: q2n(recurringRes.skipped)
	}
}

/** Every balance carried forward untouched — nothing was withheld this period. */
function balancesUnchanged(items: AmortItem[]): Record<string, number> {
	const out: Record<string, number> = {}
	for (const item of items) out[item.refId] = q2n(item.balance)
	return out
}
