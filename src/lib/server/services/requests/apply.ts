import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import type { RequestType } from '@prisma/client'
import type { AuditContext } from '../types'

// INFO_UPDATE targets: map the free-text `field` an employee submits to an actual
// (safe, self-service) Employee column. Sensitive fields (bank/GCash, government
// numbers) are intentionally NOT here — those land with T164 and stay HR-only.
const INFO_UPDATE_FIELDS: Record<string, 'contactPhone' | 'contactAddress'> = {
	contactPhone: 'contactPhone',
	phone: 'contactPhone',
	contactAddress: 'contactAddress',
	address: 'contactAddress'
}

export function resolveInfoUpdateColumn(field: string): 'contactPhone' | 'contactAddress' | null {
	return INFO_UPDATE_FIELDS[field] ?? null
}

type ApprovedRequest = {
	id: string
	type: RequestType
	employeeId: string
	payload: unknown
}

// Apply a fully-approved request to attendance/payroll state. Time-based requests
// (OVERTIME / REST_DAY_WORK / HOLIDAY_WORK / LEAVE) are consumed lazily by the
// attendance derivation, so nothing is persisted here — only INFO_UPDATE writes.
export async function applyApprovedRequest(req: ApprovedRequest, ctx: AuditContext): Promise<void> {
	if (req.type !== 'INFO_UPDATE') return

	const payload = (req.payload ?? {}) as { field?: string; requestedValue?: string }
	if (!payload.field || payload.requestedValue == null) return

	const column = resolveInfoUpdateColumn(payload.field)
	if (!column) return // unmapped/sensitive field — recorded on the request, applied later (T164)

	await db.employee.update({ where: { id: req.employeeId }, data: { [column]: payload.requestedValue } })
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Employee',
		entityId: req.employeeId,
		newValue: { [column]: payload.requestedValue, viaRequest: req.id }
	})
}
