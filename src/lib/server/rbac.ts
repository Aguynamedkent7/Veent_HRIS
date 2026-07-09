import { error } from '@sveltejs/kit'
import type { Role } from '@prisma/client'

export function requireRole(userRole: Role, ...allowedRoles: Role[]): void {
	if (!allowedRoles.includes(userRole)) {
		error(403, 'Insufficient permissions')
	}
}

export const ROLE_HIERARCHY: Record<Role, number> = {
	EMPLOYEE: 0,
	MANAGER: 1,
	HR_ADMIN: 2,
	SUPER_ADMIN: 3
}

export function requireMinRole(userRole: Role, minimumRole: Role): void {
	if (ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[minimumRole]) {
		error(403, 'Insufficient permissions')
	}
}
