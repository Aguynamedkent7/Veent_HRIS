import { dev } from '$app/environment'
import { json, error } from '@sveltejs/kit'
import { lucia } from '$lib/server/auth'
import { db } from '$lib/server/db'
import type { RequestHandler } from './$types'

// ─────────────────────────────────────────────────────────────────────────────
// TEMP DEV ONLY — remove before merge.
// One-click login as any seeded user, no password. Hard-guarded to `dev`, so a
// built/preview/prod bundle returns 404 and never exposes this. Pairs with
// $lib/components/dev/DevLoginSwitcher.svelte.
// ─────────────────────────────────────────────────────────────────────────────
export const POST: RequestHandler = async ({ request, cookies }) => {
	if (!dev) error(404, 'Not found')

	const body = await request.json().catch(() => null)
	const email = body?.email
	if (typeof email !== 'string') error(400, 'email required')

	const user = await db.user.findUnique({ where: { email } })
	if (!user) error(404, 'No such user')

	// Land in the user's primary org; the header switcher handles cross-org from there.
	const session = await lucia.createSession(user.id, { currentOrgId: user.organizationId })
	const cookie = lucia.createSessionCookie(session.id)
	cookies.set(cookie.name, cookie.value, { path: '.', ...cookie.attributes })

	return json({ ok: true })
}
