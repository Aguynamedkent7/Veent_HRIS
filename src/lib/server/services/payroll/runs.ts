import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { requireAnyCapability } from '$lib/server/rbac'
import { sum } from './money'
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

/**
 * #249: `visibleEmployeeIds` restricts which entries come back (`null`/omitted = all). The API twin
 * of the run-detail page, and MANAGE_PAYROLL holds MANAGER — so this returned every employee's
 * gross and net to a branch manager exactly as the page did. Same allow-list, from
 * `listVisiblePayEmployeeIds`, so the two surfaces cannot disagree.
 */
export async function getRunWithEntries(
	id: string,
	organizationId: string,
	visibleEmployeeIds?: string[] | null
) {
	const run = await db.payrollRun.findFirst({
		where: { id, organizationId },
		include: {
			entries: {
				...(visibleEmployeeIds != null && {
					where: { employeeId: { in: visibleEmployeeIds } }
				}),
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
	if (visibleEmployeeIds == null) return run
	// The stored totals are ORG-WIDE. Filtering the entries and returning them unchanged would hand
	// a scoped caller the organization's whole payroll cost beside their own two rows — the leak
	// this scoping exists to close, surviving in the aggregate. `getPayrollRun` does the same for
	// the page; caught here by reading the endpoint's actual response, which the unit tests could
	// not, because they assert on the query rather than on what ships.
	return {
		...run,
		totalGross: sum(run.entries.map((e) => e.grossPay)),
		totalDeductions: sum(run.entries.map((e) => e.totalDeductions)),
		totalNet: sum(run.entries.map((e) => e.netPay))
	}
}

// `approveRun` lived here: a second approve implementation that wrote `status: 'APPROVED'` directly,
// gated on MANAGE_PAYROLL (which holds MANAGER) and skipping the #134 chain entirely — no stage
// capability, no separation of duties, and the run's approval step left open on an approved run.
// Deleted; `decidePayrollRun` in `../approvals` is the one approve path for both the UI action and
// the v1 API. Its flagged-entry `overrideNote` went with it: no UI ever supplied one, and silently
// approving flagged entries is the opposite of what the flag is for.

export async function voidRun(id: string, organizationId: string, ctx: AuditContext) {
	requireAnyCapability(ctx.actorRoles, 'OVERRIDE_FINALIZED')

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
