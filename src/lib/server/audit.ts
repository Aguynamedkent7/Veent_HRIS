import type { AuditAction, Role } from '@prisma/client'
import { db } from './db'

interface AuditContext {
	organizationId: string
	actorId: string
	actorRole: Role
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

export async function writeAuditLog(
	ctx: AuditContext,
	payload: AuditPayload
): Promise<void> {
	await db.auditLog.create({
		data: {
			organizationId: ctx.organizationId,
			actorId: ctx.actorId,
			actorRole: ctx.actorRole,
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
