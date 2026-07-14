import { error } from '@sveltejs/kit'
import type { Role } from '@prisma/client'

export function requireRole(userRole: Role, ...allowedRoles: Role[]): void {
	if (!allowedRoles.includes(userRole)) {
		error(403, 'Insufficient permissions')
	}
}

// The hierarchy only ranks the HR ladder (Employee → Manager → HR → Super Admin).
// PAYROLL_OFFICER and FINANCE are specialised roles that sit off the ladder — they
// hold no HR/manager authority, so they rank at 0 here and gain payroll access via
// the capability helpers below instead of via requireMinRole.
export const ROLE_HIERARCHY: Record<Role, number> = {
	EMPLOYEE: 0,
	FINANCE: 0,
	PAYROLL_OFFICER: 0,
	MANAGER: 1,
	HR_ADMIN: 2,
	SUPER_ADMIN: 3
}

export function requireMinRole(userRole: Role, minimumRole: Role): void {
	if (ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[minimumRole]) {
		error(403, 'Insufficient permissions')
	}
}

// ─── Payroll capabilities ─────────────────────────────────────────────────────
// Payroll access does not follow the HR ladder: a Payroll Officer runs payroll
// without full HR access, and Finance can read payroll reports only.

// Manage payroll (periods, runs, loans, cash advances, calculator).
export const PAYROLL_MANAGE_ROLES: Role[] = ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER']
// View payroll reports (adds read-only Finance).
export const PAYROLL_REPORT_ROLES: Role[] = [
	'SUPER_ADMIN',
	'HR_ADMIN',
	'PAYROLL_OFFICER',
	'FINANCE'
]

export function canManagePayroll(role: Role): boolean {
	return PAYROLL_MANAGE_ROLES.includes(role)
}

export function canViewPayrollReports(role: Role): boolean {
	return PAYROLL_REPORT_ROLES.includes(role)
}

export function requirePayrollManage(role: Role): void {
	if (!canManagePayroll(role)) error(403, 'Insufficient permissions')
}

export function requirePayrollReports(role: Role): void {
	if (!canViewPayrollReports(role)) error(403, 'Insufficient permissions')
}
