import { db } from '$lib/server/db'
import { error } from '@sveltejs/kit'
import type { Prisma } from '@prisma/client'
import { computeWorkingDays } from '$lib/utils/dates'

// Workdays (Mon–Fri) between two dates, excluding org holidays. Delegates to the shared
// PHT-correct counter so leave day-math agrees with payroll/attendance on any server
// timezone (#105) — the previous local-getDay + UTC-slice mix shifted boundary dates.
export function workdaysBetween(start: Date, end: Date, holidays: Date[]): number {
	return computeWorkingDays(start, end, holidays)
}

export async function computeLeaveTotalDays(
	organizationId: string,
	startDate: Date,
	endDate: Date
): Promise<number> {
	const holidays = await db.publicHoliday.findMany({
		where: { organizationId, date: { gte: startDate, lte: endDate } },
		select: { date: true }
	})
	return workdaysBetween(
		startDate,
		endDate,
		holidays.map((h) => h.date)
	)
}

// Throw if the employee lacks the balance to cover `totalDays` for the leave type.
// A missing balance row is itself a failure (#105): the old `if (balance && …)` guard
// treated "no row" as unlimited, so the request was filed and later approved with no
// ledger to deduct against. Treat absent as zero available and block up front.
export async function assertLeaveBalance(
	employeeId: string,
	leaveTypeId: string,
	year: number,
	totalDays: number
) {
	const balance = await db.leaveBalance.findUnique({
		where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } }
	})
	if (!balance) {
		error(400, 'No leave balance on record for this leave type. Contact HR to set your allocation.')
	}
	if (Number(balance.remaining) < totalDays) {
		error(400, `Insufficient leave balance. Available: ${balance.remaining} days`)
	}
}

// Deduct on approval (used += days, remaining -= days). Must run inside the approval
// transaction so a failure rolls the whole approval back (#101). The `remaining >= days`
// guard in the WHERE makes the decrement conditional and atomic (#105): a race or a
// second close approval can no longer drive `remaining` negative, and a missing/short
// row updates nothing — surfaced as an error so the caller aborts rather than marking a
// request approved with no ledger entry.
export async function deductLeaveBalance(
	tx: Prisma.TransactionClient,
	employeeId: string,
	leaveTypeId: string,
	year: number,
	totalDays: number
) {
	const { count } = await tx.leaveBalance.updateMany({
		where: { employeeId, leaveTypeId, year, remaining: { gte: totalDays } },
		data: { used: { increment: totalDays }, remaining: { decrement: totalDays } }
	})
	if (count === 0) {
		error(409, 'Leave balance is insufficient or missing; cannot deduct.')
	}
}
