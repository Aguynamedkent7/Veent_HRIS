import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import { computePayroll } from './index'
import { D, q2, sum } from './money'
import { deriveRange, lockRange } from '../attendance'
import { isValidStandardPeriod } from '$lib/utils/pay-periods'
import { notifyMany } from '../notifications'
import { formatShortDate } from '$lib/utils/format'
import type { AuditContext } from '../types'

/**
 * Payroll period lifecycle (PAY-010): OPEN → IMPORTED → GENERATED → LOCKED → RELEASED (+ VOIDED).
 * A PayrollPeriod wraps a single PayrollRun. Loan/cash-advance balances are decremented at LOCK
 * (using the itemized LOAN/CASH_ADVANCE deduction lines as the source of truth) and reversed on VOID,
 * so compute/generate stays freely re-runnable and the mutation happens exactly once.
 */

async function requirePeriod(id: string, organizationId: string) {
	const period = await db.payrollPeriod.findFirst({
		where: { id, organizationId },
		include: { runs: true }
	})
	if (!period) error(404, 'Payroll period not found')
	return period
}

export async function listPeriods(organizationId: string) {
	return db.payrollPeriod.findMany({
		where: { organizationId },
		include: { runs: { select: { id: true, status: true, totalNet: true } } },
		orderBy: { startDate: 'desc' }
	})
}

export async function openPeriod(
	organizationId: string,
	input: {
		name: string
		startDate: Date
		endDate: Date
		cutoff?: number
		// Escape hatch for seeds / legacy imports only (#129).
		allowNonStandardPeriod?: boolean
	},
	ctx: AuditContext
) {
	if (!input.allowNonStandardPeriod && !isValidStandardPeriod(input.startDate, input.endDate)) {
		error(400, 'A payroll period must be a standard pay period (1–15, 16–EOM, or the whole month)')
	}

	const existing = await db.payrollRun.findUnique({
		where: {
			organizationId_periodStart_periodEnd: {
				organizationId,
				periodStart: input.startDate,
				periodEnd: input.endDate
			}
		}
	})
	if (existing) error(409, 'A payroll run for this period already exists')

	const period = await db.$transaction(async (tx: Prisma.TransactionClient) => {
		const p = await tx.payrollPeriod.create({
			data: {
				organizationId,
				name: input.name,
				startDate: input.startDate,
				endDate: input.endDate,
				cutoff: input.cutoff
			}
		})
		await tx.payrollRun.create({
			data: {
				organizationId,
				periodId: p.id,
				periodStart: input.startDate,
				periodEnd: input.endDate
			}
		})
		return p
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'PayrollPeriod',
		entityId: period.id,
		newValue: { name: input.name, startDate: input.startDate, endDate: input.endDate }
	})
	return period
}

export async function importAttendance(id: string, organizationId: string, ctx: AuditContext) {
	const period = await requirePeriod(id, organizationId)
	if (period.status !== 'OPEN') error(400, `Cannot import into a ${period.status} period`)

	// Derive AttendanceDay records from punches for the period, then lock them so payroll reads a fixed set.
	const range = { from: period.startDate, to: period.endDate }
	await deriveRange(organizationId, range, ctx)
	await lockRange(organizationId, range, ctx)

	const updated = await db.payrollPeriod.update({ where: { id }, data: { status: 'IMPORTED' } })
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'PayrollPeriod',
		entityId: id,
		newValue: { status: 'IMPORTED' }
	})
	return updated
}

export async function generate(id: string, organizationId: string, ctx: AuditContext) {
	const period = await requirePeriod(id, organizationId)
	if (!['OPEN', 'IMPORTED', 'GENERATED'].includes(period.status)) {
		error(400, `Cannot generate a ${period.status} period`)
	}
	const run = period.runs[0]
	if (!run) error(400, 'Period has no payroll run')

	// Reset to DRAFT so re-generation recomputes cleanly.
	if (run.status !== 'DRAFT') {
		await db.payrollRun.update({ where: { id: run.id }, data: { status: 'DRAFT' } })
	}
	await computePayroll(run.id, organizationId, ctx)

	const updated = await db.payrollPeriod.update({ where: { id }, data: { status: 'GENERATED' } })
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'PayrollPeriod',
		entityId: id,
		newValue: { status: 'GENERATED' }
	})
	return updated
}

export async function lock(
	id: string,
	organizationId: string,
	ctx: AuditContext,
	overrideNote?: string
) {
	const period = await requirePeriod(id, organizationId)
	if (period.status !== 'GENERATED')
		error(400, `Only a GENERATED period can be locked (is ${period.status})`)
	const run = period.runs[0]
	if (!run) error(400, 'Period has no payroll run')

	const entries = await db.payrollEntry.findMany({
		where: { payrollRunId: run.id },
		include: { deductions: true }
	})
	const flaggedCount = entries.filter((e) => e.isFlagged).length
	if (flaggedCount > 0 && !overrideNote) {
		error(
			409,
			`${flaggedCount} flagged entr${flaggedCount === 1 ? 'y' : 'ies'} — an override note is required to lock`
		)
	}

	await db.$transaction(async (tx: Prisma.TransactionClient) => {
		// Claim the period atomically, BEFORE touching any balance. The status check above
		// is a read outside this transaction, so on its own it is check-then-act: two
		// concurrent locks (a double-click, a retried request) both passed it and both ran
		// the decrement loop, subtracting twice. This conditional update is the real gate —
		// exactly one caller can move GENERATED → LOCKED, and the loser aborts the whole
		// transaction before any money moves.
		const claimed = await tx.payrollPeriod.updateMany({
			where: { id, status: 'GENERATED' },
			data: { status: 'LOCKED', lockedAt: new Date() }
		})
		if (claimed.count === 0) {
			error(409, 'This period is already being locked or is no longer GENERATED')
		}

		// Commit loan / cash-advance amortization from the itemized deduction lines.
		for (const entry of entries) {
			for (const d of entry.deductions) {
				// #119: balances stay in exact decimal — no Number() round-trip. Both operands are
				// scale-2 at rest, so decrements introduce no drift and the running balance stays
				// reconcilable against the original principal.
				const amount = D(d.amount)
				if (amount.lte(0) || !d.refId) continue
				if (d.code === 'LOAN') {
					const loan = await tx.loan.findUnique({ where: { id: d.refId } })
					if (!loan) continue

					// `amount` was frozen into the deduction line at compute time, capped
					// against the balance as it stood then. Re-cap against the live balance:
					// if the borrower paid the loan down in between, the frozen figure would
					// over-collect and drive the balance negative.
					const liveBalance = D(loan.balance)
					const applied = q2(amount.lt(liveBalance) ? amount : liveBalance)
					if (applied.lte(0)) continue

					// One payment per (loan, payroll entry) — the DB unique constraint makes
					// this the idempotency key, so a replayed lock cannot double-apply even
					// if it somehow gets past the claim above.
					try {
						await tx.loanPayment.create({
							data: { loanId: d.refId, payrollEntryId: entry.id, amount: applied }
						})
					} catch (e) {
						if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
						throw e
					}

					// Conditional on the balance we just read: if a concurrent writer changed
					// it, count is 0 and we abort rather than clobbering their write. Plain
					// `update` here was a read-modify-write and lost updates under the default
					// READ COMMITTED isolation.
					const newBalance = liveBalance.minus(applied)
					const res = await tx.loan.updateMany({
						where: { id: d.refId, balance: loan.balance },
						data: { balance: newBalance, status: newBalance.lte(0) ? 'PAID' : loan.status }
					})
					if (res.count === 0) {
						error(409, 'A loan balance changed while locking — nothing was committed, retry')
					}
				} else if (d.code === 'CASH_ADVANCE') {
					const ca = await tx.cashAdvance.findUnique({ where: { id: d.refId } })
					if (!ca) continue

					// Cash advances have no payment ledger, so there is no idempotency key to
					// lean on — the atomic period claim above is what stops a second pass, and
					// this conditional update is what stops a concurrent one.
					const liveBalance = D(ca.balance)
					const applied = q2(amount.lt(liveBalance) ? amount : liveBalance)
					if (applied.lte(0)) continue
					const newBalance = liveBalance.minus(applied)
					const res = await tx.cashAdvance.updateMany({
						where: { id: d.refId, balance: ca.balance },
						data: { balance: newBalance, status: newBalance.lte(0) ? 'PAID' : ca.status }
					})
					if (res.count === 0) {
						error(
							409,
							'A cash-advance balance changed while locking — nothing was committed, retry'
						)
					}
				}
			}
		}

		// Record who/when locked + any override, but DO NOT flip run.status to APPROVED —
		// payslip visibility is gated on the PERIOD being RELEASED, and the LOCKED period
		// already blocks re-generation. Keeping the run COMPUTED keeps the two flows distinct.
		await tx.payrollRun.update({
			where: { id: run.id },
			data: {
				approvedById: ctx.actorId,
				approvedAt: new Date(),
				...(overrideNote ? { hasOverride: true, overrideNote } : {})
			}
		})
	})

	await writeAuditLog(ctx, {
		action: overrideNote ? 'PAYROLL_OVERRIDE' : 'UPDATE',
		entityType: 'PayrollPeriod',
		entityId: id,
		newValue: { status: 'LOCKED', ...(overrideNote ? { overrideNote } : {}) }
	})
	return db.payrollPeriod.findUnique({ where: { id } })
}

export async function release(id: string, organizationId: string, ctx: AuditContext) {
	const period = await requirePeriod(id, organizationId)
	if (period.status !== 'LOCKED')
		error(400, `Only a LOCKED period can be released (is ${period.status})`)

	const updated = await db.payrollPeriod.update({
		where: { id },
		data: { status: 'RELEASED', releasedAt: new Date() }
	})
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'PayrollPeriod',
		entityId: id,
		newValue: { status: 'RELEASED' }
	})

	// Notify every employee with a payslip in this period that it's now available (#169).
	// Best-effort — a notifier failure must not undo the release.
	try {
		const runIds = period.runs.map((r) => r.id)
		if (runIds.length) {
			const entries = await db.payrollEntry.findMany({
				where: { payrollRunId: { in: runIds } },
				select: { employee: { select: { userId: true } } }
			})
			const userIds = [...new Set(entries.map((e) => e.employee.userId))]
			const label = `${formatShortDate(period.startDate)}–${formatShortDate(period.endDate)}`
			await notifyMany(userIds, `Your payslip for ${label} is available.`, '/payslips', 'PAYSLIP')
		}
	} catch (e) {
		console.error('[NOTIFY] Failed to notify payslip release for period', id, e)
	}

	return updated
}

export async function voidPeriod(id: string, organizationId: string, ctx: AuditContext) {
	const period = await requirePeriod(id, organizationId)
	if (period.status === 'VOIDED') error(400, 'Period is already voided')
	const run = period.runs[0]
	const wasLocked = period.status === 'LOCKED' || period.status === 'RELEASED'

	await db.$transaction(async (tx: Prisma.TransactionClient) => {
		if (run && wasLocked) {
			// Reverse the amortization committed at lock.
			const entries = await tx.payrollEntry.findMany({
				where: { payrollRunId: run.id },
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
							await tx.loan.update({
								where: { id: d.refId },
								// Only reopen a loan the reversal actually un-pays; a loan settled
								// by some other payment stays PAID.
								data: { balance: restored, status: restored.gt(0) ? 'ACTIVE' : loan.status }
							})
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
		if (run) await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'VOIDED' } })
		await tx.payrollPeriod.update({ where: { id }, data: { status: 'VOIDED' } })
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'PayrollPeriod',
		entityId: id,
		newValue: { status: 'VOIDED' }
	})
	return db.payrollPeriod.findUnique({ where: { id } })
}
