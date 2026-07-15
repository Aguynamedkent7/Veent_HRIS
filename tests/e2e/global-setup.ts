import { PrismaClient } from '@prisma/client'

/**
 * Resets the seeded employee's transactional data before the E2E run so tests
 * that create a current-week timesheet / leave request are deterministic across
 * repeated runs. Relies on the seed having been applied (`pnpm db:seed`).
 */
async function globalSetup() {
	const db = new PrismaClient()
	try {
		const employee = await db.employee.findFirst({
			where: { user: { email: 'employee@veent.ph' } },
			select: { id: true }
		})

		if (!employee) {
			throw new Error(
				'E2E seed missing: employee@veent.ph not found. Run `pnpm db:seed` before the E2E suite.'
			)
		}

		await db.timesheetEntry.deleteMany({ where: { timesheet: { employeeId: employee.id } } })
		await db.timesheet.deleteMany({ where: { employeeId: employee.id } })
		await db.leaveRequest.deleteMany({ where: { employeeId: employee.id } })
		// Leave now flows through the unified Request model; reset it too (steps/documents
		// cascade) so leave-filing tests stay deterministic across repeated runs.
		await db.request.deleteMany({ where: { employeeId: employee.id } })

		// Restore full leave balances (approved requests in prior runs decrement them).
		const balances = await db.leaveBalance.findMany({ where: { employeeId: employee.id } })
		for (const b of balances) {
			await db.leaveBalance.update({
				where: { id: b.id },
				data: { used: 0, remaining: b.allocated }
			})
		}
	} finally {
		await db.$disconnect()
	}
}

export default globalSetup
