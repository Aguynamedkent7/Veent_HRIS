import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import type { PunchType, PunchSource } from '@prisma/client'
import { manilaDayKey, manilaWeekStart, manilaWeekEnd } from '$lib/utils/dates'
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
		/** `BREAK` is a toggle resolved to BREAK_START/BREAK_END from the last punch. */
		punchType: 'IN' | 'OUT' | 'BREAK'
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

	// The most recent punch — used to tell the user their new state and to resolve /break.
	const previous = await db.timeLog.findFirst({
		where: { employeeId: employee.id },
		orderBy: { timestamp: 'desc' },
		select: { punchType: true }
	})

	// /break toggles: end a break if one is open, otherwise start one.
	const resolvedType: PunchType =
		input.punchType === 'BREAK'
			? previous?.punchType === 'BREAK_START'
				? 'BREAK_END'
				: 'BREAK_START'
			: input.punchType

	const timeLog = await db.timeLog.create({
		data: {
			employeeId: employee.id,
			punchType: resolvedType,
			source: input.source ?? 'DISCORD',
			timestamp: input.timestamp,
			discordMessageId: input.discordMessageId
		}
	})

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
export async function listPunches(
	employeeId: string,
	range?: { from?: Date; to?: Date }
) {
	return db.timeLog.findMany({
		where: {
			employeeId,
			...(range?.from || range?.to
				? { timestamp: { ...(range.from && { gte: range.from }), ...(range.to && { lte: range.to }) } }
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
	/** PHT day key (YYYY-MM-DD) → worked hours. Overnight shifts count toward the IN day. */
	hoursByDay: Record<string, number>
	warnings: string[]
}

/**
 * Pure IN/OUT → daily-hours reducer (no DB). Punches are paired sequentially so
 * overnight shifts, multiple pairs per day, missing OUTs, and stray OUTs are all handled.
 * Exported for unit testing.
 */
export function pairPunchesToDailyHours(punches: PunchLite[]): DailyAggregate {
	const sorted = [...punches].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
	const hoursByDay: Record<string, number> = {}
	const warnings: string[] = []
	let openIn: Date | null = null

	for (const p of sorted) {
		if (p.punchType === 'IN') {
			if (openIn) warnings.push(`Missing OUT for IN punch at ${openIn.toISOString()}`)
			openIn = p.timestamp
		} else {
			if (!openIn) {
				warnings.push(`OUT punch without a matching IN at ${p.timestamp.toISOString()}`)
				continue
			}
			const hours = (p.timestamp.getTime() - openIn.getTime()) / 3_600_000
			const day = manilaDayKey(openIn) // attribute the shift to the day it started (PHT)
			hoursByDay[day] = round2((hoursByDay[day] ?? 0) + hours)
			openIn = null
		}
	}

	if (openIn) warnings.push(`Missing OUT for IN punch at ${openIn.toISOString()}`)
	return { hoursByDay, warnings }
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
	const periodStart = manilaWeekStart(weekOf)
	const periodEnd = manilaWeekEnd(weekOf)

	const punches = await db.timeLog.findMany({
		where: { employeeId, timestamp: { gte: periodStart, lte: periodEnd } },
		orderBy: { timestamp: 'asc' },
		select: { punchType: true, timestamp: true }
	})

	const { hoursByDay, warnings } = pairPunchesToDailyHours(punches)
	const totalHours = round2(Object.values(hoursByDay).reduce((s, h) => s + h, 0))

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
			notes: 'Aggregated from Discord time logs'
		}))
		if (entries.length) await tx.timesheetEntry.createMany({ data: entries })

		await tx.timeLog.updateMany({
			where: { employeeId, timestamp: { gte: periodStart, lte: periodEnd } },
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
