import { can } from '$lib/server/rbac'
import { json, error } from '@sveltejs/kit'
import {
	getEmployeeMetrics,
	getManagerMetrics,
	getAdminMetrics
} from '$lib/server/services/dashboard'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized')

	const user = locals.user

	let metrics: unknown

	// Ordered most- to least-privileged, and closed by default: the org-wide metrics are
	// now behind an explicit capability rather than an `else`, which is what let FINANCE
	// and PAYROLL_OFFICER fall through to them. A role that holds neither capability gets
	// its own metrics, so a newly added role under-grants rather than over-grants.
	if (can(user.role, 'MANAGE_HR')) {
		metrics = await getAdminMetrics(user.organizationId)
	} else if (can(user.role, 'VIEW_TEAM') || can(user.role, 'VIEW_PAYROLL_REPORTS')) {
		// Manager ladder, plus the payroll specialists who need a team-level view.
		metrics = await getManagerMetrics(user.id, user.organizationId)
	} else {
		metrics = await getEmployeeMetrics(user.id, user.organizationId)
	}

	return json(metrics)
}
