import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

// Approvals were merged into the unified "Requests/Approvals" page at /requests.
export const load: PageServerLoad = () => {
	redirect(308, '/requests')
}
