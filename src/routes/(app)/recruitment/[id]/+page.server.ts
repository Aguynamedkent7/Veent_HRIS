import { fail, isHttpError, redirect } from '@sveltejs/kit'
import { z } from 'zod'
import { requireRole } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import { advanceApplicant, convertApplicantToEmployee } from '$lib/server/services/recruitment'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = locals.user!

	const posting = await db.jobPosting.findFirst({
		where: { id: params.id, organizationId: user.organizationId },
		include: { department: true }
	})

	if (!posting) {
		return redirect(302, '/recruitment')
	}

	const applicants = await db.applicant.findMany({
		where: { jobPostingId: params.id },
		orderBy: { createdAt: 'asc' }
	})

	return {
		posting,
		applicants,
		userRole: user.role
	}
}

const advanceStageSchema = z.object({
	applicantId: z.string().min(1),
	stage: z.enum(['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']),
	notes: z.string().optional()
})

export const actions: Actions = {
	advanceStage: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireRole(user.role, 'HR_ADMIN', 'SUPER_ADMIN')

		const raw = Object.fromEntries(await request.formData())
		const parsed = advanceStageSchema.safeParse(raw)
		if (!parsed.success) {
			return fail(400, { error: 'Invalid input', details: parsed.error.flatten() })
		}

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		}

		await advanceApplicant(
			parsed.data.applicantId,
			user.organizationId,
			parsed.data.stage,
			parsed.data.notes,
			ctx
		)
	},

	updateStatus: async ({ request, locals, params }) => {
		const user = locals.user!
		requireRole(user.role, 'HR_ADMIN', 'SUPER_ADMIN')

		const data = await request.formData()
		const status = data.get('status') as string

		const validStatuses = ['OPEN', 'CLOSED', 'DRAFT']
		if (!validStatuses.includes(status)) {
			return fail(400, { error: 'Invalid status' })
		}

		const posting = await db.jobPosting.findFirst({
			where: { id: params.id, organizationId: user.organizationId }
		})

		if (!posting) {
			return fail(404, { error: 'Posting not found' })
		}

		await db.jobPosting.update({
			where: { id: params.id },
			data: {
				status: status as 'OPEN' | 'CLOSED' | 'DRAFT',
				...(status === 'OPEN' && !posting.postedAt ? { postedAt: new Date() } : {}),
				...(status === 'CLOSED' ? { closedAt: new Date() } : {})
			}
		})
	},

	convert: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireRole(user.role, 'HR_ADMIN', 'SUPER_ADMIN')

		const data = await request.formData()
		const applicantId = data.get('applicantId') as string
		if (!applicantId) {
			return fail(400, { error: 'Applicant ID required' })
		}

		let newEmployee
		try {
			newEmployee = await convertApplicantToEmployee(applicantId, user.organizationId, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}

		return redirect(302, `/employees/${newEmployee.id}`)
	}
}
