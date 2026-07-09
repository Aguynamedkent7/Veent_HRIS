import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import type { AuditContext } from './types'
import type { JobPostingStatus, ApplicantStage } from '@prisma/client'

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
	input: { firstName: string; lastName: string; email: string; phone?: string; coverLetter?: string }
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
