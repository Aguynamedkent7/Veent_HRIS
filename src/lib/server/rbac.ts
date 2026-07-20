import { error } from '@sveltejs/kit'
import type { Role } from '@prisma/client'
import { can, hasMinRole, CAPABILITIES, type Capability } from '$lib/rbac'

// The capability table itself lives in $lib/rbac so the sidebar can ask the same
// questions the server enforces. This module is the enforcement half: every helper
// here throws 403 rather than returning a boolean.
export { ROLE_HIERARCHY, CAPABILITIES, can, hasMinRole, type Capability } from '$lib/rbac'

/** Guard a route on a named capability — prefer this over spelling out role lists. */
export function requireCapability(userRole: Role, capability: Capability): void {
	if (!can(userRole, capability)) error(403, 'Insufficient permissions')
}

export function requireRole(userRole: Role, ...allowedRoles: Role[]): void {
	if (!allowedRoles.includes(userRole)) {
		error(403, 'Insufficient permissions')
	}
}

export function requireMinRole(userRole: Role, minimumRole: Role): void {
	if (!hasMinRole(userRole, minimumRole)) {
		error(403, 'Insufficient permissions')
	}
}

// ─── Payroll capabilities ─────────────────────────────────────────────────────
// Payroll access does not follow the HR ladder: a Payroll Officer runs payroll
// without full HR access, and Finance can read payroll reports only. These remain
// as named helpers because they read better at call sites than can(role, '…').

export const PAYROLL_MANAGE_ROLES: readonly Role[] = CAPABILITIES.MANAGE_PAYROLL
export const PAYROLL_REPORT_ROLES: readonly Role[] = CAPABILITIES.VIEW_PAYROLL_REPORTS

export function canManagePayroll(role: Role): boolean {
	return can(role, 'MANAGE_PAYROLL')
}

export function canViewPayrollReports(role: Role): boolean {
	return can(role, 'VIEW_PAYROLL_REPORTS')
}

export function requirePayrollManage(role: Role): void {
	requireCapability(role, 'MANAGE_PAYROLL')
}

export function requirePayrollReports(role: Role): void {
	requireCapability(role, 'VIEW_PAYROLL_REPORTS')
}
