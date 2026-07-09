import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { AuditContext } from './types'

export async function listDepartments(organizationId: string) {
	return db.department.findMany({
		where: { organizationId },
		include: {
			_count: { select: { employees: true } }
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

export async function createDepartment(
	organizationId: string,
	name: string,
	ctx: AuditContext
) {
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
