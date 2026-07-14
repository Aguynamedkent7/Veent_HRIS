import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import type { RequestType } from '@prisma/client'
import { deductLeaveBalance } from './leave'
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
	dateFrom: Date | null
	payload: unknown
}

// Apply a fully-approved request. LEAVE deducts the leave balance; INFO_UPDATE writes
// the mapped employee field. Time-based work requests (OVERTIME / REST_DAY_WORK /
// HOLIDAY_WORK) are consumed lazily by the attendance derivation — nothing to persist.
export async function applyApprovedRequest(req: ApprovedRequest, ctx: AuditContext): Promise<void> {
	if (req.type === 'LEAVE') {
		const payload = (req.payload ?? {}) as { leaveTypeId?: string; totalDays?: number }
		if (!payload.leaveTypeId || !payload.totalDays || !req.dateFrom) return
		const year = req.dateFrom.getFullYear()
		await db.$transaction((tx) =>
			deductLeaveBalance(tx, req.employeeId, payload.leaveTypeId!, year, payload.totalDays!)
		)
		await writeAuditLog(ctx, {
			action: 'UPDATE',
			entityType: 'LeaveBalance',
			entityId: req.employeeId,
			newValue: {
				leaveTypeId: payload.leaveTypeId,
				deducted: payload.totalDays,
				viaRequest: req.id
			}
		})
		return
	}

	if (req.type === 'INFO_UPDATE') {
		const payload = (req.payload ?? {}) as { field?: string; requestedValue?: string }
		if (!payload.field || payload.requestedValue == null) return
		const column = resolveInfoUpdateColumn(payload.field)
		if (!column) return // unmapped/sensitive field — recorded on the request, applied later (T164)
		await db.employee.update({
			where: { id: req.employeeId },
			data: { [column]: payload.requestedValue }
		})
		await writeAuditLog(ctx, {
			action: 'UPDATE',
			entityType: 'Employee',
			entityId: req.employeeId,
			newValue: { [column]: payload.requestedValue, viaRequest: req.id }
		})
	}
}
