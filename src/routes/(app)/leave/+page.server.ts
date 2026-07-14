import { fail, isHttpError } from '@sveltejs/kit'
import { requireMinRole } from '$lib/server/rbac'
import {
	listLeaveRequests,
	requestLeave,
	reviewLeaveRequest,
	getLeaveBalances
} from '$lib/server/services/leave'
import { db } from '$lib/server/db'
import { z } from 'zod'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const isManager = ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)

	const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
	const year = new Date().getFullYear()

	const [requests, leaveTypes, balances] = await Promise.all([
		listLeaveRequests({
			organizationId: user.organizationId,
			employeeId: isManager ? undefined : myEmployee?.id
		}),
		db.leaveType.findMany({
			where: { organizationId: user.organizationId, isActive: true },
			orderBy: { name: 'asc' }
		}),
		myEmployee ? getLeaveBalances(myEmployee.id, year) : []
	])

	return { requests, leaveTypes, balances, myEmployeeId: myEmployee?.id, isManager }
}

const requestSchema = z.object({
	leaveTypeId: z.string().min(1),
	startDate: z.coerce.date(),
	endDate: z.coerce.date(),
	reason: z.string().optional()
})

export const actions: Actions = {
	request: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
		if (!myEmployee) return fail(400, { error: 'No employee profile found' })

		const raw = Object.fromEntries(await request.formData())
		const parsed = requestSchema.safeParse(raw)
		if (!parsed.success) return fail(400, { error: 'Invalid input' })

		try {
			await requestLeave(myEmployee.id, user.organizationId, parsed.data, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
	},

	review: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireMinRole(user.role, 'MANAGER')

		const data = await request.formData()
		const id = data.get('id') as string
		const approved = data.get('approved') === 'true'
		const rejectionReason = data.get('rejectionReason') as string | undefined

		try {
			await reviewLeaveRequest(id, user.organizationId, approved, rejectionReason, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
	}
}
