import { redirect } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { listUnread } from '$lib/server/services/notifications'
import { countPendingApprovals } from '$lib/server/services/approvals'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(302, '/login')
	}

	const user = locals.user
	const [notifications, pendingApprovals, memberships] = await Promise.all([
		listUnread(user.id),
		countPendingApprovals({
			id: user.id,
			role: user.role,
			roles: user.roles,
			organizationId: user.organizationId
		}),
		db.userOrganization.findMany({
			where: { userId: user.id },
			select: { organization: { select: { id: true, name: true } } },
			orderBy: { organization: { name: 'asc' } }
		})
	])

	// Only cross-org members get a switcher; the layout hides it when length <= 1.
	const memberOrgs = memberships.map((m) => m.organization)

	return {
		user: {
			id: user.id,
			email: user.email,
			role: user.role,
			roles: user.roles,
			organizationId: user.organizationId
		},
		memberOrgs,
		notifications,
		pendingApprovals
	}
}
