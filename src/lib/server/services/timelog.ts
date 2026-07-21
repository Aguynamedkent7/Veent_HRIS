import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import type { PunchType, PunchSource } from '@prisma/client'
import {
	manilaDayKey,
	manilaDayStart,
	manilaDateTime,
	manilaWeekStart,
	manilaWeekEnd
} from '$lib/utils/dates'
import type { AuditContext } from './types'

function round2(n: number): number {
	return Math.round(n * 100) / 100
}

// ─── Raw punches ─────────────────────────────────────────────────────────────

/**
 * Record a single IN/OUT punch for the employee linked to `discordId`.
 * Called from the (unauthenticated, HMAC-verified) /api/v1/timesheets/log endpoint,
 * so it derives its own audit context from the resolved employee.
 */
export async function recordPunch(
	input: {
		discordId: string
		punchType: 'IN' | 'OUT'
		timestamp: Date
		discordMessageId?: string
		source?: PunchSource
	},
	meta?: { ipAddress?: string }
) {
	const employee = await db.employee.findUnique({
		where: { discordId: input.discordId },
		include: { user: { select: { id: true, role: true, isActive: true } } }
	})

	if (!employee || !employee.user.isActive || employee.employmentStatus !== 'ACTIVE') {
		error(404, 'No active employee is linked to this Discord account')
	}

	// The most recent punch — reported back so the caller can tell the user their new state.
	const previous = await db.timeLog.findFirst({
		where: { employeeId: employee.id },
		orderBy: { timestamp: 'desc' },
		select: { punchType: true }
	})

	const resolvedType: PunchType = input.punchType

	// #99: the HMAC window is ±5 minutes, so a captured valid request can be
	// replayed inside it. `discordMessageId` is the idempotency key — one Discord
	// message may produce exactly one punch. Checked here for a clean 409, and
	// again via the unique constraint below, which is what actually closes the
	// race between two concurrent replays (and holds if this check is skipped).
	if (input.discordMessageId) {
		const duplicate = await db.timeLog.findFirst({
			where: { employeeId: employee.id, discordMessageId: input.discordMessageId },
			select: { id: true }
		})
		if (duplicate) error(409, 'This punch has already been recorded')
	}

	let timeLog
	try {
		timeLog = await db.timeLog.create({
			data: {
				employeeId: employee.id,
				punchType: resolvedType,
				source: input.source ?? 'DISCORD',
				timestamp: input.timestamp,
				discordMessageId: input.discordMessageId
			}
		})
	} catch (e) {
		// P2002 = unique violation on (discordMessageId, employeeId): a replay that
		// raced past the check above. Same outcome, no duplicate punch written.
		if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
			error(409, 'This punch has already been recorded')
		}
		throw e
	}

	await writeAuditLog(
		{
			organizationId: employee.organizationId,
			actorId: employee.user.id,
			actorRole: employee.user.role,
			ipAddress: meta?.ipAddress
		},
		{
			action: 'CREATE',
			entityType: 'TimeLog',
			entityId: timeLog.id,
			newValue: { punchType: resolvedType, timestamp: input.timestamp.toISOString() }
		}
	)

	return {
		timeLog,
		employee: { id: employee.id, firstName: employee.firstName, lastName: employee.lastName },
		punchType: resolvedType,
		previousType: previous?.punchType ?? null
	}
}

/** List an employee's raw punches within an optional [from, to] window. */
export async function listPunches(employeeId: string, range?: { from?: Date; to?: Date }) {
	return db.timeLog.findMany({
		where: {
			employeeId,
			...(range?.from || range?.to
				? {
						timestamp: {
							...(range.from && { gte: range.from }),
							...(range.to && { lte: range.to })
						}
					}
				: {})
		},
		orderBy: { timestamp: 'asc' }
	})
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

export interface PunchLite {
	punchType: PunchType
	timestamp: Date
}

export interface DailyAggregate {
	/**
	 * PHT day key (YYYY-MM-DD) → total worked hours (less the unpaid lunch).
	 * Overnight shifts count toward the IN day.
	 */
	hoursByDay: Record<string, number>
	/** PHT day key → the overtime portion of `hoursByDay` (time outside 08:00–17:00 PHT). */
	otByDay: Record<string, number>
	warnings: string[]
}

// Regular window is 08:00–17:00 PHT; the 12:00–13:00 lunch inside it is unpaid.
const REG_START_H = 8
const REG_END_H = 17
const LUNCH_START_H = 12
const LUNCH_END_H = 13

// A single IN/OUT pair longer than this is almost certainly a forgotten clock-out (a
// dangling IN paired with a far-later OUT); it's warned and skipped rather than counted.
// This also keeps a day's total within the entry's Decimal(4,2) column (max 99.99).
const MAX_SHIFT_HOURS = 24

/**
 * Milliseconds of [inTime, outTime] overlapping the [startH, endH] PHT window on EVERY PHT
 * day the shift touches. Iterating per day (each a fixed 24h — PHT has no DST) means an
 * overnight shift keeps the next day's regular/lunch time instead of counting it all as OT.
 */
function windowOverlapMs(inTime: Date, outTime: Date, startH: number, endH: number): number {
	const inMs = inTime.getTime()
	const outMs = outTime.getTime()
	let total = 0
	for (
		let dayStart = manilaDayStart(inTime).getTime();
		dayStart + startH * 3_600_000 < outMs;
		dayStart += 24 * 3_600_000
	) {
		const winStart = dayStart + startH * 3_600_000
		const winEnd = dayStart + endH * 3_600_000
		total += Math.max(0, Math.min(outMs, winEnd) - Math.max(inMs, winStart))
	}
	return total
}

/**
 * Pure IN/OUT → daily-hours reducer (no DB). Punches are paired sequentially so
 * overnight shifts, multiple pairs per day, missing OUTs, and stray OUTs are all handled.
 * Each shift is split like the timesheet modal's In/Out rule: regular = time inside the
 * 08:00–17:00 PHT window less the unpaid 12:00–13:00 lunch; overtime = time outside that
 * window. `hoursByDay` is the paid total (regular + OT); `otByDay` is its OT portion.
 * Exported for unit testing.
 */
export function pairPunchesToDailyHours(punches: PunchLite[]): DailyAggregate {
	const sorted = [...punches].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
	const hoursByDay: Record<string, number> = {}
	const otByDay: Record<string, number> = {}
	const warnings: string[] = []
	let openIn: Date | null = null

	for (const p of sorted) {
		if (p.punchType === 'IN') {
			if (openIn) warnings.push(`Missing OUT for IN punch at ${manilaDateTime(openIn)}`)
			openIn = p.timestamp
		} else {
			if (!openIn) {
				warnings.push(`OUT punch without a matching IN at ${manilaDateTime(p.timestamp)}`)
				continue
			}
			const grossMs = p.timestamp.getTime() - openIn.getTime()
			if (grossMs > MAX_SHIFT_HOURS * 3_600_000) {
				warnings.push(
					`Shift over ${MAX_SHIFT_HOURS}h (${manilaDateTime(openIn)} → ${manilaDateTime(p.timestamp)}) — likely a missing OUT; not counted`
				)
				openIn = null
				continue
			}
			const lunchMs = windowOverlapMs(openIn, p.timestamp, LUNCH_START_H, LUNCH_END_H)
			const regWindowMs = windowOverlapMs(openIn, p.timestamp, REG_START_H, REG_END_H)
			const paidHours = (grossMs - lunchMs) / 3_600_000 // regular + OT
			const otHours = (grossMs - regWindowMs) / 3_600_000 // time outside the regular window
			const day = manilaDayKey(openIn) // attribute the shift to the day it started (PHT)
			hoursByDay[day] = round2((hoursByDay[day] ?? 0) + paidHours)
			otByDay[day] = round2((otByDay[day] ?? 0) + otHours)
			openIn = null
		}
	}

	if (openIn) warnings.push(`Missing OUT for IN punch at ${manilaDateTime(openIn)}`)
	return { hoursByDay, otByDay, warnings }
}

/**
 * Non-destructive preview of a week's aggregation: resolve the PHT week, fetch its raw
 * punches, and reduce them to per-PHT-day hours + warnings. No DB writes, no audit — this
 * powers the HR review UI before it commits an aggregation. `aggregateTimeLogsToTimesheet`
 * reuses this so the preview and the commit can never drift.
 */
export async function previewTimeLogAggregation(employeeId: string, weekOf: Date) {
	const periodStart = manilaWeekStart(weekOf)
	const periodEnd = manilaWeekEnd(weekOf)

	// Only IN/OUT drive the day pairing. BREAK punches aren't part of this workflow (the fixed
	// lunch deduction covers breaks); filter them out so a stray one can't corrupt the pairing.
	const punches = await db.timeLog.findMany({
		where: {
			employeeId,
			timestamp: { gte: periodStart, lte: periodEnd },
			punchType: { in: ['IN', 'OUT'] }
		},
		orderBy: { timestamp: 'asc' },
		select: { punchType: true, timestamp: true }
	})

	const { hoursByDay, otByDay, warnings } = pairPunchesToDailyHours(punches)
	const totalHours = round2(Object.values(hoursByDay).reduce((s, h) => s + h, 0))
	const totalOt = round2(Object.values(otByDay).reduce((s, h) => s + h, 0))

	return { periodStart, periodEnd, hoursByDay, otByDay, totalHours, totalOt, warnings }
}

/**
 * Roll a week of raw punches into a DRAFT weekly Timesheet + one TimesheetEntry per
 * worked PHT day, and link the source punches to it. Idempotent: re-running refreshes
 * a DRAFT timesheet; refuses to touch a SUBMITTED/APPROVED one. Approval reuses the
 * existing timesheet review flow, so this feeds payroll unchanged.
 */
export async function aggregateTimeLogsToTimesheet(
	employeeId: string,
	weekOf: Date,
	ctx: AuditContext
) {
	const { periodStart, periodEnd, hoursByDay, otByDay, totalHours, warnings } =
		await previewTimeLogAggregation(employeeId, weekOf)

	const existing = await db.timesheet.findUnique({
		where: { employeeId_periodStart: { employeeId, periodStart } },
		select: { status: true }
	})
	if (existing && existing.status !== 'DRAFT') {
		error(409, `Cannot re-aggregate a timesheet that is already ${existing.status}`)
	}

	const timesheet = await db.$transaction(async (tx: Prisma.TransactionClient) => {
		const ts = await tx.timesheet.upsert({
			where: { employeeId_periodStart: { employeeId, periodStart } },
			create: { employeeId, periodStart, periodEnd, status: 'DRAFT', totalHours },
			update: { periodEnd, totalHours }
		})

		await tx.timesheetEntry.deleteMany({ where: { timesheetId: ts.id } })

		const entries = Object.entries(hoursByDay).map(([day, hours]) => ({
			timesheetId: ts.id,
			date: new Date(`${day}T00:00:00.000Z`),
			hoursWorked: hours,
			otHours: otByDay[day] ?? 0,
			notes: 'Aggregated from Discord time logs'
		}))
		if (entries.length) await tx.timesheetEntry.createMany({ data: entries })

		await tx.timeLog.updateMany({
			where: {
				employeeId,
				timestamp: { gte: periodStart, lte: periodEnd },
				punchType: { in: ['IN', 'OUT'] }
			},
			data: { timesheetId: ts.id }
		})

		return ts
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Timesheet',
		entityId: timesheet.id,
		newValue: {
			source: 'timelog_aggregation',
			totalHours,
			daysWithHours: Object.keys(hoursByDay).length,
			warnings: warnings.length
		}
	})

	return { timesheet, hoursByDay, totalHours, warnings }
}
