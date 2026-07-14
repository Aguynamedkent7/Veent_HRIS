import { db } from '$lib/server/db'
import { createRequest } from './requests'
import { decide } from './approvals'
import type { AuditContext } from './types'

// Leave is now a Request of type LEAVE (T168/T169). These wrappers keep the legacy
// service surface so existing leave routes/templates work: list rows are mapped back
// to the old {startDate, endDate, totalDays, leaveType} shape.

type LeaveRow = {
	id: string
	employeeId: string
	startDate: Date
	endDate: Date
	totalDays: number | null
	status: string
	reason: string | null
	employee: { id: string; firstName: string; lastName: string }
	leaveType: { name: string; isPaid: boolean }
}

export async function listLeaveRequests(params: {
	organizationId: string
	employeeId?: string
	status?: string
}): Promise<LeaveRow[]> {
	const rows = await db.request.findMany({
		where: {
			type: 'LEAVE',
			employee: { user: { organizationId: params.organizationId } },
			...(params.employeeId && { employeeId: params.employeeId }),
			...(params.status && { status: params.status as never })
		},
		include: { employee: { select: { id: true, firstName: true, lastName: true } } },
		orderBy: { createdAt: 'desc' }
	})

	const typeIds = [
		...new Set(
			rows
				.map((r) => (r.payload as { leaveTypeId?: string })?.leaveTypeId)
				.filter(Boolean) as string[]
		)
	]
	const types = typeIds.length
		? await db.leaveType.findMany({
				where: { id: { in: typeIds } },
				select: { id: true, name: true, isPaid: true }
			})
		: []
	const typeMap = new Map(types.map((t) => [t.id, t]))

	return rows.map((r) => {
		const payload = (r.payload ?? {}) as { leaveTypeId?: string; totalDays?: number }
		const lt = payload.leaveTypeId ? typeMap.get(payload.leaveTypeId) : undefined
		return {
			id: r.id,
			employeeId: r.employeeId,
			startDate: r.dateFrom as Date,
			endDate: r.dateTo as Date,
			totalDays: payload.totalDays ?? null,
			status: r.status,
			reason: r.reason,
			employee: r.employee,
			leaveType: { name: lt?.name ?? '—', isPaid: lt?.isPaid ?? false }
		}
	})
}

export async function requestLeave(
	employeeId: string,
	organizationId: string,
	input: { leaveTypeId: string; startDate: Date; endDate: Date; reason?: string },
	ctx: AuditContext
) {
	return createRequest(
		employeeId,
		organizationId,
		{
			type: 'LEAVE',
			leaveTypeId: input.leaveTypeId,
			startDate: input.startDate,
			endDate: input.endDate,
			reason: input.reason
		},
		ctx
	)
}

// Decide the current stage of a leave request. Multi-stage now: a manager approves
// the supervisor stage, HR the HR stage. Balance is deducted on final approval.
export async function reviewLeaveRequest(
	id: string,
	organizationId: string,
	approved: boolean,
	rejectionReason: string | undefined,
	ctx: AuditContext
) {
	const actor = await db.employee.findUnique({
		where: { userId: ctx.actorId },
		select: { id: true }
	})
	return decide(id, approved ? 'APPROVED' : 'REJECTED', rejectionReason, ctx, actor?.id ?? null)
}

export async function getLeaveBalances(employeeId: string, year: number) {
	return db.leaveBalance.findMany({
		where: { employeeId, year },
		include: { leaveType: { select: { name: true, isPaid: true } } }
	})
}
