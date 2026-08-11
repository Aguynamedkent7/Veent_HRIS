import type { AuditAction, Prisma, Role } from '@prisma/client'
import { db } from './db'

interface AuditContext {
	organizationId: string
	actorId: string
	actorRoles: Role[]
	ipAddress?: string
	userAgent?: string
}

interface AuditPayload {
	action: AuditAction
	entityType: string
	entityId: string
	oldValue?: Record<string, unknown>
	newValue?: Record<string, unknown>
}

// `client` defaults to the shared db, but callers inside a $transaction can pass their tx
// client so the audit row commits or rolls back atomically with the mutation it records.
export async function writeAuditLog(
	ctx: AuditContext,
	payload: AuditPayload,
	client: Prisma.TransactionClient = db
): Promise<void> {
	await client.auditLog.create({
		data: {
			organizationId: ctx.organizationId,
			actorId: ctx.actorId,
			// ponytail: actorRole is dropped in commit 11; fed from the set until then
			actorRole: ctx.actorRoles[0],
			actorRoles: ctx.actorRoles,
			action: payload.action,
			entityType: payload.entityType,
			entityId: payload.entityId,
			oldValue: payload.oldValue ? (payload.oldValue as object) : undefined,
			newValue: payload.newValue ? (payload.newValue as object) : undefined,
			ipAddress: ctx.ipAddress,
			userAgent: ctx.userAgent
		}
	})
}
