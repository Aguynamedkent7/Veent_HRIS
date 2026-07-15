import { fail, isHttpError, redirect } from '@sveltejs/kit'
import { z } from 'zod'
import { requireRole } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import {
	getApplicant,
	scheduleInterview,
	recordInterviewFeedback,
	deleteInterview,
	issueOffer,
	respondToOffer,
	deleteOffer,
	convertApplicantToEmployee
} from '$lib/server/services/recruitment'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, locals }) => {
	const user = locals.user!
	requireRole(user.role, 'HR_ADMIN', 'SUPER_ADMIN')

	const [applicant, departments] = await Promise.all([
		getApplicant(params.applicantId, user.organizationId),
		db.department.findMany({
			where: { organizationId: user.organizationId },
			orderBy: { name: 'asc' },
			select: { id: true, name: true }
		})
	])

	return { applicant, departments }
}

function ctxOf(locals: App.Locals, ip: string) {
	return {
		organizationId: locals.user!.organizationId,
		actorId: locals.user!.id,
		actorRole: locals.user!.role,
		ipAddress: ip
	}
}

const interviewSchema = z.object({
	// Date and time come from separate GUI pickers, combined server-side.
	scheduledDate: z.string().min(1),
	scheduledTime: z.string().min(1),
	mode: z.enum(['ONSITE', 'VIDEO', 'PHONE']),
	interviewer: z.string().trim().min(1),
	location: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : null))
})

const offerSchema = z.object({
	jobTitle: z.string().trim().min(1),
	departmentId: z
		.string()
		.optional()
		.transform((v) => (v ? v : null)),
	monthlySalary: z.coerce.number().positive(),
	startDate: z.coerce.date(),
	notes: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : null))
})

export const actions: Actions = {
	scheduleInterview: async ({ request, locals, params, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')
		const parsed = interviewSchema.safeParse(Object.fromEntries(await request.formData()))
		if (!parsed.success)
			return fail(400, { error: 'Date, time, mode, and interviewer are required.' })
		const scheduledAt = new Date(`${parsed.data.scheduledDate}T${parsed.data.scheduledTime}`)
		if (Number.isNaN(scheduledAt.getTime())) return fail(400, { error: 'Invalid date or time.' })
		try {
			await scheduleInterview(
				params.applicantId,
				locals.user!.organizationId,
				{
					scheduledAt,
					mode: parsed.data.mode,
					interviewer: parsed.data.interviewer,
					location: parsed.data.location
				},
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { success: true }
	},

	recordFeedback: async ({ request, locals, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')
		const data = await request.formData()
		const interviewId = data.get('interviewId') as string
		const feedback = ((data.get('feedback') as string) ?? '').trim()
		if (!interviewId) return fail(400, { error: 'Missing interview id.' })
		try {
			await recordInterviewFeedback(
				interviewId,
				locals.user!.organizationId,
				feedback,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { success: true }
	},

	deleteInterview: async ({ request, locals, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')
		const interviewId = (await request.formData()).get('interviewId') as string
		if (!interviewId) return fail(400, { error: 'Missing interview id.' })
		try {
			await deleteInterview(
				interviewId,
				locals.user!.organizationId,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { success: true }
	},

	issueOffer: async ({ request, locals, params, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')
		const parsed = offerSchema.safeParse(Object.fromEntries(await request.formData()))
		if (!parsed.success)
			return fail(400, { error: 'Job title, salary, and start date are required.' })
		try {
			await issueOffer(
				params.applicantId,
				locals.user!.organizationId,
				parsed.data,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { success: true }
	},

	respondOffer: async ({ request, locals, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')
		const data = await request.formData()
		const offerId = data.get('offerId') as string
		const accepted = data.get('accepted') === 'true'
		if (!offerId) return fail(400, { error: 'Missing offer id.' })
		try {
			await respondToOffer(
				offerId,
				locals.user!.organizationId,
				accepted,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { success: true }
	},

	deleteOffer: async ({ request, locals, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')
		const offerId = (await request.formData()).get('offerId') as string
		if (!offerId) return fail(400, { error: 'Missing offer id.' })
		try {
			await deleteOffer(offerId, locals.user!.organizationId, ctxOf(locals, getClientAddress()))
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { success: true }
	},

	convert: async ({ locals, params, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')
		let employee
		try {
			employee = await convertApplicantToEmployee(
				params.applicantId,
				locals.user!.organizationId,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return redirect(302, `/employees/${employee.id}`)
	}
}
