// Automatic regularization (#136). PH probation caps at 6 months; this flips ACTIVE
// PROBATIONARY employees to FULL_TIME once 6 whole calendar months of service have
// elapsed, and notifies that org's HR.
//
//   pnpm tsx scripts/promote-probationary.ts --dry-run   # list who would be promoted
//   pnpm tsx scripts/promote-probationary.ts             # promote + notify
//
// Runs nightly from the droplet crontab (see scripts/README.md) — it is NOT scheduled
// from inside the app, which has no scheduler.
//
// Two deliberate choices:
//   • It delegates to updateEmployee() rather than writing the row itself, so the audit
//     entry is byte-identical to a manual HR edit and therefore renders correctly in the
//     201 file's Employment History timeline. Hand-rolling the write (as offboardEmployee
//     does) omits oldValue and the timeline degrades to "— → FULL TIME".
//   • It runs as the seeded system@veent.ph user. AuditLog.actorId is a non-nullable FK to
//     User, so an automated actor is not optional — see seedProd in prisma/seed-core.ts.
//
// Idempotent: the query only matches PROBATIONARY, so a second run in the same night is a
// no-op.

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { updateEmployee } from '../src/lib/server/services/employees'
import { notifyMany } from '../src/lib/server/services/notifications'
import { monthsOfService, tenureLabel } from '../src/lib/utils/dates'

const PROBATION_MONTHS = 6
const SYSTEM_EMAIL = 'system@veent.ph'

const dryRun = process.argv.slice(2).includes('--dry-run')
const db = new PrismaClient()

async function main() {
	const systemUser = await db.user.findUnique({
		where: { email: SYSTEM_EMAIL },
		select: { id: true, role: true }
	})
	if (!systemUser) {
		console.error(
			`No ${SYSTEM_EMAIL} user found — the audit trail needs it. Run \`pnpm db:seed\` first.`
		)
		process.exit(1)
	}

	// Small set, so the calendar-month test runs in JS rather than as SQL date arithmetic —
	// it must use the exact same helper as the tenure shown in the UI, or an employee reading
	// "5 months" could be promoted.
	const probationary = await db.employee.findMany({
		where: { employmentType: 'PROBATIONARY', employmentStatus: 'ACTIVE' },
		select: {
			id: true,
			organizationId: true,
			employeeNumber: true,
			firstName: true,
			lastName: true,
			startDate: true
		},
		orderBy: [{ organizationId: 'asc' }, { employeeNumber: 'asc' }]
	})

	const due = probationary.filter((e) => monthsOfService(e.startDate) >= PROBATION_MONTHS)

	if (due.length === 0) {
		console.log(`Nothing to regularize (${probationary.length} probationary employee(s) checked).`)
		return
	}

	console.log(
		`${due.length} of ${probationary.length} probationary employee(s) reached ${PROBATION_MONTHS} months:`
	)
	for (const e of due) {
		console.log(
			`  ${e.employeeNumber}  ${e.lastName}, ${e.firstName}  (${tenureLabel(e.startDate)})`
		)
	}
	if (dryRun) {
		console.log('\nDry run — nothing written.')
		return
	}

	// Group by org: HR is notified per tenant, and the audit ctx is org-scoped.
	const byOrg = new Map<string, typeof due>()
	for (const e of due) {
		const list = byOrg.get(e.organizationId) ?? []
		list.push(e)
		byOrg.set(e.organizationId, list)
	}

	let promoted = 0
	for (const [organizationId, employees] of byOrg) {
		const ctx = {
			organizationId,
			actorId: systemUser.id,
			actorRole: systemUser.role
		}

		const done: typeof employees = []
		for (const e of employees) {
			try {
				await updateEmployee(e.id, organizationId, { employmentType: 'FULL_TIME' }, ctx)
				done.push(e)
				promoted++
			} catch (err) {
				// One bad row must not abort the whole sweep.
				console.error(`  ! ${e.employeeNumber} ${e.lastName}: ${(err as Error).message}`)
			}
		}
		if (done.length === 0) continue

		// Notify that org's HR so a status change nobody clicked is still visible to a human.
		const hr = await db.user.findMany({
			where: { organizationId, isActive: true, role: { in: ['HR_ADMIN', 'SUPER_ADMIN'] } },
			select: { id: true }
		})
		if (hr.length === 0) {
			console.warn(`  (org ${organizationId}: no active HR to notify)`)
			continue
		}
		for (const e of done) {
			await notifyMany(
				hr.map((u) => u.id),
				`${e.firstName} ${e.lastName} completed ${PROBATION_MONTHS} months and was regularized to Full Time.`,
				`/employees/${e.id}`
			)
		}
		console.log(`  org ${organizationId}: ${done.length} promoted, ${hr.length} HR notified`)
	}

	console.log(`\nRegularized ${promoted} employee(s).`)
}

main()
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
	.finally(() => db.$disconnect())
