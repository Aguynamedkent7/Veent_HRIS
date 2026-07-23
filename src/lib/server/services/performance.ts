import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { AuditContext } from './types'

// ── Review cadence (#178) ────────────────────────────────────────────────────
// Performance evaluations run every 2 months, anchored to fixed calendar bi-months
// (Jan–Feb, Mar–Apr, … Nov–Dec) so the cadence is predictable no matter when a cycle is
// actually opened. The helper below suggests the next cycle HR should open and whether the
// current period is already overdue for one — pure, so it is unit-tested directly.

export const REVIEW_CADENCE_MONTHS = 2

const MONTHS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
]

// The calendar bi-month window (start, inclusive end) for pair 0–5 of `year`.
function biMonthWindow(year: number, pair: number) {
	const startMonth = pair * 2
	return {
		start: new Date(Date.UTC(year, startMonth, 1)),
		end: new Date(Date.UTC(year, startMonth + 2, 0)) // day 0 of the next month = last day
	}
}

export interface CycleSuggestion {
	name: string
	startDate: Date
	endDate: Date
	/** True when the current bi-month period has no cycle yet — HR is due to open one. */
	due: boolean
}

/**
 * The next evaluation cycle HR should open, given the most recent cycle's start date (or
 * null when there are none). Suggests the current bi-month period when it isn't covered
 * yet (`due: true`), otherwise the period after the latest cycle.
 */
export function suggestNextReviewCycle(
	latestCycleStart: Date | null,
	asOf: Date = new Date()
): CycleSuggestion {
	const curYear = asOf.getUTCFullYear()
	const curPair = Math.floor(asOf.getUTCMonth() / 2)

	let year = curYear
	let pair = curPair
	let due = true

	if (latestCycleStart) {
		const lYear = latestCycleStart.getUTCFullYear()
		const lPair = Math.floor(latestCycleStart.getUTCMonth() / 2)
		const coversCurrent = lYear > curYear || (lYear === curYear && lPair >= curPair)
		if (coversCurrent) {
			// The current period already has a cycle — suggest the one after the latest.
			year = lYear
			pair = lPair + 1
			if (pair > 5) {
				pair = 0
				year += 1
			}
			due = false
		}
	}

	const { start, end } = biMonthWindow(year, pair)
	return {
		name: `${MONTHS[pair * 2]}–${MONTHS[pair * 2 + 1]} ${year}`,
		startDate: start,
		endDate: end,
		due
	}
}

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
		newValue: {
			status: updated.status,
			overallRating: updated.overallRating,
			completedAt: updated.completedAt
		}
	})

	return updated
}

// Employee acknowledges a completed review (final step of the cycle).
export async function acknowledgeReview(id: string, employeeId: string, ctx: AuditContext) {
	const review = await db.performanceReview.findUnique({ where: { id } })
	if (!review) error(404, 'Performance review not found')
	if (review.employeeId !== employeeId) error(409, 'Only the review subject can acknowledge')
	if (review.status !== 'COMPLETED') error(400, 'Only a completed review can be acknowledged')

	const updated = await db.performanceReview.update({
		where: { id },
		data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() }
	})
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'PerformanceReview',
		entityId: id,
		newValue: { status: 'ACKNOWLEDGED' }
	})
	return updated
}

// ── Cycle lifecycle (HR) ─────────────────────────────────────────────────────

export async function updateReviewCycleStatus(
	id: string,
	organizationId: string,
	status: 'DRAFT' | 'ACTIVE' | 'CLOSED',
	ctx: AuditContext
) {
	const cycle = await db.reviewCycle.findFirst({
		where: { id, organizationId },
		select: { id: true }
	})
	if (!cycle) error(404, 'Review cycle not found')
	const updated = await db.reviewCycle.update({ where: { id }, data: { status } })
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'ReviewCycle',
		entityId: id,
		newValue: { status }
	})
	return updated
}

// Open a review for every active employee who has a manager (reviewer = reportsTo).
// Idempotent: skips employees already having a review in this cycle.
export async function openReviewsForCycle(
	cycleId: string,
	organizationId: string,
	ctx: AuditContext
) {
	const cycle = await db.reviewCycle.findFirst({
		where: { id: cycleId, organizationId },
		select: { id: true }
	})
	if (!cycle) error(404, 'Review cycle not found')

	const employees = await db.employee.findMany({
		where: { user: { organizationId }, employmentStatus: 'ACTIVE', reportsToId: { not: null } },
		select: { id: true, reportsToId: true }
	})
	const existing = await db.performanceReview.findMany({
		where: { cycleId },
		select: { employeeId: true }
	})
	const seen = new Set(existing.map((r) => r.employeeId))

	const toCreate = employees
		.filter((e) => !seen.has(e.id))
		.map((e) => ({
			cycleId,
			employeeId: e.id,
			reviewerId: e.reportsToId!,
			status: 'PENDING' as const
		}))

	if (toCreate.length) await db.performanceReview.createMany({ data: toCreate })
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'ReviewCycle',
		entityId: cycleId,
		newValue: { reviewsOpened: toCreate.length }
	})
	return { opened: toCreate.length, skipped: employees.length - toCreate.length }
}

// ── Goals (scoped by owning employee) ────────────────────────────────────────

// Goals of a manager's direct reports (T154).
export async function listGoalsForManager(managerEmployeeId: string) {
	return db.goal.findMany({
		where: { employee: { reportsToId: managerEmployeeId } },
		include: { employee: { select: { firstName: true, lastName: true } } },
		orderBy: [{ status: 'asc' }, { createdAt: 'desc' }]
	})
}

export async function listGoalsForEmployee(employeeId: string) {
	return db.goal.findMany({
		where: { employeeId },
		orderBy: { createdAt: 'desc' }
	})
}

export async function createGoal(
	employeeId: string,
	data: {
		title: string
		description?: string
		category?: string
		cycleId?: string
		targetDate?: Date
	},
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
