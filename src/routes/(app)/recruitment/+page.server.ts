import { fail } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import { paginate } from '$lib/server/pagination'
import {
	countJobPostings,
	listJobPostings,
	createJobPosting,
	publishJobPosting,
	advanceApplicant
} from '$lib/server/services/recruitment'
import { db } from '$lib/server/db'
import { z } from 'zod'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, url }) => {
	requireMinRole(locals.user!.role, 'HR_ADMIN')

	// #64: paginate the postings list (the per-posting Kanban board is not paginated).
	const total = await countJobPostings(locals.user!.organizationId)
	const pagination = paginate(url, total)

	const [postings, departments] = await Promise.all([
		listJobPostings(locals.user!.organizationId, undefined, {
			skip: pagination.skip,
			take: pagination.take
		}),
		db.department.findMany({
			where: { organizationId: locals.user!.organizationId },
			orderBy: { name: 'asc' }
		})
	])

	return { postings, departments, pagination }
}

const createSchema = z.object({
	title: z.string().min(1),
	departmentId: z.string().min(1),
	description: z.string().min(1)
})

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'HR_ADMIN')

		const raw = Object.fromEntries(await request.formData())
		const parsed = createSchema.safeParse(raw)
		if (!parsed.success) return fail(400, { error: 'Invalid input' })

		await createJobPosting(user.organizationId, parsed.data, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
		return { success: true, message: `Job posting “${parsed.data.title}” created as a draft.` }
	},

	publish: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'HR_ADMIN')

		const data = await request.formData()
		const id = data.get('id') as string

		await publishJobPosting(id, user.organizationId, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
		return { success: true, message: 'Job posting published.' }
	},

	// Bulk-publish selected draft postings (mass posting).
	publishMany: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'HR_ADMIN')

		const ids = (await request.formData()).getAll('ids').map(String).filter(Boolean)
		if (!ids.length) return fail(400, { error: 'No postings selected.' })

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		}
		// Publish each; skip any that aren't drafts (already open/closed) rather than failing the batch.
		let published = 0
		for (const id of ids) {
			try {
				await publishJobPosting(id, user.organizationId, ctx)
				published++
			} catch {
				// ignore individual failures (e.g. not a draft) so the rest still publish
			}
		}
		return {
			success: true,
			published,
			message: `${published} of ${ids.length} selected posting(s) published.`
		}
	},

	advance: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'HR_ADMIN')

		const data = await request.formData()
		const applicantId = data.get('applicantId') as string
		const stage = data.get('stage') as string
		const notes = data.get('notes') as string | undefined

		await advanceApplicant(applicantId, user.organizationId, stage as never, notes, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	}
}
