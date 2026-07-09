import { fail, redirect } from '@sveltejs/kit'
import { lucia } from '$lib/server/auth'
import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import type { Actions, PageServerLoad } from './$types'

const loginSchema = z.object({
	email: z.string().email(),
	password: z.string().min(1)
})

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) redirect(302, '/dashboard')
}

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const formData = Object.fromEntries(await request.formData())
		const parsed = loginSchema.safeParse(formData)

		if (!parsed.success) {
			return fail(400, { error: 'Invalid email or password' })
		}

		const { email, password } = parsed.data
		const ip = getClientAddress()

		const user = await db.user.findUnique({ where: { email } })

		if (!user || !user.isActive) {
			return fail(401, { error: 'Invalid email or password' })
		}

		const validPassword = await bcrypt.compare(password, user.passwordHash)

		if (!validPassword) {
			await writeAuditLog(
				{ organizationId: user.organizationId, actorId: user.id, actorRole: user.role, ipAddress: ip },
				{ action: 'LOGIN_FAILED', entityType: 'User', entityId: user.id }
			)
			return fail(401, { error: 'Invalid email or password' })
		}

		const session = await lucia.createSession(user.id, {})
		const sessionCookie = lucia.createSessionCookie(session.id)

		cookies.set(sessionCookie.name, sessionCookie.value, {
			path: '.',
			...sessionCookie.attributes
		})

		await Promise.all([
			db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
			writeAuditLog(
				{ organizationId: user.organizationId, actorId: user.id, actorRole: user.role, ipAddress: ip },
				{ action: 'LOGIN', entityType: 'User', entityId: user.id }
			)
		])

		redirect(302, '/dashboard')
	}
}
