import { json, error } from '@sveltejs/kit'
import { getEmployeeMetrics, getManagerMetrics, getAdminMetrics } from '$lib/server/services/dashboard'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized')

	const user = locals.user

	let metrics: unknown

	if (user.role === 'EMPLOYEE') {
		metrics = await getEmployeeMetrics(user.id, user.organizationId)
	} else if (user.role === 'MANAGER') {
		metrics = await getManagerMetrics(user.id, user.organizationId)
	} else {
		// HR_ADMIN or SUPER_ADMIN
		metrics = await getAdminMetrics(user.organizationId)
	}

	return json(metrics)
}
