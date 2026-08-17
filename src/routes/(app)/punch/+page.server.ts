import { error, fail } from '@sveltejs/kit'
import { z } from 'zod'
import { db } from '$lib/server/db'
import { requireFoodServiceOrg } from '$lib/server/rbac'
import { listPunches, recordPunch } from '$lib/server/services/timelog'
import { manilaDateTime, manilaDayKey } from '$lib/utils/dates'
import type { Actions, PageServerLoad, RequestEvent } from './$types'

/**
 * #177 — the web punch surface. Food-service tenants only; an employee punches only as
 * themselves.
 *
 * The guard, stated for the record. This route is SESSION-AUTHENTICATED, not HMAC — nothing
 * here reads TIMELOG_API_SECRET. Three server-side layers:
 *
 *  1. `locals.user` must exist. Enforced by the `(app)` group's layout load, the same gate
 *     every other authenticated page uses.
 *  2. `requireFoodServiceOrg` → 404 for a non-food-service tenant, in BOTH `load` and the
 *     action. A load-only gate is bypassed by a direct POST, and the nav link is cosmetic.
 *  3. The employee is resolved from `locals.user`, NEVER from the form. There is no
 *     `employeeId` field in the punch form and the action must never read one. That is what
 *     makes this route safe without a new capability: an authenticated user can only ever
 *     punch as themselves, so no MANAGE_HR / VIEW_TEAM check is needed or wanted. If a future
 *     change adds punch-on-behalf-of, it needs `assertCanModifyTimesheet`-style object
 *     scoping (see `services/timesheets.ts`) — do not just widen the form.
 */

// How far back the page's own punch history looks.
const HISTORY_DAYS = 7

/**
 * Resolve the caller's OWN employee row, scoped to the ACTIVE org.
 *
 * Scoped to the active org: a cross-org account (the CEO, #224) carries one profile in its
 * home tenant only, so `findUnique({ where: { userId } })` would resolve that home-tenant
 * employee no matter which org the session is currently in — and this route WRITES. The
 * result would be a punch filed into the wrong tenant. `/profile` carries the same comment
 * for the same reason (`profile/+page.server.ts`); this is the write-side twin of it.
 */
function findSelfEmployee(user: { id: string; organizationId: string }) {
	return db.employee.findFirst({
		where: { userId: user.id, organizationId: user.organizationId },
		select: { id: true, firstName: true, lastName: true }
	})
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	requireFoodServiceOrg(user.organizationId)

	const me = await findSelfEmployee(user)
	if (!me) error(404, 'No employee record is linked to your account')

	const from = new Date(Date.now() - HISTORY_DAYS * 86_400_000)
	const rawPunches = await listPunches(me.id, { from })

	// Project explicitly rather than shipping raw rows: the employee may see their OWN
	// coordinates (Decision 5), but a future TimeLog column must not reach the client just by
	// existing. Formatted PHT server-side so the read-only view is timezone-safe.
	const punches = rawPunches
		.map((p) => ({
			id: p.id,
			punchType: p.punchType,
			source: p.source,
			dayKey: manilaDayKey(p.timestamp),
			at: manilaDateTime(p.timestamp),
			latitude: p.latitude,
			longitude: p.longitude,
			locationAccuracyM: p.locationAccuracyM
		}))
		.reverse()

	return {
		employeeName: `${me.firstName} ${me.lastName}`,
		punches,
		historyDays: HISTORY_DAYS
	}
}

/**
 * Every field of a form POST arrives as a string, and an empty string is how this page says
 * "there is no reading" — which is the normal outcome whenever the browser denies, times out,
 * or has no geolocation API at all. `z.coerce.number()` would turn that empty string into `0`,
 * because `Number('') === 0`, and the punch would be filed at 0°N 0°E — a real point in the
 * Gulf of Guinea, indistinguishable from a genuine fix. Blank out before coercing.
 */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

/**
 * Location is parsed on its own, separately from the punch type, and every failure resolves to
 * `null` rather than to an error. Criterion 7: a location problem must never cost the employee
 * their punch.
 */
const locationSchema = z.object({
	latitude: z.preprocess(blankToUndefined, z.coerce.number().min(-90).max(90)),
	longitude: z.preprocess(blankToUndefined, z.coerce.number().min(-180).max(180)),
	accuracyM: z.preprocess(blankToUndefined, z.coerce.number().min(0).optional())
})

export const actions: Actions = {
	punch: async (event: RequestEvent) => {
		const user = event.locals.user!
		requireFoodServiceOrg(user.organizationId)

		const me = await findSelfEmployee(user)
		if (!me) return fail(404, { error: 'No employee record is linked to your account' })

		const raw = Object.fromEntries(await event.request.formData())

		// The punch type is the ONLY required field.
		const type = z.enum(['IN', 'OUT']).safeParse(raw.punchType)
		if (!type.success) return fail(400, { error: 'Invalid punch type' })

		// A missing, malformed or out-of-range reading is discarded silently — never surfaced as
		// a 400. `raw.employeeId` is deliberately not read here and never will be (layer 3).
		const loc = locationSchema.safeParse(raw)
		const location = loc.success
			? {
					latitude: loc.data.latitude,
					longitude: loc.data.longitude,
					accuracyM: loc.data.accuracyM
				}
			: null

		// Debounce key: one punch per employee per type per PHT minute. A double-tap or a
		// double-submit collapses onto the same 409 the Discord replay defence uses.
		const now = new Date()
		const dedupKey = `web:${me.id}:${type.data}:${now.toISOString().slice(0, 16)}`

		try {
			await recordPunch(
				{
					employeeId: me.id,
					punchType: type.data,
					timestamp: now,
					dedupKey,
					source: 'WEB',
					location
				},
				{ ipAddress: event.getClientAddress() }
			)
		} catch (e) {
			const err = e as { status?: number; body?: { message?: string } }
			if (err?.status && [400, 404, 409].includes(err.status))
				return fail(err.status, { error: err.body?.message ?? 'Could not record the punch' })
			throw e
		}

		return { punched: type.data, hadLocation: Boolean(location) }
	}
}
