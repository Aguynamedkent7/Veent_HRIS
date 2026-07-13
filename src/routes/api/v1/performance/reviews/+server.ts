import { json, error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { listReviewsForEmployee, listReviewsForReviewer } from '$lib/server/services/performance'
import type { RequestHandler } from './$types'

// The current user's own reviews (as subject) and reviews assigned to them (as reviewer).
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized')
	const me = await db.employee.findUnique({ where: { userId: locals.user.id }, select: { id: true } })
	if (!me) return json({ asSubject: [], asReviewer: [] })
	const [asSubject, asReviewer] = await Promise.all([listReviewsForEmployee(me.id), listReviewsForReviewer(me.id)])
	return json({ asSubject, asReviewer })
}
