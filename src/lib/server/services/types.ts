import type { Role } from '@prisma/client'

export interface AuditContext {
	organizationId: string
	actorId: string
	actorRole: Role
	ipAddress?: string
	userAgent?: string
}
