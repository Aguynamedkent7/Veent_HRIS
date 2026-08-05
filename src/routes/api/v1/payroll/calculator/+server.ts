import { json } from '@sveltejs/kit'
import { z } from 'zod'
import { requirePayrollManage } from '$lib/server/rbac'
import { apiError, badRequest, forbidden } from '$lib/server/api-error'
import { previewPayroll } from '$lib/server/services/payroll/calculator'
import { emptyAttendance } from '$lib/server/services/payroll/types'
import type { RequestHandler } from './$types'

const num = z.coerce.number().min(0).default(0)
const schema = z.object({
	employeeId: z.string().min(1),
	attendance: z
		.object({
			regularHours: num,
			overtimeHours: num,
			nightDiffHours: num,
			restDayHours: num,
			restDayOtHours: num,
			regularHolidayHours: num,
			regularHolidayOtHours: num,
			specialHolidayHours: num,
			specialHolidayOtHours: num,
			lateMinutes: num,
			undertimeMinutes: num
		})
		.partial()
		.default({}),
	adjustments: z.object({ allowances: num.optional(), incentives: num.optional() }).default({})
})

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')
	try {
		requirePayrollManage(locals.user.roles)
	} catch {
		return forbidden()
	}

	let body: unknown
	try {
		body = await request.json()
	} catch {
		return badRequest('Invalid JSON body')
	}
	const parsed = schema.safeParse(body)
	if (!parsed.success) return badRequest('Invalid input', parsed.error.flatten())

	try {
		const result = await previewPayroll(parsed.data.employeeId, locals.user.organizationId, {
			attendance: { ...emptyAttendance(), ...parsed.data.attendance },
			adjustments: parsed.data.adjustments
		})
		return json({ data: result })
	} catch (e: unknown) {
		const err = e as { status?: number; body?: { message?: string } }
		if (err?.status === 404) return apiError(404, err.body?.message ?? 'Employee not found')
		throw e
	}
}
