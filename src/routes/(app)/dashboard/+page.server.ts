import { fail } from '@sveltejs/kit'
import { z } from 'zod'
import { db } from '$lib/server/db'
import { manilaDayKey } from '$lib/utils/dates'
import { can, requireCapability } from '$lib/server/rbac'
import { listRecentAnnouncements, createAnnouncement } from '$lib/server/services/announcements'
import { countPendingApprovals } from '$lib/server/services/approvals'
import {
	listUpcomingRegularizations,
	listTodaysBirthdays,
	getMyEmploymentStatus
} from '$lib/server/services/dashboard'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const orgId = user.organizationId
	const canPost = can(user.role, 'MANAGE_HR')
	// The "Last Payroll" tile is payroll-report data, not general dashboard info (#132).
	const canViewPayroll = can(user.role, 'VIEW_PAYROLL_REPORTS')

	// Today's PHT day, stored as the UTC-midnight date key used by AttendanceDay.
	const todayKey = manilaDayKey(new Date())
	const today = new Date(`${todayKey}T00:00:00Z`)

	const [headcount, onLeaveToday, pending, lastPayrollRun, attendanceGroups] = await Promise.all([
		db.employee.count({
			where: { user: { organizationId: orgId }, employmentStatus: 'ACTIVE' }
		}),
		// Employees on approved leave that spans today.
		db.request.count({
			where: {
				employee: { user: { organizationId: orgId } },
				type: 'LEAVE',
				status: 'APPROVED',
				dateFrom: { lte: today },
				dateTo: { gte: today }
			}
		}),
		// Items awaiting THIS user's decision — requests, timesheets, and payroll runs
		// (#134) — the same per-user, stage-aware count the sidebar badge uses, so the two
		// always agree. A payroll run pending sign-off now shows here (previously missing).
		countPendingApprovals({
			id: user.id,
			role: user.role,
			roles: user.roles,
			organizationId: orgId
		}),
		db.payrollRun.findFirst({
			where: { organizationId: orgId },
			orderBy: { createdAt: 'desc' },
			select: { periodStart: true, periodEnd: true, status: true, totalNet: true }
		}),
		// Today's derived attendance, grouped by status.
		db.attendanceDay.groupBy({
			by: ['status'],
			where: { date: today, employee: { user: { organizationId: orgId } } },
			_count: { _all: true }
		})
	])

	const attStatus = (s: string) => attendanceGroups.find((g) => g.status === s)?._count._all ?? 0
	const attendance = {
		present: attStatus('PRESENT'),
		late: attStatus('LATE'),
		absent: attStatus('ABSENT'),
		onLeave: attStatus('ON_LEAVE'),
		derived: attendanceGroups.reduce((s, g) => s + g._count._all, 0)
	}

	const [announcements, birthdays, myStatus] = await Promise.all([
		listRecentAnnouncements(orgId, 5),
		// Today's birthday greeting, surfaced in the announcements feed (#167).
		listTodaysBirthdays(orgId),
		// The viewer's own employment standing for the status card (#167).
		getMyEmploymentStatus(user.id)
	])

	// HR's advance warning of probationary staff coming up for regularization (#168).
	const regularizations = canPost ? await listUpcomingRegularizations(orgId) : []

	return {
		canPost,
		canViewPayroll,
		announcements,
		regularizations,
		birthdays,
		myStatus,
		metrics: {
			headcount,
			onLeaveToday,
			pendingApprovals: pending.total,
			pendingRequests: pending.requests,
			pendingTimesheets: pending.timesheets,
			pendingPayrollRuns: pending.payrollRuns,
			// Withhold payroll figures from clients that may not view them.
			lastPayrollRun: canViewPayroll ? lastPayrollRun : null,
			attendance
		}
	}
}

const announcementSchema = z.object({
	title: z.string().min(1, 'Title is required').max(150),
	body: z.string().min(1, 'Message is required').max(2000)
})

export const actions: Actions = {
	postAnnouncement: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireCapability(user.role, 'MANAGE_HR')

		const parsed = announcementSchema.safeParse(Object.fromEntries(await request.formData()))
		if (!parsed.success)
			return fail(422, { error: parsed.error.errors[0]?.message ?? 'Invalid input' })

		await createAnnouncement(user.organizationId, parsed.data, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
		return { posted: true }
	}
}
