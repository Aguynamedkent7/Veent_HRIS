import { fail } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import { listSchedules, createSchedule } from '$lib/server/services/attendance/schedules'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	requireMinRole(locals.user!.role, 'HR_ADMIN')
	return { schedules: await listSchedules(locals.user!.organizationId) }
}

function hhmmToMin(s: string): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '')
	if (!m) return null
	return Number(m[1]) * 60 + Number(m[2])
}

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		requireMinRole(locals.user!.role, 'HR_ADMIN')
		const fd = await request.formData()
		const name = String(fd.get('name') ?? '').trim()
		const startMinutes = hhmmToMin(String(fd.get('start') ?? ''))
		const endMinutes = hhmmToMin(String(fd.get('end') ?? ''))
		const breakMinutes = Number(fd.get('breakMinutes') ?? 0)
		const isDefault = fd.get('isDefault') === 'on'
		const weekdays = fd
			.getAll('weekday')
			.map((v) => Number(v))
			.filter((n) => n >= 0 && n <= 6)

		if (!name || startMinutes === null || endMinutes === null) {
			return fail(400, { error: 'Name, start and end times are required.' })
		}
		try {
			await createSchedule(
				locals.user!.organizationId,
				{ name, isDefault, startMinutes, endMinutes, breakMinutes, weekdays },
				{ organizationId: locals.user!.organizationId, actorId: locals.user!.id, actorRole: locals.user!.role, ipAddress: getClientAddress() }
			)
		} catch (e: unknown) {
			const err = e as { status?: number; body?: { message?: string } }
			if (err?.status === 400) return fail(400, { error: err.body?.message ?? 'Invalid schedule' })
			throw e
		}
		return { success: true }
	}
}
