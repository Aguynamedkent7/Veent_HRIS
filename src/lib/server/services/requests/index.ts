import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { deleteStoredFile } from '$lib/server/storage'
import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import {
	requestSchema,
	deriveRequestColumns,
	type RequestInput
} from '$lib/server/schemas/requests'
import { resolveChain } from './routing'
import { computeLeaveTotalDays, assertLeaveBalance } from './leave'
import type { AuditContext } from '../types'

// Create a request and its resolved approval chain in one transaction. The chain
// comes from DEFAULT_ROUTING; the supervisor stage is only included when the
// employee actually has a reportsTo. currentStage starts at 0 (first pending step).
export async function createRequest(
	employeeId: string,
	organizationId: string,
	input: RequestInput,
	ctx: AuditContext
) {
	const parsed = requestSchema.parse(input)
	const cols = deriveRequestColumns(parsed)

	const employee = await db.employee.findFirst({
		where: { id: employeeId, user: { organizationId } },
		select: { id: true, reportsToId: true }
	})
	if (!employee) error(404, 'Employee not found')

	// LEAVE carries balance semantics: compute workdays, verify balance up front, and
	// stash totalDays into the payload so approval can deduct it later.
	let payload: Record<string, unknown> = parsed
	if (parsed.type === 'LEAVE') {
		const totalDays = await computeLeaveTotalDays(organizationId, parsed.startDate, parsed.endDate)
		await assertLeaveBalance(
			employeeId,
			parsed.leaveTypeId,
			parsed.startDate.getFullYear(),
			totalDays
		)
		payload = { ...parsed, totalDays }
	}

	const chain = resolveChain(parsed.type, { hasSupervisor: Boolean(employee.reportsToId) })

	const created = await db.request.create({
		data: {
			employeeId,
			type: parsed.type,
			status: 'PENDING',
			dateFrom: cols.dateFrom,
			dateTo: cols.dateTo,
			hours: cols.hours,
			reason: cols.reason,
			payload: payload as unknown as Prisma.InputJsonValue,
			currentStage: 0,
			steps: {
				create: chain.map((s) => ({
					stageIndex: s.stageIndex,
					stageKind: s.stageKind,
					role: s.role
				}))
			}
		},
		include: { steps: { orderBy: { stageIndex: 'asc' } } }
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'Request',
		entityId: created.id,
		newValue: { type: parsed.type, dateFrom: cols.dateFrom, stages: chain.length }
	})

	return created
}

interface RequestListParams {
	organizationId: string
	employeeId?: string
	type?: RequestInput['type']
	status?: string
}

function requestListWhere(params: RequestListParams): Prisma.RequestWhereInput {
	return {
		employee: { user: { organizationId: params.organizationId } },
		...(params.employeeId && { employeeId: params.employeeId }),
		...(params.type && { type: params.type }),
		...(params.status && { status: params.status as never })
	}
}

export async function countRequests(params: RequestListParams) {
	return db.request.count({ where: requestListWhere(params) })
}

export async function listRequests(
	params: RequestListParams,
	pageArgs?: { skip: number; take: number }
) {
	return db.request.findMany({
		where: requestListWhere(params),
		include: {
			employee: { select: { id: true, firstName: true, lastName: true } },
			steps: { orderBy: { stageIndex: 'asc' } }
		},
		orderBy: { createdAt: 'desc' },
		...(pageArgs && { skip: pageArgs.skip, take: pageArgs.take })
	})
}

export async function getRequest(id: string, organizationId: string) {
	return db.request.findFirst({
		where: { id, employee: { user: { organizationId } } },
		include: {
			employee: { select: { id: true, firstName: true, lastName: true } },
			steps: {
				orderBy: { stageIndex: 'asc' },
				include: { actor: { select: { id: true, email: true } } }
			},
			documents: {
				orderBy: { uploadedAt: 'asc' },
				include: { verifiedBy: { select: { id: true, email: true } } }
			}
		}
	})
}

// Employee re-submits a RETURNED request: reset the chain and re-enter at stage 0.
export async function resubmitRequest(id: string, employeeId: string, ctx: AuditContext) {
	const req = await db.request.findFirst({
		where: { id, employeeId },
		select: { id: true, status: true }
	})
	if (!req) error(404, 'Request not found')
	if (req.status !== 'RETURNED') error(400, 'Only returned requests can be re-submitted')

	const updated = await db.$transaction(async (tx) => {
		await tx.approvalStep.updateMany({
			where: { requestId: id },
			data: { decision: null, actorId: null, note: null, decidedAt: null }
		})
		return tx.request.update({ where: { id }, data: { status: 'PENDING', currentStage: 0 } })
	})
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Request',
		entityId: id,
		newValue: { status: 'PENDING', resubmitted: true }
	})
	return updated
}

// Employee withdraws their own still-pending request.
export async function cancelRequest(id: string, employeeId: string, ctx: AuditContext) {
	const req = await db.request.findFirst({
		where: { id, employeeId },
		select: { id: true, status: true }
	})
	if (!req) error(404, 'Request not found')
	if (req.status !== 'PENDING' && req.status !== 'RETURNED') {
		error(400, 'Only pending or returned requests can be cancelled')
	}
	const updated = await db.request.update({ where: { id }, data: { status: 'CANCELLED' } })
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Request',
		entityId: id,
		newValue: { status: 'CANCELLED' }
	})
	return updated
}

// Hard-delete a request; its approval steps and documents cascade (schema onDelete: Cascade).
// APPROVED requests are never deletable — final approval already moved leave balances and there is
// no reversal path here, so dropping the row would desync the balance. Non-privileged callers may
// delete only their own requests; HR_ADMIN / SUPER_ADMIN may delete any request in their org.
export async function deleteRequest(id: string, organizationId: string, ctx: AuditContext) {
	const req = await db.request.findFirst({
		where: { id, employee: { user: { organizationId } } },
		select: {
			id: true,
			status: true,
			type: true,
			employeeId: true,
			documents: { select: { storageKey: true } }
		}
	})
	if (!req) error(404, 'Request not found')

	const isPrivileged = ctx.actorRole === 'HR_ADMIN' || ctx.actorRole === 'SUPER_ADMIN'
	if (!isPrivileged) {
		const me = await db.employee.findUnique({
			where: { userId: ctx.actorId },
			select: { id: true }
		})
		if (!me || me.id !== req.employeeId) error(403, 'You can only delete your own requests')
	}
	if (req.status === 'APPROVED') error(409, 'Approved requests cannot be deleted')

	await db.request.delete({ where: { id } })
	// Row cascade removed the document rows; sweep their bytes off disk too. Each unlink
	// is best-effort — the request is already gone, so one failed cleanup must not stop
	// the rest of the sweep or skip the audit entry.
	for (const d of req.documents) {
		await deleteStoredFile(d.storageKey).catch((e) =>
			console.error('[storage] failed to remove', d.storageKey, e)
		)
	}
	await writeAuditLog(ctx, {
		action: 'DELETE',
		entityType: 'Request',
		entityId: id,
		oldValue: { type: req.type, status: req.status }
	})
	return { deleted: true }
}
