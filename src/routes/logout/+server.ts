import { redirect } from '@sveltejs/kit'
import { lucia } from '$lib/server/auth'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ locals, cookies }) => {
	if (!locals.session) redirect(302, '/login')

	await lucia.invalidateSession(locals.session.id)

	const blankCookie = lucia.createBlankSessionCookie()
	cookies.set(blankCookie.name, blankCookie.value, {
		path: '.',
		...blankCookie.attributes
	})

	redirect(302, '/login')
}
