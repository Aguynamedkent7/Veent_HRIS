import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { AuditContext } from './types'

// ── Review Cycles (org-scoped) ──────────────────────────────────────────────

export async function listReviewCycles(organizationId: string) {
	return db.reviewCycle.findMany({
		where: { organizationId },
		orderBy: { startDate: 'desc' }
	})
}

export async function createReviewCycle(
	organizationId: string,
	data: { name: string; startDate: Date; endDate: Date },
	ctx: AuditContext
) {
	const cycle = await db.reviewCycle.create({
		data: {
			organizationId,
			name: data.name,
			startDate: data.startDate,
			endDate: data.endDate
		}
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'ReviewCycle',
		entityId: cycle.id,
		newValue: { name: cycle.name, startDate: cycle.startDate, endDate: cycle.endDate }
	})

	return cycle
}

// ── Performance Reviews (scoped by employee / reviewer) ──────────────────────

export async function listReviewsForEmployee(employeeId: string) {
	return db.performanceReview.findMany({
		where: { employeeId },
		include: {
			cycle: { select: { id: true, name: true, status: true } },
			reviewer: { select: { id: true, firstName: true, lastName: true } }
		},
		orderBy: { createdAt: 'desc' }
	})
}

export async function listReviewsForReviewer(reviewerId: string) {
	return db.performanceReview.findMany({
		where: { reviewerId },
		include: {
			cycle: { select: { id: true, name: true, status: true } },
			employee: { select: { id: true, firstName: true, lastName: true } }
		},
		orderBy: { createdAt: 'desc' }
	})
}

export async function getReview(id: string, organizationId: string) {
	const review = await db.performanceReview.findFirst({
		where: { id, cycle: { organizationId } },
		include: {
			cycle: { select: { id: true, name: true, status: true } },
			employee: { select: { id: true, firstName: true, lastName: true } },
			reviewer: { select: { id: true, firstName: true, lastName: true } }
		}
	})
	if (!review) error(404, 'Performance review not found')
	return review
}

export async function saveSelfAssessment(
	id: string,
	employeeId: string,
	text: string,
	ctx: AuditContext
) {
	const review = await db.performanceReview.findUnique({ where: { id } })
	if (!review) error(404, 'Performance review not found')
	if (review.employeeId !== employeeId) {
		error(409, 'Only the review subject can submit a self-assessment')
	}

	const updated = await db.performanceReview.update({
		where: { id },
		data: {
			selfAssessment: text,
			status: 'SELF_ASSESSMENT',
			submittedAt: new Date()
		}
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'PerformanceReview',
		entityId: id,
		newValue: { status: updated.status, submittedAt: updated.submittedAt }
	})

	return updated
}

export async function submitManagerReview(
	id: string,
	reviewerId: string,
	data: { managerComments?: string; overallRating?: number },
	ctx: AuditContext
) {
	const review = await db.performanceReview.findUnique({ where: { id } })
	if (!review) error(404, 'Performance review not found')
	if (review.reviewerId !== reviewerId) {
		error(409, 'Only the assigned reviewer can submit a manager review')
	}

	const updated = await db.performanceReview.update({
		where: { id },
		data: {
			managerComments: data.managerComments,
			overallRating: data.overallRating,
			status: 'COMPLETED',
			completedAt: new Date()
		}
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'PerformanceReview',
		entityId: id,
		newValue: { status: updated.status, overallRating: updated.overallRating, completedAt: updated.completedAt }
	})

	return updated
}

// ── Goals (scoped by owning employee) ────────────────────────────────────────

export async function listGoalsForEmployee(employeeId: string) {
	return db.goal.findMany({
		where: { employeeId },
		orderBy: { createdAt: 'desc' }
	})
}

export async function createGoal(
	employeeId: string,
	data: { title: string; description?: string; category?: string; cycleId?: string; targetDate?: Date },
	ctx: AuditContext
) {
	const goal = await db.goal.create({
		data: {
			employeeId,
			title: data.title,
			description: data.description,
			category: data.category,
			cycleId: data.cycleId,
			targetDate: data.targetDate
		}
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'Goal',
		entityId: goal.id,
		newValue: { title: goal.title, category: goal.category, targetDate: goal.targetDate }
	})

	return goal
}

export async function updateGoalProgress(
	id: string,
	employeeId: string,
	data: { progress: number; status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' },
	ctx: AuditContext
) {
	const goal = await db.goal.findUnique({ where: { id } })
	if (!goal) error(404, 'Goal not found')
	if (goal.employeeId !== employeeId) {
		error(409, 'You can only update your own goals')
	}
	if (data.progress < 0 || data.progress > 100) {
		error(409, 'Progress must be between 0 and 100')
	}

	const updated = await db.goal.update({
		where: { id },
		data: { progress: data.progress, status: data.status }
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Goal',
		entityId: id,
		newValue: { progress: updated.progress, status: updated.status }
	})

	return updated
}
