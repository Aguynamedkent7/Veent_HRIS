/**
 * Object-level access control for employee records (#228).
 *
 * The bug this exists to prevent: `MANAGER` holds `MANAGE_HR` (#133 made them on-branch HR) AND
 * ranks level with `HR_ADMIN`, so a guard written as `requireMinRole('MANAGER')` plus
 * `if (!can(role, 'MANAGE_HR'))` describes an EMPTY set — the two role lists are identical. Both
 * object-level checks written that way never ran, and every MANAGER could read and modify (and
 * reveal the salary, government IDs and bank details of) every employee in their tenant.
 *
 * The rule is a union because the tenants are shaped differently: branches exist only for the
 * food-service orgs (`isFoodServiceOrg`), while elsewhere a MANAGER is a department head whose
 * people simply report to them. So a MANAGER may reach an employee who is
 *   - in a branch they manage (`Branch.managerId`), or
 *   - one of their reports, primary or additional (#176), or
 *   - themselves.
 * `HR_ADMIN` / `CEO` / `SUPER_ADMIN` hold `ADMINISTER_HR_ORGWIDE` and are unrestricted.
 */

import { error } from '@sveltejs/kit'
import type { Role } from '@prisma/client'
import { db } from '$lib/server/db'
import { can } from '$lib/server/rbac'
import { listReportIdsFor } from './supervisors'

const DENIED = 'You can only manage your own team or a branch you manage.'

export interface EmployeeAccessActor {
	id: string
	role: Role
	organizationId: string
}

/** True if this actor may read/modify that employee record. Org scoping is the caller's job. */
export async function canTouchEmployee(
	user: EmployeeAccessActor,
	employeeId: string
): Promise<boolean> {
	if (can(user.role, 'ADMINISTER_HR_ORGWIDE')) return true

	const self = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true }
	})
	// A user with HR-ish rank but no employee record of their own has no team and no branch, so
	// there is nothing they may reach. Fail closed.
	if (!self) return false
	if (self.id === employeeId) return true

	const [reportIds, managedBranches] = await Promise.all([
		listReportIdsFor(self.id),
		db.branch.findMany({
			where: { managerId: self.id, organizationId: user.organizationId },
			select: { id: true }
		})
	])
	if (reportIds.includes(employeeId)) return true
	if (managedBranches.length === 0) return false

	const target = await db.employee.findFirst({
		where: { id: employeeId, user: { organizationId: user.organizationId } },
		select: { branchId: true }
	})
	return !!target?.branchId && managedBranches.some((b) => b.id === target.branchId)
}

/** Throwing form for route guards. 403 — the record may well exist, the actor just can't have it. */
export async function assertCanTouchEmployee(
	user: EmployeeAccessActor,
	employeeId: string
): Promise<void> {
	if (!(await canTouchEmployee(user, employeeId))) error(403, DENIED)
}
