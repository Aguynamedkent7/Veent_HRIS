import type { Role } from '@prisma/client'

export interface AuditContext {
	organizationId: string
	actorId: string
	actorRole: Role
	// Full multi-role set (#133/#134). Absent → treated as [actorRole]. Approval-stage
	// checks read this so a [MANAGER, VERIFIER] user can act on the stage either holds.
	actorRoles?: Role[]
	ipAddress?: string
	userAgent?: string
}
