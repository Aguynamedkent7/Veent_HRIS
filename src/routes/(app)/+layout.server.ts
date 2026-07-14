import { redirect } from '@sveltejs/kit'
import { listUnread } from '$lib/server/services/notifications'
import { countPendingApprovals } from '$lib/server/services/approvals'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(302, '/login')
	}

	const user = locals.user
	const [notifications, pendingApprovals] = await Promise.all([
		listUnread(user.id),
		countPendingApprovals({ id: user.id, role: user.role, organizationId: user.organizationId })
	])

	return {
		user: {
			id: user.id,
			email: user.email,
			role: user.role,
			organizationId: user.organizationId
		},
		notifications,
		pendingApprovals
	}
}
