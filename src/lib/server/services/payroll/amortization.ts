import { D, sum } from './money'
import { error } from '@sveltejs/kit'
import type { Prisma } from '@prisma/client'

/**
 * Reverse the loan/cash-advance amortization committed at LOCK, for one payroll run.
 *
 * Lifted verbatim out of `voidPeriod` (#298 D10) so `voidRun` and `voidPeriod` share one
 * implementation instead of drifting apart. It takes the CALLER's transaction client and opens
 * none of its own, and it writes NO status of any kind — the caller owns both the transaction
 * boundary and the run/period status flips. See `docs/payroll-void-semantics.md`.
 *
 * KNOWN DEFECT — the CASH_ADVANCE arm is not a true inverse, and this function makes it reachable
 * from a second void path. Lock applies `min(d.amount, liveBalance)` and records nothing, so a
 * CAPPED payment is credited back at the full frozen `d.amount` here — an over-credit of the
 * difference — and `status` is forced to `ACTIVE` unconditionally, which can resurrect an advance
 * some other payment already settled. The LOAN arm above it IS a true inverse only because
 * `loan_payments` exists to say what really moved; cash advances have no such ledger. Fixing it
 * needs a cash-advance payment ledger (a schema addition with a backfill question). PRE-EXISTING,
 * out of scope for #298, recorded for the owner. Worse than before in one specific way: called
 * from `voidRun` the period stays LOCKED, so an over-credited advance now sits against a payroll
 * that still looks live.
 */
export async function reverseAmortization(
	tx: Prisma.TransactionClient,
	runId: string
): Promise<void> {
	// Reverse the amortization committed at lock.
	const entries = await tx.payrollEntry.findMany({
		where: { payrollRunId: runId },
		include: { deductions: true }
	})
	for (const entry of entries) {
		for (const d of entry.deductions) {
			// #119: balances stay in exact decimal — no Number() round-trip. Both operands are
			// scale-2 at rest, so decrements introduce no drift and the running balance stays
			// reconcilable against the original principal.
			const amount = D(d.amount)
			if (amount.lte(0) || !d.refId) continue
			if (d.code === 'LOAN') {
				// Reverse what was actually applied, not the frozen deduction line. Lock
				// re-caps against the live balance, so the two can differ; the payment
				// rows are the record of what really moved. Reversing `d.amount` blind
				// would credit back money that was never collected.
				const payments = await tx.loanPayment.findMany({
					where: { loanId: d.refId, payrollEntryId: entry.id },
					select: { amount: true }
				})
				const reversal = sum(payments.map((p) => p.amount))
				const loan = await tx.loan.findUnique({ where: { id: d.refId } })
				if (loan && reversal.gt(0)) {
					const restored = D(loan.balance).plus(reversal)
					// Conditional on the balance we just read, mirroring the guarded decrement in
					// `lock()` (periods.ts). A blind update would silently discard a concurrent
					// payment against the same loan; refusing makes the caller retry instead.
					const res = await tx.loan.updateMany({
						where: { id: d.refId, balance: loan.balance },
						// Only reopen a loan the reversal actually un-pays; a loan settled
						// by some other payment stays PAID.
						data: { balance: restored, status: restored.gt(0) ? 'ACTIVE' : loan.status }
					})
					if (res.count === 0) {
						error(409, 'A loan balance changed while voiding — nothing was reversed, retry')
					}
				}
				await tx.loanPayment.deleteMany({
					where: { loanId: d.refId, payrollEntryId: entry.id }
				})
			} else if (d.code === 'CASH_ADVANCE') {
				const ca = await tx.cashAdvance.findUnique({ where: { id: d.refId } })
				if (ca) {
					await tx.cashAdvance.update({
						where: { id: d.refId },
						data: { balance: D(ca.balance).plus(amount), status: 'ACTIVE' }
					})
				}
			}
		}
	}
}
