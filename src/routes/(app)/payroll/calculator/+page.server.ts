import { fail } from '@sveltejs/kit'
import { z } from 'zod'
import { requirePayrollManage } from '$lib/server/rbac'
import { previewPayroll } from '$lib/server/services/payroll/calculator'
import { emptyAttendance } from '$lib/server/services/payroll/types'
import type { Actions } from './$types'

// Roster + recurring prefills come from the payroll layout load (shared with the
// floating panel, #72) — this route only hosts the preview action.

const num = z.coerce.number().min(0).optional()
const schema = z.object({
	employeeId: z.string().min(1),
	regularHours: num,
	overtimeHours: num,
	nightDiffHours: num,
	restDayHours: num,
	regularHolidayHours: num,
	specialHolidayHours: num,
	lateMinutes: num,
	undertimeMinutes: num,
	allowances: num,
	incentives: num
})

export const actions: Actions = {
	preview: async ({ request, locals }) => {
		requirePayrollManage(locals.user!.role)
		const parsed = schema.safeParse(Object.fromEntries(await request.formData()))
		if (!parsed.success) return fail(400, { error: 'Invalid input' })
		const d = parsed.data
		try {
			const result = await previewPayroll(d.employeeId, locals.user!.organizationId, {
				attendance: {
					...emptyAttendance(),
					regularHours: d.regularHours ?? 0,
					overtimeHours: d.overtimeHours ?? 0,
					nightDiffHours: d.nightDiffHours ?? 0,
					restDayHours: d.restDayHours ?? 0,
					regularHolidayHours: d.regularHolidayHours ?? 0,
					specialHolidayHours: d.specialHolidayHours ?? 0,
					lateMinutes: d.lateMinutes ?? 0,
					undertimeMinutes: d.undertimeMinutes ?? 0
				},
				adjustments: { allowances: d.allowances, incentives: d.incentives }
			})
			return { result, employeeId: d.employeeId }
		} catch (e: unknown) {
			const err = e as { status?: number; body?: { message?: string } }
			if (err?.status === 404) return fail(404, { error: 'Employee not found' })
			throw e
		}
	}
}
