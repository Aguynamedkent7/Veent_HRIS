import { db } from '$lib/server/db'
import { error } from '@sveltejs/kit'
import type { Prisma } from '@prisma/client'

// Workdays (Mon–Fri) between two dates, excluding org holidays. Mirrors the legacy
// leave service so migrated behaviour is unchanged.
export function workdaysBetween(start: Date, end: Date, holidays: Date[]): number {
	let count = 0
	const cur = new Date(start)
	const holidayStrings = new Set(holidays.map((h) => h.toISOString().slice(0, 10)))
	while (cur <= end) {
		const day = cur.getDay()
		const iso = cur.toISOString().slice(0, 10)
		if (day !== 0 && day !== 6 && !holidayStrings.has(iso)) count++
		cur.setDate(cur.getDate() + 1)
	}
	return count
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
export async function assertLeaveBalance(
	employeeId: string,
	leaveTypeId: string,
	year: number,
	totalDays: number
) {
	const balance = await db.leaveBalance.findUnique({
		where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId, year } }
	})
	if (balance && Number(balance.remaining) < totalDays) {
		error(400, `Insufficient leave balance. Available: ${balance.remaining} days`)
	}
}

// Deduct on approval (used += days, remaining -= days). Safe inside a transaction.
export async function deductLeaveBalance(
	tx: Prisma.TransactionClient,
	employeeId: string,
	leaveTypeId: string,
	year: number,
	totalDays: number
) {
	await tx.leaveBalance.updateMany({
		where: { employeeId, leaveTypeId, year },
		data: { used: { increment: totalDays }, remaining: { decrement: totalDays } }
	})
}
