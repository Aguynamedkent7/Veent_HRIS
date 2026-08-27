import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { Prisma } from '@prisma/client'
import {
	DEFAULT_INTERVAL_MONTHS,
	planReviewsForCycle,
	type CyclePeriod,
	type UnreviewableEmployee
} from '$lib/server/performance/cycle-plan'
import { templateStructureSchema } from '$lib/server/performance/schemas'
import type { AuditContext } from './types'

// ── Review Cycles (org-scoped) ──────────────────────────────────────────────

export async function listReviewCycles(organizationId: string) {
	return db.reviewCycle.findMany({
		where: { organizationId },
		orderBy: { startDate: 'desc' }
	})
}

// ── Performance Reviews (scoped by employee / reviewer) ──────────────────────

// #179: the HR-authored parts of a review (manager comments + overall rating) are confidential
// to the reviewer and HR. The reviewed employee must never receive them, so strip them before a
// review is returned to a subject-only view (their list row or their detail page).
export function redactHrAuthored<
	T extends { managerComments: string | null; overallRating: number | null }
>(review: T): T {
	return { ...review, managerComments: null, overallRating: null }
}

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

// ── Automatic cycle generation (#178) ────────────────────────────────────────

/**
 * The shared read + plan behind `openReviewsForCycle`, `listUnreviewable` and
 * `createCycleAndOpenReviews` — and behind the generator script's `--dry-run` preview, which
 * is why it is exported rather than module-private.
 *
 * `cycleId: null` means "no cycle exists yet" (the generator planning a cycle it is about to
 * create). Nobody can already hold a review in a cycle that does not exist, so the
 * already-reviewed set is empty and the query is skipped entirely. That makes a `--dry-run`
 * preview and the real run the SAME code path, so the preview cannot drift from the truth.
 *
 * ORG SCOPING (#323): employees are scoped on the model's OWN `organizationId` column, never
 * through `user: { organizationId }`. A join through the parent asks a different question and
 * is the repo-wide defect class this feature must not add to.
 *
 * The `templateStructureSchema.safeParse` happens HERE and not in the pure planner, because
 * the parse result is needed for the review's `templateSnapshot` anyway. A template whose
 * stored `structure` no longer parses makes its employees `template-invalid` — they are
 * reported to HR, and every other employee's review is still created.
 */
export async function planCycleRoster(organizationId: string, cycleId: string | null) {
	const [employees, existing] = await Promise.all([
		db.employee.findMany({
			where: { organizationId, employmentStatus: 'ACTIVE' },
			select: {
				id: true,
				reportsToId: true,
				assignedTemplateId: true,
				assignedTemplate: { select: { id: true, name: true, structure: true } }
			}
		}),
		cycleId
			? db.performanceReview.findMany({ where: { cycleId }, select: { employeeId: true } })
			: []
	])

	// One parse per template, not per employee — a 300-person org shares a handful of templates.
	const validById = new Map<string, boolean>()
	for (const e of employees) {
		const t = e.assignedTemplate
		if (!t || validById.has(t.id)) continue
		validById.set(t.id, templateStructureSchema.safeParse(t.structure).success)
	}

	const plan = planReviewsForCycle(
		employees.map((e) => ({
			id: e.id,
			reportsToId: e.reportsToId,
			assignedTemplateId: e.assignedTemplateId,
			templateStructureValid: e.assignedTemplateId ? validById.get(e.assignedTemplateId) : undefined
		})),
		existing.map((r) => r.employeeId)
	)

	const templateById = new Map(
		employees.flatMap((e) =>
			e.assignedTemplate ? [[e.assignedTemplate.id, e.assignedTemplate]] : []
		)
	)
	return { ...plan, templateById }
}

/**
 * The `performanceReview.createMany` rows for a planned roster — shared VERBATIM by
 * `openReviewsForCycle` and `createCycleAndOpenReviews`, because a snapshot written two
 * slightly different ways is a snapshot that disagrees with itself.
 *
 * One `snapshotAt` instant for the whole batch, so every review opened by this run agrees on
 * when it was snapshotted.
 */
function reviewRows(
	cycleId: string,
	toCreate: Awaited<ReturnType<typeof planCycleRoster>>['toCreate'],
	templateById: Awaited<ReturnType<typeof planCycleRoster>>['templateById']
) {
	const snapshotAt = new Date().toISOString()
	return toCreate.map((r) => {
		const t = templateById.get(r.templateId)!
		return {
			cycleId,
			employeeId: r.employeeId,
			reviewerId: r.reviewerId,
			templateId: r.templateId,
			// §4.3 — `structure` copied VERBATIM off the template row. Written inside the caller's
			// transaction and never refreshed: editing the template later must not change what an
			// opened review shows.
			templateSnapshot: {
				version: 1,
				templateId: t.id,
				templateName: t.name,
				snapshotAt,
				structure: t.structure as Prisma.InputJsonValue
			},
			status: 'PENDING' as const
		}
	})
}

/**
 * Open a review for every active employee the cycle can plan one for.
 *
 * Idempotent: an employee already holding a review in this cycle is neither re-created nor
 * reported. Everyone else who gets nothing comes back in `unreviewable` WITH THE REASONS —
 * the old `skipped` count conflated "already had one" with "had no manager", so HR could not
 * tell a healthy re-run from a broken roster.
 *
 * ONE `$transaction` per org: the reviews and the audit row commit or roll back together
 * (#324 — `tx` is passed as `writeAuditLog`'s third argument).
 */
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

	const { toCreate, unreviewable, templateById } = await planCycleRoster(organizationId, cycleId)

	await db.$transaction(async (tx) => {
		if (toCreate.length) {
			await tx.performanceReview.createMany({ data: reviewRows(cycleId, toCreate, templateById) })
		}

		await writeAuditLog(
			ctx,
			{
				action: 'UPDATE',
				entityType: 'ReviewCycle',
				entityId: cycleId,
				newValue: { reviewsOpened: toCreate.length, unreviewable: unreviewable.length }
			},
			tx
		)
	})

	return { opened: toCreate.length, unreviewable }
}

/**
 * Create the next cycle as ACTIVE **and** open its reviews in ONE `$transaction` (plan item 98).
 *
 * WHY THIS EXISTS AT ALL. The generator used to create the cycle, then call
 * `openReviewsForCycle`, which opens its own transaction — a nested transaction runs on a
 * different pooled connection and cannot see the uncommitted cycle, so the two writes could
 * never share one. The script compensated by deleting the cycle again on any throw, which is
 * correct on every *exception* path but not on a hard process kill between the two writes:
 * that left an ACTIVE cycle with zero reviews, and since the manual "Open reviews" button was
 * removed there is no way back from that state. Here the cycle row, every review row and the
 * audit row commit together or not at all, so the orphan is not reachable.
 *
 * P2002 ON THE `@@unique([organizationId, startDate, endDate])` IS DELIBERATELY NOT CAUGHT.
 * A second invocation for the same period is the idempotency guarantee, not a failure, and
 * only the caller knows how to report it — the script prints "already generated — skipped"
 * and carries on. Swallowing it here would hide a real duplicate from every other caller.
 *
 * The roster read happens BEFORE the transaction opens, the same way `openReviewsForCycle`
 * does it: reads do not need to be in the write transaction, and holding one open across them
 * would stretch the transaction window for nothing.
 */
export async function createCycleAndOpenReviews(
	organizationId: string,
	period: CyclePeriod,
	ctx: AuditContext
) {
	// `null` — the cycle does not exist yet, so nobody can already hold a review in it.
	const { toCreate, unreviewable, templateById } = await planCycleRoster(organizationId, null)

	return db.$transaction(async (tx) => {
		const cycle = await tx.reviewCycle.create({
			data: {
				organizationId,
				name: period.name,
				startDate: period.startDate,
				endDate: period.endDate,
				// ACTIVE, not DRAFT: nothing activates a cycle by hand any more — the manual HR cycle
				// UI is gone, so a DRAFT cycle would never be opened by anybody.
				status: 'ACTIVE'
			},
			select: { id: true, name: true }
		})

		if (toCreate.length) {
			await tx.performanceReview.createMany({
				data: reviewRows(cycle.id, toCreate, templateById)
			})
		}

		// #324 — `tx` as the third argument, so the audit row shares the fate of the writes it
		// describes.
		await writeAuditLog(
			ctx,
			{
				action: 'CREATE',
				entityType: 'ReviewCycle',
				entityId: cycle.id,
				newValue: {
					name: period.name,
					startDate: period.startDate,
					endDate: period.endDate,
					status: 'ACTIVE',
					reviewsOpened: toCreate.length
				}
			},
			tx
		)

		return { cycle, opened: toCreate.length, unreviewable }
	})
}

/**
 * Who this cycle could not open a review for, and why.
 *
 * NO TABLE, DELIBERATELY (plan item 95). The list is RECOMPUTED on read by re-running the same
 * pure planner against the current roster and the cycle's existing reviews. A persisted list
 * would go stale the moment HR assigns a template or a manager — it would keep naming people
 * who are fixed. This is one extra query and it is always current. It looks like an omission
 * otherwise, which is why it is written down here.
 */
export async function listUnreviewable(
	cycleId: string,
	organizationId: string
): Promise<UnreviewableEmployee[]> {
	const cycle = await db.reviewCycle.findFirst({
		where: { id: cycleId, organizationId },
		select: { id: true }
	})
	if (!cycle) error(404, 'Review cycle not found')

	const { unreviewable } = await planCycleRoster(organizationId, cycleId)
	return unreviewable
}

// ── Cadence config (#178) ────────────────────────────────────────────────────

export const PERFORMANCE_CONFIG_BOUNDS = {
	intervalMonths: { min: 1, max: 24 },
	dueDays: { min: 1, max: 180 }
} as const

/**
 * The org's cadence settings, or the schema defaults when no row exists.
 *
 * Deliberately NOT written on read, mirroring `getBackupSettings`: the generator cron reads
 * this every night, and a config row created as a side effect of a read would claim an org was
 * configured by someone when nobody had touched it. Only `savePerformanceConfig` creates it.
 */
export async function getPerformanceConfig(organizationId: string) {
	const config = await db.performanceConfig.findUnique({
		where: { organizationId },
		select: { enabled: true, intervalMonths: true, dueDays: true }
	})
	return config ?? { enabled: true, intervalMonths: DEFAULT_INTERVAL_MONTHS, dueDays: 14 }
}

/**
 * Save the cadence settings.
 *
 * The bounds are enforced HERE, not only in the route's zod schema: the service is the last
 * line of defence and a direct caller (a script, the cron, a later route) bypasses the route
 * entirely. An unbounded `intervalMonths` of 0 makes every tick due forever.
 */
export async function savePerformanceConfig(
	organizationId: string,
	data: { enabled: boolean; intervalMonths: number; dueDays: number },
	ctx: AuditContext
) {
	const { intervalMonths, dueDays } = PERFORMANCE_CONFIG_BOUNDS
	if (
		!Number.isInteger(data.intervalMonths) ||
		data.intervalMonths < intervalMonths.min ||
		data.intervalMonths > intervalMonths.max
	) {
		error(
			400,
			`Interval must be a whole number between ${intervalMonths.min} and ${intervalMonths.max} months`
		)
	}
	if (!Number.isInteger(data.dueDays) || data.dueDays < dueDays.min || data.dueDays > dueDays.max) {
		error(400, `Due days must be a whole number between ${dueDays.min} and ${dueDays.max}`)
	}

	// One transaction: a failed audit write must not leave a cadence change standing unrecorded,
	// and reading `before` inside it stops two concurrent saves logging the same oldValue.
	return await db.$transaction(async (tx) => {
		const before = await tx.performanceConfig.findUnique({
			where: { organizationId },
			select: { enabled: true, intervalMonths: true, dueDays: true }
		})
		const config = await tx.performanceConfig.upsert({
			where: { organizationId },
			create: { organizationId, ...data },
			update: data,
			select: { id: true, enabled: true, intervalMonths: true, dueDays: true }
		})
		await writeAuditLog(
			ctx,
			{
				action: 'UPDATE',
				entityType: 'PerformanceConfig',
				entityId: config.id,
				oldValue: before ?? undefined,
				newValue: data
			},
			tx
		)
		return config
	})
}
