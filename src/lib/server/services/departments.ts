import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { AuditContext } from './types'

export async function listDepartments(organizationId: string) {
	return db.department.findMany({
		where: { organizationId },
		include: {
			_count: { select: { employees: true } },
			// #178: the head may be ON_LEAVE, so the picker cannot get their name off the
			// ACTIVE-only roster the page loads — carry it on the department row.
			head: { select: { id: true, firstName: true, lastName: true } }
		},
		orderBy: { name: 'asc' }
	})
}

export async function getDepartment(id: string, organizationId: string) {
	const department = await db.department.findFirst({
		where: { id, organizationId }
	})
	if (!department) error(404, 'Department not found')
	return department
}

export async function createDepartment(organizationId: string, name: string, ctx: AuditContext) {
	const department = await db.department.create({
		data: { organizationId, name }
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'Department',
		entityId: department.id,
		newValue: { name }
	})

	return department
}

export async function updateDepartment(
	id: string,
	organizationId: string,
	name: string,
	ctx: AuditContext
) {
	const existing = await getDepartment(id, organizationId)

	const department = await db.department.update({
		where: { id },
		data: { name }
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Department',
		entityId: id,
		oldValue: { name: existing.name },
		newValue: { name }
	})

	return department
}

/**
 * #178: name (or clear) the employee who attests the DEPARTMENT_HEAD signatory slot.
 *
 * Postgres cannot express either invariant this column carries, so both are verified here,
 * the same way `Employee.reportsToId` and `Employee.branchId` are (`schema.prisma:446-448`):
 *   - the head must be a member of THIS department
 *   - the head must be in the SAME organization as the department
 * The org check is the tenant boundary: it is the `organizationId` filter on the lookup below,
 * on the employee's own direct column rather than a `user: { organizationId }` join (#323).
 *
 * `null` is a valid head — a department with no head is the SPEC AC12 "stalled" case, and HR
 * must be able to get back to it.
 */
export async function setDepartmentHead(
	departmentId: string,
	organizationId: string,
	headEmployeeId: string | null,
	ctx: AuditContext
) {
	const existing = await getDepartment(departmentId, organizationId)

	if (headEmployeeId) {
		const head = await db.employee.findFirst({
			where: { id: headEmployeeId, organizationId },
			select: { departmentId: true }
		})
		if (!head) error(404, 'Employee not found')
		if (head.departmentId !== existing.id) {
			error(400, 'A department head must be a member of that department.')
		}
	}

	await db.$transaction(async (tx) => {
		await tx.department.update({ where: { id: existing.id }, data: { headEmployeeId } })
		// #324: the audit write shares the transaction it belongs to.
		await writeAuditLog(
			ctx,
			{
				action: 'UPDATE',
				entityType: 'Department',
				entityId: existing.id,
				oldValue: { headEmployeeId: existing.headEmployeeId },
				newValue: { headEmployeeId }
			},
			tx
		)
	})
}
