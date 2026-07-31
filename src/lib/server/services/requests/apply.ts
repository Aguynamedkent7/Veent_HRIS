import type { Prisma, RequestType } from '@prisma/client'
import { deductLeaveBalance } from './leave'

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

// What was applied, for the caller to audit-log after the transaction commits. Keeping
// the audit write out of the transaction (as `decide` already does for the decision
// itself) means a rolled-back apply leaves no orphan audit entry.
export type AppliedEffect =
	| { kind: 'LEAVE'; leaveTypeId: string; deducted: number }
	| { kind: 'INFO_UPDATE'; column: string; value: string }

// Apply a fully-approved request within the approval transaction (#101). LEAVE deducts
// the leave balance; INFO_UPDATE writes the mapped employee field. Time-based work
// requests (OVERTIME / REST_DAY_WORK / HOLIDAY_WORK) are consumed lazily by the
// attendance derivation — nothing to persist. Runs on the passed `tx` so the status flip
// and the effect commit atomically: if the deduction fails, the approval rolls back
// rather than marking the request APPROVED with no balance deducted (free leave).
export async function applyApprovedRequest(
	tx: Prisma.TransactionClient,
	req: ApprovedRequest
): Promise<AppliedEffect | null> {
	if (req.type === 'LEAVE') {
		const payload = (req.payload ?? {}) as { leaveTypeId?: string; totalDays?: number }
		if (!payload.leaveTypeId || !payload.totalDays || !req.dateFrom) return null
		const year = req.dateFrom.getFullYear()
		await deductLeaveBalance(tx, req.employeeId, payload.leaveTypeId, year, payload.totalDays)
		return { kind: 'LEAVE', leaveTypeId: payload.leaveTypeId, deducted: payload.totalDays }
	}

	if (req.type === 'INFO_UPDATE') {
		const payload = (req.payload ?? {}) as { field?: string; requestedValue?: string }
		if (!payload.field || payload.requestedValue == null) return null
		const column = resolveInfoUpdateColumn(payload.field)
		if (!column) return null // unmapped/sensitive field — recorded on the request, applied later (T164)
		await tx.employee.update({
			where: { id: req.employeeId },
			data: { [column]: payload.requestedValue }
		})
		return { kind: 'INFO_UPDATE', column, value: payload.requestedValue }
	}

	return null
}
