/**
 * Deductions engine (PAY-007) — pure, side-effect-free.
 *
 * Covers the NEW deduction logic (tardiness + loan/cash-advance amortization) and composes it
 * with the already-tested statutory results from `ph-statutory.ts`. Amortization is a fixed
 * installment per period, capped at the outstanding balance, and SKIPPED (not carried or
 * partially applied) when the remaining net can't cover it — per the clarified decision.
 */

import type { PayComponent } from './types'
import { round2 } from './types'

export interface AmortItem {
	refId: string
	label: string
	installment: number
	balance: number
}

export interface AmortResult {
	applied: PayComponent[]
	remainingNet: number
	/** New balance per refId after applying installments. */
	balances: Record<string, number>
}

/** Tardiness/undertime deduction: unpaid minutes valued at the hourly rate. */
export function computeTardiness(hourlyRate: number, lateMinutes: number, undertimeMinutes: number): number {
	return round2(((lateMinutes + undertimeMinutes) / 60) * hourlyRate)
}

/**
 * Apply fixed installments in order against the available net. Each installment is capped at the
 * item's balance; an item is skipped entirely if `availableNet` can't cover the due amount.
 */
export function applyAmortizations(items: AmortItem[], availableNet: number, codePrefix = 'LOAN'): AmortResult {
	const applied: PayComponent[] = []
	const balances: Record<string, number> = {}
	let net = availableNet

	for (const item of items) {
		const due = round2(Math.min(item.installment, item.balance))
		if (due > 0 && net >= due) {
			applied.push({ code: codePrefix, label: item.label, amount: due, taxable: false, refId: item.refId })
			net = round2(net - due)
			balances[item.refId] = round2(item.balance - due)
		} else {
			// Skipped this period — balance unchanged.
			balances[item.refId] = round2(item.balance)
		}
	}

	return { applied, remainingNet: net, balances }
}

export interface StatutoryEe {
	sssEe: number
	philhealthEe: number
	pagibigEe: number
	withholdingTax: number
}

export interface DeductionsResult {
	components: PayComponent[]
	total: number
	net: number
	loanBalances: Record<string, number>
	cashAdvanceBalances: Record<string, number>
}

/**
 * Compose all deductions for one payroll entry and return the itemized list + net pay.
 * Order: statutory EE (SSS/PhilHealth/Pag-IBIG) → withholding tax → tardiness → loans → cash advances.
 * Loans/cash advances only apply against what net remains after the mandatory deductions.
 */
export function computeDeductions(params: {
	gross: number
	hourlyRate: number
	lateMinutes: number
	undertimeMinutes: number
	statutory: StatutoryEe
	loans?: AmortItem[]
	cashAdvances?: AmortItem[]
}): DeductionsResult {
	const { gross, hourlyRate, lateMinutes, undertimeMinutes, statutory } = params

	const fixed: PayComponent[] = [
		{ code: 'SSS_EE', label: 'SSS', amount: round2(statutory.sssEe), taxable: false },
		{ code: 'PHILHEALTH_EE', label: 'PhilHealth', amount: round2(statutory.philhealthEe), taxable: false },
		{ code: 'PAGIBIG_EE', label: 'Pag-IBIG', amount: round2(statutory.pagibigEe), taxable: false },
		{ code: 'TAX', label: 'Withholding tax', amount: round2(statutory.withholdingTax), taxable: false },
		{ code: 'TARDINESS', label: 'Tardiness/undertime', amount: computeTardiness(hourlyRate, lateMinutes, undertimeMinutes), taxable: false }
	].filter((c) => c.amount !== 0)

	const fixedTotal = round2(fixed.reduce((s, c) => s + c.amount, 0))
	let availableNet = round2(gross - fixedTotal)

	const loanRes = applyAmortizations(params.loans ?? [], availableNet, 'LOAN')
	availableNet = loanRes.remainingNet
	const caRes = applyAmortizations(params.cashAdvances ?? [], availableNet, 'CASH_ADVANCE')

	const components = [...fixed, ...loanRes.applied, ...caRes.applied]
	const total = round2(components.reduce((s, c) => s + c.amount, 0))

	return {
		components,
		total,
		net: round2(gross - total),
		loanBalances: loanRes.balances,
		cashAdvanceBalances: caRes.balances
	}
}
