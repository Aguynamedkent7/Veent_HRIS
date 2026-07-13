import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import { computePayroll } from './index'
import { round2 } from './types'
import { deriveRange, lockRange } from '../attendance'
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
	input: { name: string; startDate: Date; endDate: Date; cutoff?: number },
	ctx: AuditContext
) {
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
			data: { organizationId, periodId: p.id, periodStart: input.startDate, periodEnd: input.endDate }
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
	await writeAuditLog(ctx, { action: 'UPDATE', entityType: 'PayrollPeriod', entityId: id, newValue: { status: 'IMPORTED' } })
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
	await writeAuditLog(ctx, { action: 'UPDATE', entityType: 'PayrollPeriod', entityId: id, newValue: { status: 'GENERATED' } })
	return updated
}

export async function lock(id: string, organizationId: string, ctx: AuditContext, overrideNote?: string) {
	const period = await requirePeriod(id, organizationId)
	if (period.status !== 'GENERATED') error(400, `Only a GENERATED period can be locked (is ${period.status})`)
	const run = period.runs[0]
	if (!run) error(400, 'Period has no payroll run')

	const entries = await db.payrollEntry.findMany({
		where: { payrollRunId: run.id },
		include: { deductions: true }
	})
	const flaggedCount = entries.filter((e) => e.isFlagged).length
	if (flaggedCount > 0 && !overrideNote) {
		error(409, `${flaggedCount} flagged entr${flaggedCount === 1 ? 'y' : 'ies'} — an override note is required to lock`)
	}

	await db.$transaction(async (tx: Prisma.TransactionClient) => {
		// Commit loan / cash-advance amortization from the itemized deduction lines.
		for (const entry of entries) {
			for (const d of entry.deductions) {
				const amount = Number(d.amount)
				if (amount <= 0 || !d.refId) continue
				if (d.code === 'LOAN') {
					const loan = await tx.loan.findUnique({ where: { id: d.refId } })
					if (!loan) continue
					const newBalance = round2(Number(loan.balance) - amount)
					await tx.loan.update({
						where: { id: d.refId },
						data: { balance: newBalance, status: newBalance <= 0 ? 'PAID' : loan.status }
					})
					await tx.loanPayment.create({ data: { loanId: d.refId, payrollEntryId: entry.id, amount } })
				} else if (d.code === 'CASH_ADVANCE') {
					const ca = await tx.cashAdvance.findUnique({ where: { id: d.refId } })
					if (!ca) continue
					const newBalance = round2(Number(ca.balance) - amount)
					await tx.cashAdvance.update({
						where: { id: d.refId },
						data: { balance: newBalance, status: newBalance <= 0 ? 'PAID' : ca.status }
					})
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
		await tx.payrollPeriod.update({ where: { id }, data: { status: 'LOCKED', lockedAt: new Date() } })
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
	if (period.status !== 'LOCKED') error(400, `Only a LOCKED period can be released (is ${period.status})`)

	const updated = await db.payrollPeriod.update({ where: { id }, data: { status: 'RELEASED', releasedAt: new Date() } })
	await writeAuditLog(ctx, { action: 'UPDATE', entityType: 'PayrollPeriod', entityId: id, newValue: { status: 'RELEASED' } })
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
			const entries = await tx.payrollEntry.findMany({ where: { payrollRunId: run.id }, include: { deductions: true } })
			for (const entry of entries) {
				for (const d of entry.deductions) {
					const amount = Number(d.amount)
					if (amount <= 0 || !d.refId) continue
					if (d.code === 'LOAN') {
						const loan = await tx.loan.findUnique({ where: { id: d.refId } })
						if (loan) {
							await tx.loan.update({ where: { id: d.refId }, data: { balance: round2(Number(loan.balance) + amount), status: 'ACTIVE' } })
						}
						await tx.loanPayment.deleteMany({ where: { loanId: d.refId, payrollEntryId: entry.id } })
					} else if (d.code === 'CASH_ADVANCE') {
						const ca = await tx.cashAdvance.findUnique({ where: { id: d.refId } })
						if (ca) {
							await tx.cashAdvance.update({ where: { id: d.refId }, data: { balance: round2(Number(ca.balance) + amount), status: 'ACTIVE' } })
						}
					}
				}
			}
		}
		if (run) await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'VOIDED' } })
		await tx.payrollPeriod.update({ where: { id }, data: { status: 'VOIDED' } })
	})

	await writeAuditLog(ctx, { action: 'UPDATE', entityType: 'PayrollPeriod', entityId: id, newValue: { status: 'VOIDED' } })
	return db.payrollPeriod.findUnique({ where: { id } })
}
