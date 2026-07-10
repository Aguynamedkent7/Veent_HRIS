import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import type { AuditContext } from './types'

function workdaysBetween(start: Date, end: Date, holidays: Date[]): number {
	let count = 0
	const cur = new Date(start)
	const holidayStrings = new Set(holidays.map((h) => h.toISOString().slice(0, 10)))

	while (cur <= end) {
		const day = cur.getDay()
		const iso = cur.toISOString().slice(0, 10)
		if (day !== 0 && day !== 6 && !holidayStrings.has(iso)) count++
		cur.setDate(cur.getDate() + 1)
	}
	return count
}

export async function listLeaveRequests(params: {
	organizationId: string
	employeeId?: string
	status?: string
}) {
	return db.leaveRequest.findMany({
		where: {
			employee: { user: { organizationId: params.organizationId } },
			...(params.employeeId && { employeeId: params.employeeId }),
			...(params.status && { status: params.status as never })
		},
		include: {
			employee: { select: { id: true, firstName: true, lastName: true } },
			leaveType: { select: { id: true, name: true, isPaid: true } }
		},
		orderBy: { createdAt: 'desc' }
	})
}

export async function requestLeave(
	employeeId: string,
	organizationId: string,
	input: { leaveTypeId: string; startDate: Date; endDate: Date; reason?: string },
	ctx: AuditContext
) {
	const balance = await db.leaveBalance.findUnique({
		where: {
			employeeId_leaveTypeId_year: {
				employeeId,
				leaveTypeId: input.leaveTypeId,
				year: input.startDate.getFullYear()
			}
		}
	})

	const holidays = await db.publicHoliday.findMany({
		where: {
			organizationId,
			date: { gte: input.startDate, lte: input.endDate }
		},
		select: { date: true }
	})

	const totalDays = workdaysBetween(input.startDate, input.endDate, holidays.map((h: { date: Date }) => h.date))

	if (balance && Number(balance.remaining) < totalDays) {
		error(400, `Insufficient leave balance. Available: ${balance.remaining} days`)
	}

	const request = await db.leaveRequest.create({
		data: {
			employeeId,
			leaveTypeId: input.leaveTypeId,
			startDate: input.startDate,
			endDate: input.endDate,
			totalDays,
			reason: input.reason
		},
		include: { leaveType: true }
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'LeaveRequest',
		entityId: request.id,
		newValue: { leaveTypeId: input.leaveTypeId, totalDays, startDate: input.startDate }
	})

	return request
}

export async function reviewLeaveRequest(
	id: string,
	organizationId: string,
	approved: boolean,
	rejectionReason: string | undefined,
	ctx: AuditContext
) {
	const request = await db.leaveRequest.findFirst({
		where: { id, employee: { user: { organizationId } } },
		include: { employee: { select: { reportsToId: true } } }
	})
	if (!request) error(404, 'Leave request not found')

	// A plain MANAGER may only review leave for their direct reports; HR_ADMIN+ act org-wide.
	if (ctx.actorRole === 'MANAGER') {
		const actorEmployee = await db.employee.findUnique({
			where: { userId: ctx.actorId },
			select: { id: true }
		})
		if (!actorEmployee || request.employee.reportsToId !== actorEmployee.id) {
			error(403, 'You can only review leave for your direct reports')
		}
	}

	if (request.status !== 'PENDING') error(400, 'Only pending requests can be reviewed')

	const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
		const lr = await tx.leaveRequest.update({
			where: { id },
			data: {
				status: approved ? 'APPROVED' : 'REJECTED',
				reviewedById: ctx.actorId,
				reviewedAt: new Date(),
				rejectionReason: approved ? null : rejectionReason
			}
		})

		if (approved) {
			await tx.leaveBalance.updateMany({
				where: {
					employeeId: request.employeeId,
					leaveTypeId: request.leaveTypeId,
					year: request.startDate.getFullYear()
				},
				data: {
					used: { increment: Number(request.totalDays) },
					remaining: { decrement: Number(request.totalDays) }
				}
			})
		}

		return lr
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'LeaveRequest',
		entityId: id,
		newValue: { status: updated.status }
	})

	return updated
}

export async function getLeaveBalances(employeeId: string, year: number) {
	return db.leaveBalance.findMany({
		where: { employeeId, year },
		include: { leaveType: { select: { name: true, isPaid: true } } }
	})
}
