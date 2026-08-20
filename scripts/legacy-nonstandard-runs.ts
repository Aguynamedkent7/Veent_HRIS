// #163 pre-flight (throwaway, READ-ONLY). Lists every DRAFT/COMPUTED PayrollRun whose
// (periodStart, periodEnd) is not one of the three standard shapes. Those runs currently take
// the flat 0.5 share; after #163 they recompute on day-count, so their numbers WILL move.
// LOCKED/RELEASED/VOIDED runs never recompute, so they are not listed.
//
//   pnpm dotenv -e .env.dev -- tsx scripts/legacy-nonstandard-runs.ts
//
// Run this against EVERY database this change reaches (dev, staging, prod) — a clean dev
// result proves nothing about the others (S9).

import { PrismaClient } from '@prisma/client'
import { isValidStandardPeriod, describePeriod } from '../src/lib/utils/pay-periods'

const db = new PrismaClient()

async function main() {
	const runs = await db.payrollRun.findMany({
		where: { status: { in: ['DRAFT', 'COMPUTED'] } },
		select: {
			id: true,
			organizationId: true,
			status: true,
			periodStart: true,
			periodEnd: true,
			totalNet: true
		},
		orderBy: { periodStart: 'asc' }
	})

	const legacy = runs.filter((r) => !isValidStandardPeriod(r.periodStart, r.periodEnd))

	console.log(`Scanned ${runs.length} DRAFT/COMPUTED payroll run(s).`)
	if (legacy.length === 0) {
		console.log('No legacy exposure: 0 non-standard recomputable runs.')
		return
	}
	console.log(`${legacy.length} non-standard recomputable run(s) — numbers will move on recompute:`)
	for (const r of legacy) {
		console.log(
			`  ${r.id}  org=${r.organizationId}  ${r.status}  ` +
				`${r.periodStart.toISOString()} → ${r.periodEnd.toISOString()}  ` +
				`(${describePeriod(r.periodStart, r.periodEnd).label})  totalNet=${r.totalNet}`
		)
	}
}

main()
	.catch((e) => {
		console.error(e)
		process.exitCode = 1
	})
	.finally(() => db.$disconnect())
