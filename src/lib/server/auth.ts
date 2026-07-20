import { Lucia } from 'lucia'
import { PrismaAdapter } from '@lucia-auth/adapter-prisma'
import { db } from './db'
import type { Role } from '@prisma/client'

const adapter = new PrismaAdapter(db.session, db.user)

export const lucia = new Lucia(adapter, {
	sessionCookie: {
		attributes: {
			secure: process.env.NODE_ENV === 'production'
		}
	},
	getUserAttributes(attributes) {
		return {
			email: attributes.email,
			role: attributes.role,
			// Full multi-role set (#133). Fall back to the primary role for any pre-backfill
			// row so `roles` is never empty for capability checks.
			roles: attributes.roles?.length ? attributes.roles : [attributes.role],
			organizationId: attributes.organizationId,
			isActive: attributes.isActive
		}
	},
	getSessionAttributes(attributes) {
		return {
			currentOrgId: attributes.currentOrgId
		}
	}
})

declare module 'lucia' {
	interface Register {
		Lucia: typeof lucia
		DatabaseUserAttributes: {
			email: string
			role: Role
			roles: Role[]
			organizationId: string
			isActive: boolean
		}
		DatabaseSessionAttributes: {
			currentOrgId: string | null
		}
	}
}
