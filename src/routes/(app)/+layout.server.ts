import { redirect } from '@sveltejs/kit'
import { listUnread } from '$lib/server/services/notifications'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(302, '/login')
	}

	const notifications = await listUnread(locals.user.id)

	return {
		user: {
			id: locals.user.id,
			email: locals.user.email,
			role: locals.user.role,
			organizationId: locals.user.organizationId
		},
		notifications
	}
}
