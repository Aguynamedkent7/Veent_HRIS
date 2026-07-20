import { lucia } from '$lib/server/auth'
import { redirect } from '@sveltejs/kit'
import type { Handle } from '@sveltejs/kit'

export const handle: Handle = async ({ event, resolve }) => {
	const sessionId = event.cookies.get(lucia.sessionCookieName)

	if (!sessionId) {
		event.locals.user = null
		event.locals.session = null
		return resolve(event)
	}

	const { session, user } = await lucia.validateSession(sessionId)

	if (session && session.fresh) {
		const sessionCookie = lucia.createSessionCookie(session.id)
		event.cookies.set(sessionCookie.name, sessionCookie.value, {
			path: '.',
			...sessionCookie.attributes
		})
	}

	if (!session) {
		const blankCookie = lucia.createBlankSessionCookie()
		event.cookies.set(blankCookie.name, blankCookie.value, {
			path: '.',
			...blankCookie.attributes
		})
	}

	// Cross-org members (#131) carry an active org on the session. Everything
	// downstream reads locals.user.organizationId for tenant isolation, so resolve
	// the effective org here: session.currentOrgId when set, else the primary org.
	event.locals.user =
		user && session
			? { ...user, organizationId: session.currentOrgId ?? user.organizationId }
			: user
	event.locals.session = session

	if (user && !user.isActive) {
		redirect(302, '/login?error=account_disabled')
	}

	return resolve(event)
}
