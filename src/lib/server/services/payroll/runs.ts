import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { requireCapability } from '$lib/server/rbac'
import type { AuditContext } from '../types'

/**
 * A payslip is visible to the employee when the run is legacy-`APPROVED` (old flow) OR its
 * PayrollPeriod is `RELEASED` (new lifecycle). Use `payslipVisibleRunFilter` in Prisma `where`
 * clauses and `isPayslipVisible` for in-memory checks.
 */
export const payslipVisibleRunFilter = {
	OR: [{ status: 'APPROVED' as const }, { period: { status: 'RELEASED' as const } }]
}

export function isPayslipVisible(run: {
	status: string
	period?: { status: string } | null
}): boolean {
	return run.status === 'APPROVED' || run.period?.status === 'RELEASED'
}

export async function listRuns(organizationId: string, filters?: { status?: string }) {
	return db.payrollRun.findMany({
		where: {
			organizationId,
			...(filters?.status && {
				status: filters.status as 'DRAFT' | 'COMPUTED' | 'APPROVED' | 'VOIDED'
			})
		},
		include: {
			_count: { select: { entries: true } }
		},
		orderBy: { createdAt: 'desc' }
	})
}

export async function getRunWithEntries(id: string, organizationId: string) {
	const run = await db.payrollRun.findFirst({
		where: { id, organizationId },
		include: {
			entries: {
				include: {
					employee: {
						select: {
							firstName: true,
							lastName: true,
							employeeNumber: true
						}
					}
				},
				orderBy: { employee: { lastName: 'asc' } }
			}
		}
	})
	if (!run) error(404, 'Payroll run not found')
	return run
}

export async function approveRun(
	id: string,
	organizationId: string,
	overrideNote: string | undefined,
	ctx: AuditContext
) {
	const run = await db.payrollRun.findFirst({
		where: { id, organizationId },
		include: { entries: { select: { isFlagged: true } } }
	})
	if (!run) error(404, 'Payroll run not found')
	// COMPUTED, matching approvePayroll in ./index (the UI action's path). This required
	// DRAFT, which meant the two entry points disagreed: the API could approve a
	// never-computed run with zero entries, while a genuinely COMPUTED run was rejected
	// here. The two remain separate functions because only this one carries the
	// flagged-entry override policy, which the UI has no field to supply.
	if (run.status !== 'COMPUTED') error(400, 'Only computed payroll runs can be approved')

	const hasFlagged = run.entries.some((e) => e.isFlagged)
	if (hasFlagged && !overrideNote) {
		error(400, 'Override note required for flagged entries')
	}

	const updated = await db.payrollRun.update({
		where: { id },
		data: {
			status: 'APPROVED',
			approvedAt: new Date(),
			approvedById: ctx.actorId,
			...(overrideNote && { overrideNote, hasOverride: true })
		}
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'PayrollRun',
		entityId: id,
		oldValue: { status: run.status },
		newValue: { status: 'APPROVED', approvedAt: updated.approvedAt }
	})

	if (overrideNote) {
		await writeAuditLog(ctx, {
			action: 'PAYROLL_OVERRIDE',
			entityType: 'PayrollRun',
			entityId: id,
			newValue: { overrideNote }
		})
	}

	return updated
}

export async function voidRun(id: string, organizationId: string, ctx: AuditContext) {
	requireCapability(ctx.actorRole, 'OVERRIDE_FINALIZED')

	const run = await db.payrollRun.findFirst({ where: { id, organizationId } })
	if (!run) error(404, 'Payroll run not found')

	const updated = await db.payrollRun.update({
		where: { id },
		data: { status: 'VOIDED' }
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'PayrollRun',
		entityId: id,
		oldValue: { status: run.status },
		newValue: { status: 'VOIDED' }
	})

	return updated
}
