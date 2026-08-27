import { canAny } from '$lib/server/rbac'
import {
	listReviewsForEmployee,
	listReviewsForReviewer,
	redactHrAuthored,
	listReviewCycles
} from '$lib/server/services/performance'
import { countEmployeesWithoutTemplate } from '$lib/server/services/performance-templates'
import { db } from '$lib/server/db'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const isAdmin = canAny(user.roles, 'MANAGE_HR')

	const cycles = isAdmin ? await listReviewCycles(user.organizationId) : []

	// #178: the template-readiness count is org-wide configuration, so it reads
	// ADMINISTER_HR_ORGWIDE — not MANAGE_HR, which includes MANAGER (#133). A manager or an
	// employee never runs the query, and reads 0. Informational only: nothing gates on it.
	const templateBackfill = canAny(user.roles, 'ADMINISTER_HR_ORGWIDE')
		? await countEmployeesWithoutTemplate(user.organizationId)
		: 0

	const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
	if (!myEmployee) {
		return {
			myReviews: [],
			reviewsToGive: [],
			isAdmin,
			cycles,
			templateBackfill
		}
	}

	const [myReviews, reviewsToGive] = await Promise.all([
		listReviewsForEmployee(myEmployee.id),
		listReviewsForReviewer(myEmployee.id)
	])

	// #179: My Reviews are the viewer's own reviews as the subject — strip the HR-authored
	// comments and rating so the confidential review never reaches the reviewed employee.
	return {
		myReviews: myReviews.map(redactHrAuthored),
		reviewsToGive,
		isAdmin,
		cycles,
		templateBackfill
	}
}
