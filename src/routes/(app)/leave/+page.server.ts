import { db } from '$lib/server/db'
import { getLeaveBalances } from '$lib/server/services/leave'
import { listRequests } from '$lib/server/services/requests'
import type { PageServerLoad } from './$types'

// Read-only leave view. Leave filing/approval now flows through the unified
// Requests/Approvals page; this page lists leave (Request type=LEAVE) + balances.
export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const isManager = ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'].includes(user.role)

	const myEmployee = await db.employee.findUnique({ where: { userId: user.id } })
	const year = new Date().getFullYear()

	const [requests, leaveTypes, balances] = await Promise.all([
		listRequests({
			organizationId: user.organizationId,
			employeeId: isManager ? undefined : myEmployee?.id,
			type: 'LEAVE'
		}),
		db.leaveType.findMany({
			where: { organizationId: user.organizationId, isActive: true },
			orderBy: { name: 'asc' },
			select: { id: true, name: true }
		}),
		myEmployee ? getLeaveBalances(myEmployee.id, year) : []
	])

	return { requests, leaveTypes, balances, myEmployeeId: myEmployee?.id, isManager }
}
