import { redirect } from '@sveltejs/kit'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) {
		redirect(302, '/login')
	}

	return {
		user: {
			id: locals.user.id,
			email: locals.user.email,
			role: locals.user.role,
			organizationId: locals.user.organizationId
		}
	}
}
