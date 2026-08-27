import { json, error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import {
	listReviewsForEmployee,
	listReviewsForReviewer,
	redactHrAuthored
} from '$lib/server/services/performance'
import type { RequestHandler } from './$types'

// The current user's own reviews (as subject) and reviews assigned to them (as reviewer).
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'Unauthorized')
	const me = await db.employee.findUnique({
		where: { userId: locals.user.id },
		select: { id: true }
	})
	if (!me) return json({ asSubject: [], asReviewer: [] })
	const [asSubject, asReviewer] = await Promise.all([
		listReviewsForEmployee(me.id),
		listReviewsForReviewer(me.id)
	])
	// #178 item 127: the subject arm is redacted exactly like the page load already does
	// (`/performance/+page.server.ts:44`). `answers` now holds every rating and remark the
	// evaluator typed, so returning this arm raw leaks the whole evaluation to its subject before
	// HR releases it. Withheld by default. The reviewer arm is the evaluator's own view and stays
	// whole.
	return json({ asSubject: asSubject.map(redactHrAuthored), asReviewer })
}
