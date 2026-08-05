import { fail } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { requireAnyMinRole } from '$lib/server/rbac'
import {
	listSchedules,
	createSchedule,
	setScheduleTardiness,
	setOrgTardiness
} from '$lib/server/services/attendance/schedules'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	requireAnyMinRole(locals.user!.roles, 'HR_ADMIN')
	const organizationId = locals.user!.organizationId
	const [schedules, org] = await Promise.all([
		listSchedules(organizationId),
		db.organization.findUnique({ where: { id: organizationId }, select: { trackTardiness: true } })
	])
	// #190: the org master switch greys out the per-schedule toggles when it's off.
	return { schedules, orgTracksTardiness: org?.trackTardiness ?? true }
}

function hhmmToMin(s: string): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '')
	if (!m) return null
	return Number(m[1]) * 60 + Number(m[2])
}

export const actions: Actions = {
	create: async ({ request, locals, getClientAddress }) => {
		requireAnyMinRole(locals.user!.roles, 'HR_ADMIN')
		const fd = await request.formData()
		const name = String(fd.get('name') ?? '').trim()
		const startMinutes = hhmmToMin(String(fd.get('start') ?? ''))
		const endMinutes = hhmmToMin(String(fd.get('end') ?? ''))
		const breakMinutes = Number(fd.get('breakMinutes') ?? 0)
		const isDefault = fd.get('isDefault') === 'on'
		const trackTardiness = fd.get('trackTardiness') === 'on'
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
				{ name, isDefault, trackTardiness, startMinutes, endMinutes, breakMinutes, weekdays },
				{
					organizationId: locals.user!.organizationId,
					actorId: locals.user!.id,
					actorRole: locals.user!.role,
					ipAddress: getClientAddress()
				}
			)
		} catch (e: unknown) {
			const err = e as { status?: number; body?: { message?: string } }
			if (err?.status === 400) return fail(400, { error: err.body?.message ?? 'Invalid schedule' })
			throw e
		}
		return { success: true }
	},

	toggleOrgTardiness: async ({ request, locals, getClientAddress }) => {
		requireAnyMinRole(locals.user!.roles, 'HR_ADMIN')
		const enabled = (await request.formData()).get('enabled') === 'true'
		await setOrgTardiness(locals.user!.organizationId, enabled, {
			organizationId: locals.user!.organizationId,
			actorId: locals.user!.id,
			actorRole: locals.user!.role,
			ipAddress: getClientAddress()
		})
		return { success: true }
	},

	toggleTardiness: async ({ request, locals, getClientAddress }) => {
		requireAnyMinRole(locals.user!.roles, 'HR_ADMIN')
		const fd = await request.formData()
		const id = String(fd.get('id') ?? '')
		const enabled = fd.get('enabled') === 'true'
		if (!id) return fail(400, { error: 'Missing schedule id' })
		try {
			await setScheduleTardiness(locals.user!.organizationId, id, enabled, {
				organizationId: locals.user!.organizationId,
				actorId: locals.user!.id,
				actorRole: locals.user!.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			const err = e as { status?: number; body?: { message?: string } }
			if (err?.status) return fail(err.status, { error: err.body?.message ?? 'Update failed' })
			throw e
		}
		return { success: true }
	}
}
