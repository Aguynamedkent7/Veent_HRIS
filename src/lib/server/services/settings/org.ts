import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { AuditContext } from '../types'
import type { Role } from '@prisma/client'

interface PositionInput {
	title: string
	level?: number
	departmentId?: string
	salaryGradeId?: string | null
	isActive?: boolean
}

export async function listPositions(organizationId: string) {
	return db.position.findMany({
		where: { organizationId },
		include: {
			department: { select: { id: true, name: true } },
			salaryGrade: { select: { id: true, name: true } },
			_count: { select: { employees: true } }
		},
		orderBy: [{ level: 'asc' }, { title: 'asc' }]
	})
}

export async function getPosition(id: string, organizationId: string) {
	const position = await db.position.findFirst({
		where: { id, organizationId },
		include: {
			department: { select: { id: true, name: true } },
			salaryGrade: { select: { id: true, name: true } },
			_count: { select: { employees: true } }
		}
	})
	if (!position) error(404, 'Position not found')
	return position
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
				departmentId: data.departmentId,
				salaryGradeId: data.salaryGradeId ?? undefined
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
				departmentId: data.departmentId,
				salaryGradeId: data.salaryGradeId,
				isActive: data.isActive
			}
		})

		await writeAuditLog(ctx, {
			action: 'UPDATE',
			entityType: 'Position',
			entityId: id,
			oldValue: {
				title: existing.title,
				level: existing.level,
				departmentId: existing.departmentId,
				salaryGradeId: existing.salaryGradeId,
				isActive: existing.isActive
			},
			newValue: {
				title: data.title,
				level: data.level,
				departmentId: data.departmentId,
				salaryGradeId: data.salaryGradeId,
				isActive: data.isActive
			}
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
		employeeName: u.employee ? `${u.employee.lastName}, ${u.employee.firstName}` : null
	}))
}

// Guard against locking an organization out of super-admin access. Blocks demoting
// or deactivating the last active SUPER_ADMIN. Call before any write that would
// strip the super-admin capability from `target`.
async function assertNotLastSuperAdmin(
	organizationId: string,
	target: { id: string; role: Role; isActive: boolean }
) {
	if (target.role !== 'SUPER_ADMIN' || !target.isActive) return
	const otherActiveSupers = await db.user.count({
		where: {
			organizationId,
			role: 'SUPER_ADMIN',
			isActive: true,
			id: { not: target.id }
		}
	})
	if (otherActiveSupers === 0) {
		error(409, 'Cannot remove the last active super admin from the organization.')
	}
}

export async function setUserRole(
	userId: string,
	organizationId: string,
	newRole: Role,
	ctx: AuditContext
) {
	// GUARDRAIL: separation of duties — nobody sets their own role. This lived in the roles form
	// action and again in the v1 PATCH twin, but never in this writer, so the protection was two
	// copies of a rule the service itself did not know: a third caller would have inherited none of
	// it. Enforced here, both routes are covered once and any future caller is covered by default.
	if (userId === ctx.actorId) error(403, 'You cannot change your own role.')

	// GUARDRAIL: user must belong to the same organization.
	const existing = await db.user.findFirst({
		where: { id: userId, organizationId }
	})
	if (!existing) error(404, 'User not found')

	// GUARDRAIL: don't demote the last active super admin.
	if (newRole !== 'SUPER_ADMIN') {
		await assertNotLastSuperAdmin(organizationId, existing)
	}

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

export async function setUserActive(
	userId: string,
	organizationId: string,
	isActive: boolean,
	ctx: AuditContext
) {
	// GUARDRAIL: as with setUserRole — nobody flips their own account. Blocks both directions, as
	// the route check it replaces did; self-reactivation is unreachable anyway, since an inactive
	// user cannot hold a session to make the call.
	if (userId === ctx.actorId) error(403, 'You cannot deactivate your own account.')

	const existing = await db.user.findFirst({
		where: { id: userId, organizationId }
	})
	if (!existing) error(404, 'User not found')

	// GUARDRAIL: don't deactivate the last active super admin.
	if (!isActive) {
		await assertNotLastSuperAdmin(organizationId, existing)
	}

	const updated = await db.user.update({
		where: { id: userId },
		data: { isActive }
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'User',
		entityId: userId,
		oldValue: { isActive: existing.isActive },
		newValue: { isActive }
	})

	return updated
}

// ─── Employee ↔ position assignment ───────────────────────────────────────────

export async function listAssignableEmployees(organizationId: string) {
	const employees = await db.employee.findMany({
		where: { organizationId },
		select: {
			id: true,
			firstName: true,
			lastName: true,
			jobTitle: true,
			employmentStatus: true,
			positionId: true,
			position: { select: { title: true } },
			department: { select: { name: true } }
		},
		orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
	})

	return employees.map((e) => ({
		id: e.id,
		name: `${e.lastName}, ${e.firstName}`,
		jobTitle: e.jobTitle,
		employmentStatus: e.employmentStatus,
		positionId: e.positionId,
		positionTitle: e.position?.title ?? null,
		departmentName: e.department?.name ?? null
	}))
}

export async function assignEmployeePosition(
	employeeId: string,
	organizationId: string,
	positionId: string | null,
	ctx: AuditContext
) {
	const employee = await db.employee.findFirst({
		where: { id: employeeId, organizationId },
		select: { id: true, positionId: true }
	})
	if (!employee) error(404, 'Employee not found')

	// If a position is given, it must belong to the same organization.
	if (positionId) {
		const position = await db.position.findFirst({
			where: { id: positionId, organizationId },
			select: { id: true }
		})
		if (!position) error(404, 'Position not found')
	}

	const updated = await db.employee.update({
		where: { id: employeeId },
		data: { positionId }
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Employee',
		entityId: employeeId,
		oldValue: { positionId: employee.positionId },
		newValue: { positionId }
	})

	return updated
}

// ─── Reporting hierarchy (org chart) ──────────────────────────────────────────

// Flat list of employees with their manager link, for building the reporting
// tree client-side. Only ACTIVE-org employees are surfaced.
export async function getReportingNodes(organizationId: string) {
	const employees = await db.employee.findMany({
		where: { organizationId },
		select: {
			id: true,
			firstName: true,
			lastName: true,
			jobTitle: true,
			reportsToId: true,
			employmentStatus: true,
			department: { select: { name: true } },
			position: { select: { title: true } }
		},
		orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
	})

	return employees.map((e) => ({
		id: e.id,
		name: `${e.firstName} ${e.lastName}`,
		jobTitle: e.jobTitle,
		reportsToId: e.reportsToId,
		employmentStatus: e.employmentStatus,
		departmentName: e.department?.name ?? null,
		positionTitle: e.position?.title ?? null
	}))
}
