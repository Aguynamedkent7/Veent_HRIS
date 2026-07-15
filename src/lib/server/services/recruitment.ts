import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import { createEmployee } from './employees'
import type { AuditContext } from './types'
import type { JobPostingStatus, ApplicantStage, InterviewMode } from '@prisma/client'

export async function listJobPostings(organizationId: string, status?: JobPostingStatus) {
	return db.jobPosting.findMany({
		where: { organizationId, ...(status && { status }) },
		include: {
			department: { select: { name: true } },
			_count: { select: { applicants: true } }
		},
		orderBy: { createdAt: 'desc' }
	})
}

export async function getJobPosting(id: string, organizationId: string) {
	const jp = await db.jobPosting.findFirst({
		where: { id, organizationId },
		include: {
			department: true,
			applicants: {
				include: { stageHistory: { orderBy: { changedAt: 'desc' }, take: 1 } },
				orderBy: { createdAt: 'desc' }
			}
		}
	})
	if (!jp) error(404, 'Job posting not found')
	return jp
}

export async function createJobPosting(
	organizationId: string,
	input: { departmentId: string; title: string; description: string },
	ctx: AuditContext
) {
	const jp = await db.jobPosting.create({
		data: { organizationId, ...input, createdById: ctx.actorId }
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'JobPosting',
		entityId: jp.id,
		newValue: { title: input.title }
	})

	return jp
}

export async function publishJobPosting(id: string, organizationId: string, ctx: AuditContext) {
	const jp = await db.jobPosting.findFirst({ where: { id, organizationId } })
	if (!jp) error(404, 'Job posting not found')
	if (jp.status !== 'DRAFT') error(400, 'Only draft postings can be published')

	const updated = await db.jobPosting.update({
		where: { id },
		data: { status: 'OPEN', postedAt: new Date() }
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'JobPosting',
		entityId: id,
		newValue: { status: 'OPEN' }
	})

	return updated
}

export async function applyToPosting(
	jobPostingId: string,
	input: {
		firstName: string
		lastName: string
		email: string
		phone?: string
		coverLetter?: string
	}
) {
	const jp = await db.jobPosting.findUnique({ where: { id: jobPostingId } })
	if (!jp || jp.status !== 'OPEN') error(400, 'This position is not accepting applications')

	return db.applicant.create({
		data: { jobPostingId, ...input }
	})
}

export async function advanceApplicant(
	applicantId: string,
	organizationId: string,
	stage: ApplicantStage,
	notes: string | undefined,
	ctx: AuditContext
) {
	const applicant = await db.applicant.findFirst({
		where: { id: applicantId, jobPosting: { organizationId } }
	})
	if (!applicant) error(404, 'Applicant not found')

	const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
		const a = await tx.applicant.update({
			where: { id: applicantId },
			data: { currentStage: stage }
		})

		await tx.applicantStageHistory.create({
			data: { applicantId, stage, notes, changedById: ctx.actorId }
		})

		return a
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Applicant',
		entityId: applicantId,
		newValue: { stage }
	})

	return updated
}

// ─── Interviews & Offers (T177 / FR-068, FR-069) ─────────────────────────────

// Ensures the applicant exists within the actor's organization.
async function requireApplicant(applicantId: string, organizationId: string) {
	const applicant = await db.applicant.findFirst({
		where: { id: applicantId, jobPosting: { organizationId } }
	})
	if (!applicant) error(404, 'Applicant not found')
	return applicant
}

export async function getApplicant(applicantId: string, organizationId: string) {
	const applicant = await db.applicant.findFirst({
		where: { id: applicantId, jobPosting: { organizationId } },
		include: {
			jobPosting: { include: { department: true } },
			interviews: { orderBy: { scheduledAt: 'desc' } },
			offer: { include: { department: true } },
			stageHistory: { orderBy: { changedAt: 'desc' } },
			convertedEmployee: { select: { id: true } }
		}
	})
	if (!applicant) error(404, 'Applicant not found')
	return applicant
}

export async function scheduleInterview(
	applicantId: string,
	organizationId: string,
	input: { scheduledAt: Date; mode: InterviewMode; interviewer: string; location?: string | null },
	ctx: AuditContext
) {
	const applicant = await requireApplicant(applicantId, organizationId)

	const interview = await db.interview.create({
		data: {
			applicantId,
			scheduledAt: input.scheduledAt,
			mode: input.mode,
			interviewer: input.interviewer,
			location: input.location ?? null,
			createdById: ctx.actorId
		}
	})

	// Nudge the applicant into the INTERVIEW stage if they're still earlier.
	if (applicant.currentStage === 'APPLIED' || applicant.currentStage === 'SCREENING') {
		await db.applicant.update({ where: { id: applicantId }, data: { currentStage: 'INTERVIEW' } })
		await db.applicantStageHistory.create({
			data: {
				applicantId,
				stage: 'INTERVIEW',
				notes: 'Interview scheduled',
				changedById: ctx.actorId
			}
		})
	}

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'Interview',
		entityId: interview.id,
		newValue: { applicantId, scheduledAt: input.scheduledAt.toISOString(), mode: input.mode }
	})
	return interview
}

export async function recordInterviewFeedback(
	interviewId: string,
	organizationId: string,
	feedback: string,
	ctx: AuditContext
) {
	const interview = await db.interview.findFirst({
		where: { id: interviewId, applicant: { jobPosting: { organizationId } } },
		include: { applicant: { select: { currentStage: true } } }
	})
	if (!interview) error(404, 'Interview not found')

	const updated = await db.interview.update({ where: { id: interviewId }, data: { feedback } })

	// Surface the feedback in the stage-history timeline (keeps the current stage).
	await db.applicantStageHistory.create({
		data: {
			applicantId: interview.applicantId,
			stage: interview.applicant.currentStage,
			notes: 'Interview feedback recorded',
			changedById: ctx.actorId
		}
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Interview',
		entityId: interviewId,
		newValue: { feedbackRecorded: true }
	})
	return updated
}

export async function deleteInterview(
	interviewId: string,
	organizationId: string,
	ctx: AuditContext
) {
	const interview = await db.interview.findFirst({
		where: { id: interviewId, applicant: { jobPosting: { organizationId } } },
		include: { applicant: { select: { currentStage: true } } }
	})
	if (!interview) error(404, 'Interview not found')

	await db.interview.delete({ where: { id: interviewId } })

	// If that was the last interview and the applicant is still at the INTERVIEW
	// stage (scheduling had auto-advanced them), send them back to SCREENING.
	const remaining = await db.interview.count({ where: { applicantId: interview.applicantId } })
	if (remaining === 0 && interview.applicant.currentStage === 'INTERVIEW') {
		await db.applicant.update({
			where: { id: interview.applicantId },
			data: { currentStage: 'SCREENING' }
		})
		await db.applicantStageHistory.create({
			data: {
				applicantId: interview.applicantId,
				stage: 'SCREENING',
				notes: 'Interview removed',
				changedById: ctx.actorId
			}
		})
	}

	await writeAuditLog(ctx, { action: 'DELETE', entityType: 'Interview', entityId: interviewId })
}

export async function issueOffer(
	applicantId: string,
	organizationId: string,
	input: {
		jobTitle: string
		departmentId?: string | null
		monthlySalary: number
		startDate: Date
		notes?: string | null
	},
	ctx: AuditContext
) {
	const applicant = await db.applicant.findFirst({
		where: { id: applicantId, jobPosting: { organizationId } },
		include: { offer: true }
	})
	if (!applicant) error(404, 'Applicant not found')
	if (applicant.convertedToEmployeeId) error(409, 'Applicant already converted to an employee')
	if (applicant.offer?.status === 'ACCEPTED') error(409, 'This offer has already been accepted')

	// Re-issuing replaces a prior sent/declined offer (one offer per applicant).
	const data = {
		jobTitle: input.jobTitle,
		departmentId: input.departmentId ?? null,
		monthlySalary: input.monthlySalary,
		startDate: input.startDate,
		notes: input.notes ?? null
	}
	const offer = await db.offer.upsert({
		where: { applicantId },
		create: { applicantId, ...data, status: 'SENT', createdById: ctx.actorId },
		update: { ...data, status: 'SENT', respondedAt: null }
	})

	if (applicant.currentStage !== 'OFFER' && applicant.currentStage !== 'HIRED') {
		await db.applicant.update({ where: { id: applicantId }, data: { currentStage: 'OFFER' } })
		await db.applicantStageHistory.create({
			data: { applicantId, stage: 'OFFER', notes: 'Offer issued', changedById: ctx.actorId }
		})
	}

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'Offer',
		entityId: offer.id,
		newValue: { jobTitle: input.jobTitle, monthlySalary: input.monthlySalary }
	})
	return offer
}

export async function respondToOffer(
	offerId: string,
	organizationId: string,
	accepted: boolean,
	ctx: AuditContext
) {
	const offer = await db.offer.findFirst({
		where: { id: offerId, applicant: { jobPosting: { organizationId } } }
	})
	if (!offer) error(404, 'Offer not found')
	if (offer.status !== 'SENT') error(400, 'This offer has already been responded to')

	const status = accepted ? 'ACCEPTED' : 'DECLINED'
	const newStage = accepted ? 'HIRED' : 'REJECTED'

	const updated = await db.$transaction(async (tx: Prisma.TransactionClient) => {
		const o = await tx.offer.update({
			where: { id: offerId },
			data: { status, respondedAt: new Date() }
		})
		await tx.applicant.update({
			where: { id: offer.applicantId },
			data: { currentStage: newStage }
		})
		await tx.applicantStageHistory.create({
			data: {
				applicantId: offer.applicantId,
				stage: newStage,
				notes: accepted ? 'Offer accepted' : 'Offer declined',
				changedById: ctx.actorId
			}
		})
		return o
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Offer',
		entityId: offerId,
		newValue: { status }
	})
	return updated
}

// Withdraw a job offer and roll the applicant back to their prior stage.
export async function deleteOffer(offerId: string, organizationId: string, ctx: AuditContext) {
	const offer = await db.offer.findFirst({
		where: { id: offerId, applicant: { jobPosting: { organizationId } } },
		include: { applicant: { select: { id: true, currentStage: true, convertedToEmployeeId: true } } }
	})
	if (!offer) error(404, 'Offer not found')
	if (offer.applicant.convertedToEmployeeId)
		error(409, 'Cannot withdraw — the applicant has already been converted to an employee.')

	await db.offer.delete({ where: { id: offerId } })

	// Roll back from OFFER/HIRED to the most recent meaningful stage.
	if (offer.applicant.currentStage === 'OFFER' || offer.applicant.currentStage === 'HIRED') {
		const hasInterviews =
			(await db.interview.count({ where: { applicantId: offer.applicantId } })) > 0
		const stage = hasInterviews ? 'INTERVIEW' : 'SCREENING'
		await db.applicant.update({ where: { id: offer.applicantId }, data: { currentStage: stage } })
		await db.applicantStageHistory.create({
			data: {
				applicantId: offer.applicantId,
				stage,
				notes: 'Offer withdrawn',
				changedById: ctx.actorId
			}
		})
	}

	await writeAuditLog(ctx, { action: 'DELETE', entityType: 'Offer', entityId: offerId })
}

// Transition an applicant into an employee record (onboarding). When an accepted
// offer exists, its terms (job title, salary, start date, department) flow straight
// in — no manual re-entry (FR-069). Falls back to defaults otherwise.
export async function convertApplicantToEmployee(
	applicantId: string,
	organizationId: string,
	ctx: AuditContext
) {
	const applicant = await db.applicant.findFirst({
		where: { id: applicantId, jobPosting: { organizationId } },
		include: { offer: true }
	})
	if (!applicant) error(404, 'Applicant not found')
	if (applicant.convertedToEmployeeId) error(409, 'Applicant already converted to an employee')

	const offer = applicant.offer?.status === 'ACCEPTED' ? applicant.offer : null

	let departmentId = offer?.departmentId ?? null
	if (!departmentId) {
		const def = await db.department.findFirst({
			where: { organizationId },
			orderBy: { name: 'asc' }
		})
		if (!def) error(400, 'No departments found. Please create a department first.')
		departmentId = def.id
	}

	const tempPassword =
		Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6).toUpperCase()

	const employee = await createEmployee(
		organizationId,
		{
			email: applicant.email,
			password: tempPassword,
			role: 'EMPLOYEE',
			firstName: applicant.firstName,
			lastName: applicant.lastName,
			departmentId,
			jobTitle: offer?.jobTitle ?? 'New Employee',
			employmentType: 'PROBATIONARY',
			startDate: offer?.startDate ?? new Date(),
			basicMonthlySalary: offer ? Number(offer.monthlySalary) : 0,
			contactPhone: applicant.phone ?? undefined
		},
		ctx
	)

	await db.applicant.update({
		where: { id: applicantId },
		data: { convertedToEmployeeId: employee.id, currentStage: 'HIRED' }
	})

	return employee
}
