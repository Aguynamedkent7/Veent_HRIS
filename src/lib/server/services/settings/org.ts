import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { AuditContext } from '../types'
import type { Role } from '@prisma/client'

interface PositionInput {
	title: string
	level?: number
	departmentId?: string
}

export async function listPositions(organizationId: string) {
	return db.position.findMany({
		where: { organizationId },
		include: {
			department: { select: { id: true, name: true } },
			_count: { select: { employees: true } }
		},
		orderBy: [{ level: 'asc' }, { title: 'asc' }]
	})
}

export async function createPosition(
	organizationId: string,
	data: PositionInput,
	ctx: AuditContext
) {
	try {
		const position = await db.position.create({
			data: {
				organizationId,
				title: data.title,
				level: data.level,
				departmentId: data.departmentId
			}
		})

		await writeAuditLog(ctx, {
			action: 'CREATE',
			entityType: 'Position',
			entityId: position.id,
			newValue: { title: data.title, level: data.level, departmentId: data.departmentId }
		})

		return position
	} catch (err) {
		// Prisma P2002 = unique constraint violation on @@unique([organizationId, title])
		if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
			error(409, 'A position with this title already exists.')
		}
		throw err
	}
}

export async function updatePosition(
	id: string,
	organizationId: string,
	data: PositionInput,
	ctx: AuditContext
) {
	const existing = await db.position.findFirst({
		where: { id, organizationId }
	})
	if (!existing) error(404, 'Position not found')

	try {
		const position = await db.position.update({
			where: { id },
			data: {
				title: data.title,
				level: data.level,
				departmentId: data.departmentId
			}
		})

		await writeAuditLog(ctx, {
			action: 'UPDATE',
			entityType: 'Position',
			entityId: id,
			oldValue: {
				title: existing.title,
				level: existing.level,
				departmentId: existing.departmentId
			},
			newValue: { title: data.title, level: data.level, departmentId: data.departmentId }
		})

		return position
	} catch (err) {
		if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
			error(409, 'A position with this title already exists.')
		}
		throw err
	}
}

export async function getOrgChart(organizationId: string) {
	return db.department.findMany({
		where: { organizationId },
		select: {
			id: true,
			name: true,
			parentDepartmentId: true,
			employees: {
				select: {
					id: true,
					firstName: true,
					lastName: true,
					jobTitle: true,
					reportsToId: true
				},
				orderBy: { lastName: 'asc' }
			}
		},
		orderBy: { name: 'asc' }
	})
}

export async function listOrgUsers(organizationId: string) {
	const users = await db.user.findMany({
		where: { organizationId },
		select: {
			id: true,
			email: true,
			role: true,
			isActive: true,
			employee: {
				select: { firstName: true, lastName: true }
			}
		},
		orderBy: { email: 'asc' }
	})

	return users.map((u) => ({
		id: u.id,
		email: u.email,
		role: u.role,
		isActive: u.isActive,
		employeeName: u.employee
			? `${u.employee.lastName}, ${u.employee.firstName}`
			: null
	}))
}

export async function setUserRole(
	userId: string,
	organizationId: string,
	newRole: Role,
	ctx: AuditContext
) {
	// GUARDRAIL: user must belong to the same organization.
	const existing = await db.user.findFirst({
		where: { id: userId, organizationId }
	})
	if (!existing) error(404, 'User not found')

	const updated = await db.user.update({
		where: { id: userId },
		data: { role: newRole }
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'User',
		entityId: userId,
		oldValue: { role: existing.role },
		newValue: { role: newRole }
	})

	return updated
}
