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
			organizationId: attributes.organizationId,
			isActive: attributes.isActive
		}
	}
})

declare module 'lucia' {
	interface Register {
		Lucia: typeof lucia
		DatabaseUserAttributes: {
			email: string
			role: Role
			organizationId: string
			isActive: boolean
		}
	}
}
