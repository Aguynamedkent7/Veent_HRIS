import { db } from '$lib/server/db'
import { manilaDayKey, REGULARIZATION_MONTHS, regularizationStatus } from '$lib/utils/dates'

// How far ahead HR is warned of an upcoming regularization (#168). "2–3 weeks before"
// → a 21-day look-ahead; still-probationary staff already past due are surfaced too.
export const REGULARIZATION_NOTICE_DAYS = 21

/**
 * Probationary employees due to regularize within the notice window — plus any already
 * past due but still marked probationary, which is HR's to fix. Ordered soonest first so
 * overdue rows lead. Kept a DB-side filter by translating the regularization ceiling
 * (asOf + notice window) back to a start-date bound, so Postgres does the filtering
 * instead of loading every probationary row.
 */
export async function listUpcomingRegularizations(organizationId: string, asOf: Date = new Date()) {
	const ceiling = new Date(asOf)
	ceiling.setUTCDate(ceiling.getUTCDate() + REGULARIZATION_NOTICE_DAYS)
	// regularization = startDate + 6mo ≤ ceiling  ⇔  startDate ≤ ceiling − 6mo.
	const startCeiling = new Date(ceiling)
	startCeiling.setUTCMonth(startCeiling.getUTCMonth() - REGULARIZATION_MONTHS)

	const employees = await db.employee.findMany({
		where: {
			user: { organizationId },
			employmentType: 'PROBATIONARY',
			employmentStatus: 'ACTIVE',
			startDate: { lte: startCeiling }
		},
		select: {
			id: true,
			firstName: true,
			lastName: true,
			jobTitle: true,
			startDate: true,
			department: { select: { name: true } }
		}
	})

	return employees
		.map((e) => {
			const { date, daysUntil, overdue } = regularizationStatus(e.startDate, asOf)
			return {
				id: e.id,
				name: `${e.firstName} ${e.lastName}`,
				jobTitle: e.jobTitle,
				department: e.department.name,
				startDate: e.startDate,
				regularizationDate: date,
				daysUntil,
				overdue
			}
		})
		.sort((a, b) => a.daysUntil - b.daysUntil)
}

// Active employees whose birthday (month + day) is `today` in PHT (#167). Dates of birth
// are stored at UTC midnight, so their UTC month/day already read as the PHT calendar day.
// Filtered in the database with EXTRACT so we never load the whole roster for a greeting.
export async function listTodaysBirthdays(organizationId: string, today: Date = new Date()) {
	const [, mm, dd] = manilaDayKey(today).split('-').map(Number)
	const rows = await db.$queryRaw<{ firstName: string; lastName: string }[]>`
		SELECT e."firstName", e."lastName"
		FROM employees e
		JOIN users u ON u.id = e."userId"
		WHERE u."organizationId" = ${organizationId}
			AND e."employmentStatus" = 'ACTIVE'
			AND e."dateOfBirth" IS NOT NULL
			AND EXTRACT(MONTH FROM e."dateOfBirth") = ${mm}
			AND EXTRACT(DAY FROM e."dateOfBirth") = ${dd}
		ORDER BY e."firstName", e."lastName"
	`
	return rows.map((r) => `${r.firstName} ${r.lastName}`)
}

// The viewer's own employment standing for the dashboard status card (#167): type, start
// date (for tenure) and contract end date (for a contractual's renewal). Null when the
// user has no employee profile (e.g. a bare admin account).
export async function getMyEmploymentStatus(userId: string) {
	return db.employee.findUnique({
		where: { userId },
		select: { employmentType: true, startDate: true, endDate: true }
	})
}

export async function getEmployeeMetrics(userId: string, organizationId: string) {
	const employee = await db.employee.findFirst({
		where: { userId }
	})

	if (!employee) {
		return {
			pendingTimesheets: 0,
			leaveBalances: [],
			nextPayrollRun: null,
			recentTimesheets: []
		}
	}

	const currentYear = new Date().getFullYear()
	const now = new Date()

	const [pendingTimesheets, leaveBalances, nextPayrollRun, recentTimesheets] = await Promise.all([
		db.timesheet.count({
			where: {
				employeeId: employee.id,
				status: { in: ['DRAFT', 'SUBMITTED'] }
			}
		}),
		db.leaveBalance.findMany({
			where: {
				employeeId: employee.id,
				year: currentYear
			},
			include: {
				leaveType: { select: { name: true } }
			}
		}),
		db.payrollRun.findFirst({
			where: {
				organizationId,
				periodStart: { gte: now }
			},
			orderBy: { periodStart: 'asc' }
		}),
		db.timesheet.findMany({
			where: { employeeId: employee.id },
			orderBy: { createdAt: 'desc' },
			take: 3
		})
	])

	return {
		pendingTimesheets,
		leaveBalances,
		nextPayrollRun,
		recentTimesheets
	}
}

export async function getManagerMetrics(userId: string, organizationId: string) {
	const employee = await db.employee.findFirst({
		where: { userId }
	})

	if (!employee) {
		return {
			pendingApprovals: { timesheets: 0, leave: 0 },
			teamHeadcount: 0,
			recentActivity: []
		}
	}

	const directReports = await db.employee.findMany({
		where: { reportsToId: employee.id },
		select: { id: true }
	})
	const directReportIds = directReports.map((e) => e.id)

	const [pendingTimesheets, pendingLeave, teamHeadcount, recentActivity] = await Promise.all([
		db.timesheet.count({
			where: {
				employeeId: { in: directReportIds },
				status: 'SUBMITTED'
			}
		}),
		db.request.count({
			where: {
				employeeId: { in: directReportIds },
				type: 'LEAVE',
				status: 'PENDING'
			}
		}),
		db.employee.count({
			where: {
				reportsToId: employee.id,
				employmentStatus: 'ACTIVE'
			}
		}),
		db.auditLog.findMany({
			where: { organizationId },
			orderBy: { createdAt: 'desc' },
			take: 5,
			include: {
				actor: { select: { email: true, role: true } }
			}
		})
	])

	return {
		pendingApprovals: { timesheets: pendingTimesheets, leave: pendingLeave },
		teamHeadcount,
		recentActivity
	}
}

export async function getAdminMetrics(organizationId: string) {
	const today = new Date()
	today.setHours(0, 0, 0, 0)
	const tomorrow = new Date(today)
	tomorrow.setDate(tomorrow.getDate() + 1)

	const [
		totalHeadcount,
		onLeaveToday,
		pendingTimesheets,
		pendingLeave,
		openJobPostings,
		lastPayrollRun
	] = await Promise.all([
		db.employee.count({
			where: {
				user: { organizationId },
				employmentStatus: 'ACTIVE'
			}
		}),
		db.request.count({
			where: {
				employee: { user: { organizationId } },
				type: 'LEAVE',
				status: 'APPROVED',
				dateFrom: { lte: tomorrow },
				dateTo: { gte: today }
			}
		}),
		db.timesheet.count({
			where: {
				employee: { user: { organizationId } },
				status: 'SUBMITTED'
			}
		}),
		db.request.count({
			where: {
				employee: { user: { organizationId } },
				type: 'LEAVE',
				status: 'PENDING'
			}
		}),
		db.jobPosting.count({
			where: {
				organizationId,
				status: 'OPEN'
			}
		}),
		db.payrollRun.findFirst({
			where: { organizationId },
			orderBy: { periodStart: 'desc' },
			select: {
				periodStart: true,
				periodEnd: true,
				status: true,
				totalNet: true
			}
		})
	])

	return {
		totalHeadcount,
		onLeaveToday,
		pendingTimesheets,
		pendingLeave,
		openJobPostings,
		lastPayrollRun
	}
}

// ─── Upcoming events (dashboard side panel) ──────────────────────────────────

/** How far ahead the panel looks. Short deliberately: everything shown is close enough to act on. */
export const UPCOMING_EVENT_DAYS = 14

export type UpcomingEventKind =
	'holiday' | 'birthday' | 'anniversary' | 'regularization' | 'contract' | 'payroll' | 'leave'

export interface UpcomingEvent {
	/** UTC-midnight day key (YYYY-MM-DD), so the client formats without re-deriving a timezone. */
	date: string
	title: string
	detail?: string
	kind: UpcomingEventKind
	/** The viewer's own event — rendered with emphasis. */
	mine?: boolean
}

/** Day key `n` days from `from`, in the same UTC-midnight form the models store. */
function dayKeyIn(from: Date, days: number) {
	const d = new Date(from)
	d.setUTCDate(d.getUTCDate() + days)
	return manilaDayKey(d)
}

/**
 * Recurring-date helper: the next occurrence of `source`'s month/day at or after `todayKey`,
 * as a day key — or null when it falls outside the window. Used for birthdays and work
 * anniversaries, where only the month and day matter and the year rolls over.
 */
function nextAnniversaryKey(source: Date, todayKey: string, endKey: string): string | null {
	const [ty] = todayKey.split('-').map(Number)
	const mm = String(source.getUTCMonth() + 1).padStart(2, '0')
	const dd = String(source.getUTCDate()).padStart(2, '0')
	// Try this year and next: a window spanning New Year has to reach the following January.
	for (const year of [ty, ty + 1]) {
		const key = `${year}-${mm}-${dd}`
		if (key >= todayKey && key <= endKey) return key
	}
	return null
}

/**
 * The next `UPCOMING_EVENT_DAYS` of org and personal events for the dashboard panel.
 *
 * Scoping is the important part. Holidays, birthdays, anniversaries and payroll cut-offs are
 * org-wide and go to everyone. Probation reviews, contract end dates and other people's leave
 * are employment matters and go only to the HR ladder — a viewer always sees their *own*,
 * whatever their role, because those are facts about them.
 */
export async function listUpcomingEvents(
	organizationId: string,
	viewer: { userId: string; canSeeSensitive: boolean },
	asOf: Date = new Date()
): Promise<UpcomingEvent[]> {
	const todayKey = manilaDayKey(asOf)
	const endKey = dayKeyIn(asOf, UPCOMING_EVENT_DAYS)
	const from = new Date(`${todayKey}T00:00:00.000Z`)
	const to = new Date(`${endKey}T23:59:59.999Z`)

	const me = await db.employee.findUnique({
		where: { userId: viewer.userId },
		select: { id: true }
	})

	const [holidays, people, periods, leaves] = await Promise.all([
		db.publicHoliday.findMany({
			where: { organizationId, date: { gte: from, lte: to } },
			select: { date: true, name: true, type: true }
		}),
		// One roster read feeds birthdays, anniversaries, regularizations and contract ends;
		// four separate queries over the same rows would be four times the work for one panel.
		db.employee.findMany({
			where: { organizationId, employmentStatus: 'ACTIVE' },
			select: {
				id: true,
				firstName: true,
				lastName: true,
				dateOfBirth: true,
				startDate: true,
				endDate: true,
				employmentType: true
			}
		}),
		db.payrollPeriod.findMany({
			where: { organizationId, endDate: { gte: from, lte: to } },
			select: { name: true, endDate: true }
		}),
		db.request.findMany({
			where: {
				employee: { organizationId },
				type: 'LEAVE',
				status: 'APPROVED',
				dateFrom: { gte: from, lte: to }
			},
			select: {
				dateFrom: true,
				dateTo: true,
				employeeId: true,
				employee: { select: { firstName: true, lastName: true } }
			}
		})
	])

	const events: UpcomingEvent[] = []
	const name = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`

	for (const h of holidays) {
		events.push({
			date: manilaDayKey(h.date),
			title: h.name,
			// Regular vs special changes holiday pay, so it is worth naming.
			detail: h.type === 'REGULAR' ? 'Regular holiday' : 'Special holiday',
			kind: 'holiday'
		})
	}

	for (const p of people) {
		const mine = !!me && p.id === me.id

		if (p.dateOfBirth) {
			const key = nextAnniversaryKey(p.dateOfBirth, todayKey, endKey)
			if (key)
				events.push({ date: key, title: name(p), detail: 'Birthday', kind: 'birthday', mine })
		}

		const annKey = nextAnniversaryKey(p.startDate, todayKey, endKey)
		if (annKey) {
			const years = Number(annKey.slice(0, 4)) - p.startDate.getUTCFullYear()
			// Year zero is the hire date itself, not an anniversary.
			if (years > 0) {
				events.push({
					date: annKey,
					title: name(p),
					detail: `${years} year${years === 1 ? '' : 's'} of service`,
					kind: 'anniversary',
					mine
				})
			}
		}

		// Employment matters: HR-wide, or the viewer's own.
		if (!viewer.canSeeSensitive && !mine) continue

		if (p.employmentType === 'PROBATIONARY') {
			const due = new Date(p.startDate)
			due.setUTCMonth(due.getUTCMonth() + REGULARIZATION_MONTHS)
			const key = manilaDayKey(due)
			if (key >= todayKey && key <= endKey) {
				events.push({
					date: key,
					title: name(p),
					detail: 'Regularization due',
					kind: 'regularization',
					mine
				})
			}
		}

		if (p.employmentType === 'CONTRACTUAL' && p.endDate) {
			const key = manilaDayKey(p.endDate)
			if (key >= todayKey && key <= endKey) {
				events.push({ date: key, title: name(p), detail: 'Contract ends', kind: 'contract', mine })
			}
		}
	}

	for (const period of periods) {
		events.push({
			date: manilaDayKey(period.endDate),
			title: 'Payroll cut-off',
			detail: period.name,
			kind: 'payroll'
		})
	}

	for (const l of leaves) {
		const mine = !!me && l.employeeId === me.id
		if (!viewer.canSeeSensitive && !mine) continue
		const days =
			l.dateTo && l.dateFrom
				? Math.round((l.dateTo.getTime() - l.dateFrom.getTime()) / 86_400_000) + 1
				: 1
		events.push({
			date: manilaDayKey(l.dateFrom as Date),
			title: mine ? 'You are on leave' : name(l.employee),
			detail: `On leave · ${days} day${days === 1 ? '' : 's'}`,
			kind: 'leave',
			mine
		})
	}

	return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
}
