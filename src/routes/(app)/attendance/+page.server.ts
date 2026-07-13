import { fail } from '@sveltejs/kit'
import { z } from 'zod'
import { db } from '$lib/server/db'
import { requireMinRole } from '$lib/server/rbac'
import { listAttendanceDays, deriveRange, correctDay, lockRange } from '$lib/server/services/attendance'
import { manilaDayKey } from '$lib/utils/dates'
import type { Actions, PageServerLoad, RequestEvent } from './$types'

const DAY_MS = 86_400_000

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user!
	const canManage = ['HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)

	const today = manilaDayKey(new Date())
	const from = url.searchParams.get('from') ?? manilaDayKey(new Date(Date.now() - 13 * DAY_MS))
	const to = url.searchParams.get('to') ?? today

	let employees: { id: string; firstName: string; lastName: string; employeeNumber: string }[] = []
	let selectedEmployeeId: string | null = null

	if (canManage) {
		employees = await db.employee.findMany({
			where: { user: { organizationId: user.organizationId }, employmentStatus: 'ACTIVE' },
			select: { id: true, firstName: true, lastName: true, employeeNumber: true },
			orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
		})
		selectedEmployeeId = url.searchParams.get('employeeId') ?? employees[0]?.id ?? null
	} else {
		const me = await db.employee.findUnique({ where: { userId: user.id }, select: { id: true } })
		selectedEmployeeId = me?.id ?? null
	}

	const days = selectedEmployeeId
		? await listAttendanceDays(selectedEmployeeId, new Date(from), new Date(to))
		: []

	return { canManage, employees, selectedEmployeeId, from, to, days }
}

function ctxOf(event: RequestEvent) {
	const u = event.locals.user!
	return { organizationId: u.organizationId, actorId: u.id, actorRole: u.role, ipAddress: event.getClientAddress() }
}

function toFail(e: unknown) {
	const err = e as { status?: number; body?: { message?: string } }
	if (err?.status && [400, 404, 409].includes(err.status)) return fail(err.status, { error: err.body?.message ?? 'Action failed' })
	throw e
}

const rangeSchema = z.object({ employeeId: z.string().min(1), from: z.coerce.date(), to: z.coerce.date() })
const correctSchema = z.object({
	id: z.string().min(1),
	regularHours: z.coerce.number().min(0).optional(),
	overtimeHours: z.coerce.number().min(0).optional(),
	status: z.enum(['PRESENT', 'LATE', 'ABSENT', 'INCOMPLETE', 'ON_LEAVE', 'HOLIDAY', 'REST_DAY']).optional(),
	note: z.string().optional()
})

export const actions: Actions = {
	derive: async (event) => {
		requireMinRole(event.locals.user!.role, 'HR_ADMIN')
		const parsed = rangeSchema.safeParse(Object.fromEntries(await event.request.formData()))
		if (!parsed.success) return fail(400, { error: 'Invalid range' })
		try {
			await deriveRange(event.locals.user!.organizationId, { from: parsed.data.from, to: parsed.data.to, employeeId: parsed.data.employeeId }, ctxOf(event))
		} catch (e) {
			return toFail(e)
		}
	},

	correct: async (event) => {
		requireMinRole(event.locals.user!.role, 'HR_ADMIN')
		const parsed = correctSchema.safeParse(Object.fromEntries(await event.request.formData()))
		if (!parsed.success) return fail(400, { error: 'Invalid correction' })
		const { id, ...data } = parsed.data
		try {
			await correctDay(id, event.locals.user!.organizationId, data, ctxOf(event))
		} catch (e) {
			return toFail(e)
		}
	},

	lock: async (event) => {
		requireMinRole(event.locals.user!.role, 'HR_ADMIN')
		const parsed = rangeSchema.safeParse(Object.fromEntries(await event.request.formData()))
		if (!parsed.success) return fail(400, { error: 'Invalid range' })
		try {
			await lockRange(event.locals.user!.organizationId, { from: parsed.data.from, to: parsed.data.to, employeeId: parsed.data.employeeId }, ctxOf(event))
		} catch (e) {
			return toFail(e)
		}
	}
}
