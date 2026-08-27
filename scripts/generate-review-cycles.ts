// Automatic performance review-cycle generation (#178, plan items 98/99). Each organization
// sets its own cadence at Settings → Performance; this entry point only OFFERS every org a
// chance to generate. It creates the next ReviewCycle as ACTIVE, opens a review for every
// active employee that can have one, and notifies each of them.
//
//   pnpm exec dotenv -e .env.dev -- tsx scripts/generate-review-cycles.ts --dry-run
//   pnpm exec dotenv -e .env.dev -- tsx scripts/generate-review-cycles.ts --force
//
// Runs nightly from the droplet crontab (see scripts/README.md) — the app has no scheduler.
//
// A THIN IO SHELL, mirroring scripts/backup-documents.ts. Every scheduling decision belongs
// to the pure planner in src/lib/server/performance/cycle-plan.ts, and every write belongs to
// src/lib/server/services/performance.ts. THERE IS DELIBERATELY NO DATE ARITHMETIC IN THIS
// FILE — no setUTCMonth, no getMonth, no manual day maths. #320 was caused by month logic
// duplicated across files that then disagreed; `isCycleDue` (Manila basis) and
// `nextCyclePeriod` (UTC month-stepping) are the single source of both answers.
//
// THE RULE THIS FILE EXISTS UNDER (plan §0): the app performs NO arithmetic on evaluation
// scores. This script plans and creates. It never computes a subtotal, a total or an average.
//
// NO ADVISORY LOCK, DELIBERATELY (plan item 99): cycle generation fires at most once every
// `intervalMonths` from a single hand-installed crontab line, and the ReviewCycle
// @@unique([organizationId, startDate, endDate]) plus the single $transaction turns any
// genuine overlap into a caught P2002 rather than a duplicate row — a lock would add the
// `withSingleConnection` connection-pinning trap (backup/plan.ts) for a race that cannot
// produce a bad row. (Phase 9's reminder job is a different case and is re-evaluated there.)
//
// Unlike backup-documents.ts, this DOES write an AuditLog row and therefore needs the seeded
// system@veent.ph user — AuditLog.actorId is a non-nullable FK. A cycle appearing in HR's list
// with no actor is unexplainable, whereas a BackupRun row is self-documenting.

import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { db } from '../src/lib/server/db'
import { writeAuditLog } from '../src/lib/server/audit'
import {
	isCycleDue,
	nextCyclePeriod,
	planReviewsForCycle
} from '../src/lib/server/performance/cycle-plan'
import { templateStructureSchema } from '../src/lib/server/performance/schemas'
import { getPerformanceConfig, openReviewsForCycle } from '../src/lib/server/services/performance'
import { notify } from '../src/lib/server/services/notifications'
import type { AuditContext } from '../src/lib/server/services/types'

const SYSTEM_EMAIL = 'system@veent.ph'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')

function isDuplicateCycle(e: unknown): boolean {
	return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

/**
 * What a real run WOULD open, without writing anything.
 *
 * It re-runs the exported pure planner over the org's roster with an empty "already reviewed"
 * set, which is exact: the cycle does not exist yet, so nobody holds a review in it. The
 * service's own `planCycleRoster` is not exported, so the roster query is repeated here; the
 * real run's numbers always come from the service, never from this preview.
 */
async function previewOrg(organizationId: string) {
	const employees = await db.employee.findMany({
		where: { organizationId, employmentStatus: 'ACTIVE' },
		select: {
			id: true,
			reportsToId: true,
			assignedTemplateId: true,
			assignedTemplate: { select: { structure: true } }
		}
	})
	return planReviewsForCycle(
		employees.map((e) => ({
			id: e.id,
			reportsToId: e.reportsToId,
			assignedTemplateId: e.assignedTemplateId,
			templateStructureValid: e.assignedTemplate
				? templateStructureSchema.safeParse(e.assignedTemplate.structure).success
				: undefined
		})),
		[]
	)
}

async function main() {
	const systemUser = await db.user.findUnique({
		where: { email: SYSTEM_EMAIL },
		select: { id: true, roles: true }
	})
	if (!systemUser) {
		console.error(
			`No ${SYSTEM_EMAIL} user found — the audit trail needs it. Run \`pnpm db:seed\` first.`
		)
		process.exit(1)
	}

	// ONE instant for the whole sweep, so every org is asked the same "is it due?" question
	// even if the run takes minutes.
	const now = new Date()
	let failures = 0

	const orgs = await db.organization.findMany({
		select: { id: true, name: true },
		orderBy: { id: 'asc' }
	})

	for (const org of orgs) {
		try {
			// No row means never configured. `getPerformanceConfig` returns the defaults and
			// creates nothing — only the settings page writes a config row.
			const config = await getPerformanceConfig(org.id)
			if (!config.enabled) {
				console.log(`  org ${org.id}: review cycles not enabled — skipped`)
				continue
			}

			// Measured from the last cycle's END: a period can only be evaluated once it closed.
			const last = await db.reviewCycle.findFirst({
				where: { organizationId: org.id },
				orderBy: { endDate: 'desc' },
				select: { endDate: true }
			})
			const lastCycleEnd = last?.endDate ?? null

			if (!force && !isCycleDue(config, lastCycleEnd, now)) {
				console.log(`  org ${org.id}: not due`)
				continue
			}

			const period = nextCyclePeriod(lastCycleEnd, config.intervalMonths, now)

			if (dryRun) {
				const { toCreate, unreviewable } = await previewOrg(org.id)
				console.log(
					`  org ${org.id}: DRY RUN — would create cycle "${period.name}" ` +
						`(${period.startDate.toISOString().slice(0, 10)} – ${period.endDate.toISOString().slice(0, 10)}) ` +
						`and open ${toCreate.length} review(s); ${unreviewable.length} employee(s) unreviewable`
				)
				for (const u of unreviewable) {
					console.log(`      ${u.employeeId}: ${u.reasons.join(', ')}`)
				}
				continue
			}

			let cycleId: string
			try {
				const cycle = await db.reviewCycle.create({
					data: {
						organizationId: org.id,
						name: period.name,
						startDate: period.startDate,
						endDate: period.endDate,
						// ACTIVE, not DRAFT: nothing activates a cycle by hand any more — the manual HR
						// cycle UI is gone, so a DRAFT cycle would never be opened by anybody.
						status: 'ACTIVE'
					},
					select: { id: true }
				})
				cycleId = cycle.id
			} catch (e) {
				// The @@unique doing its job: a second invocation for the same period is not an
				// error, it is the idempotency guarantee.
				if (isDuplicateCycle(e)) {
					console.log(`  org ${org.id}: cycle "${period.name}" already generated — skipped`)
					continue
				}
				throw e
			}

			const ctx: AuditContext = {
				organizationId: org.id,
				actorId: systemUser.id,
				actorRoles: systemUser.roles
			}

			let opened: Awaited<ReturnType<typeof openReviewsForCycle>>
			try {
				// The reviews and their audit row commit together inside the service's own
				// $transaction. The cycle row itself cannot join that transaction without a service
				// change (`openReviewsForCycle` takes a cycleId and opens its own tx), so the cycle
				// is removed again if opening fails — an ACTIVE cycle with zero reviews would be
				// unrecoverable, because no UI opens reviews by hand any more. No audit row has
				// been written at this point, so nothing dangles.
				opened = await openReviewsForCycle(cycleId, org.id, ctx)
			} catch (e) {
				await db.reviewCycle.delete({ where: { id: cycleId } })
				throw e
			}

			await writeAuditLog(ctx, {
				action: 'CREATE',
				entityType: 'ReviewCycle',
				entityId: cycleId,
				newValue: {
					name: period.name,
					startDate: period.startDate,
					endDate: period.endDate,
					status: 'ACTIVE',
					reviewsOpened: opened.opened
				}
			})

			// Every review in a cycle created moments ago is new, so this notifies exactly the
			// employees this run affected and nobody twice.
			const reviews = await db.performanceReview.findMany({
				where: { cycleId },
				select: { id: true, employee: { select: { userId: true } } }
			})
			for (const review of reviews) {
				await notify(
					review.employee.userId,
					`Your performance review for ${period.name} is open.`,
					`/performance/reviews/${review.id}`,
					'PERFORMANCE'
				)
			}

			console.log(
				`  org ${org.id}: created cycle "${period.name}" — ${opened.opened} review(s) opened, ` +
					`${opened.unreviewable.length} employee(s) unreviewable`
			)
			for (const u of opened.unreviewable) {
				console.log(`      ${u.employeeId}: ${u.reasons.join(', ')}`)
			}
		} catch (e) {
			// Per-org try/catch: one org must never abort the sweep.
			console.error(`  org ${org.id}: ${(e as Error).message}`)
			failures++
		}
	}

	if (failures > 0) {
		console.error(`\n${failures} organization(s) failed.`)
		process.exit(1)
	}
	console.log('\nDone.')
}

main()
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
	.finally(() => db.$disconnect())
