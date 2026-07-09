import { fail, redirect } from '@sveltejs/kit'
import { z } from 'zod'
import { db } from '$lib/server/db'
import { requestLeave, getLeaveBalances } from '$lib/server/services/leave'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!

	const employee = await db.employee.findUnique({ where: { userId: user.id } })
	if (!employee) redirect(303, '/leave')

	const [leaveTypes, balances] = await Promise.all([
		db.leaveType.findMany({
			where: { organizationId: user.organizationId, isActive: true },
			orderBy: { name: 'asc' }
		}),
		getLeaveBalances(employee!.id, new Date().getFullYear())
	])

	return {
		leaveTypes,
		balances,
		myEmployeeId: employee!.id
	}
}

const createSchema = z.object({
	leaveTypeId: z.string().min(1, 'Leave type is required'),
	startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid start date'),
	endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid end date'),
	reason: z.string().optional()
})

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = locals.user!

		const employee = await db.employee.findUnique({ where: { userId: user.id } })
		if (!employee) {
			return fail(400, { error: 'No employee profile found.' })
		}

		const formData = await request.formData()
		const result = createSchema.safeParse({
			leaveTypeId: formData.get('leaveTypeId'),
			startDate: formData.get('startDate'),
			endDate: formData.get('endDate'),
			reason: formData.get('reason') || undefined
		})

		if (!result.success) {
			const firstError = result.error.errors[0]
			return fail(422, { error: firstError?.message ?? 'Validation error.' })
		}

		const { leaveTypeId, startDate, endDate, reason } = result.data

		const start = new Date(startDate)
		const end = new Date(endDate)

		if (end < start) {
			return fail(422, { error: 'End date must be on or after start date.' })
		}

		const ctx = {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role
		}

		try {
			await requestLeave(
				employee.id,
				user.organizationId,
				{ leaveTypeId, startDate: start, endDate: end, reason },
				ctx
			)
		} catch (err: unknown) {
			const e = err as { status?: number; body?: { message?: string }; message?: string }
			const message = e?.body?.message ?? e?.message ?? 'Failed to submit leave request.'

			// Try to extract remaining/requested from the error message
			const remainingMatch = message.match(/Available:\s*([\d.]+)/)
			const remaining = remainingMatch ? parseFloat(remainingMatch[1]) : undefined

			return fail(422, { error: message, remaining, requested: undefined })
		}

		redirect(303, '/leave')
	}
}
