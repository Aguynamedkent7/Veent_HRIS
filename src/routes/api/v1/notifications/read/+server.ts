import { json, error } from '@sveltejs/kit'
import { markAllRead } from '$lib/server/services/notifications'
import type { RequestHandler } from './$types'

// Mark all of the current user's notifications read (called once toasts are shown).
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized')
	await markAllRead(locals.user.id)
	return json({ ok: true })
}
