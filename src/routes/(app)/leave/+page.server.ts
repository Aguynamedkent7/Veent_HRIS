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

	// Non-managers without an employee record have no leave to show — return an empty
	// list rather than passing an undefined employeeId (which would leak org-wide rows).
	const canListLeave = isManager || Boolean(myEmployee)

	const [requests, leaveTypes, balances] = await Promise.all([
		canListLeave
			? listRequests({
					organizationId: user.organizationId,
					employeeId: isManager ? undefined : myEmployee?.id,
					type: 'LEAVE'
				})
			: Promise.resolve([]),
		db.leaveType.findMany({
			where: { organizationId: user.organizationId, isActive: true },
			orderBy: { name: 'asc' },
			select: { id: true, name: true }
		}),
		myEmployee ? getLeaveBalances(myEmployee.id, year) : []
	])

	return { requests, leaveTypes, balances, myEmployeeId: myEmployee?.id, isManager }
}
