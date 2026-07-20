import type { Role } from '@prisma/client'

/**
 * Single source of truth for "which roles may do what".
 *
 * Shared (not `$lib/server`) because the sidebar needs the same answers the server
 * enforces — a nav item that appears for a role the server rejects is its own bug.
 * This module only answers questions; `$lib/server/rbac` wraps it in the throwing
 * `require*` guards. Deciding here and enforcing there keeps one table authoritative.
 */

// The hierarchy only ranks the HR ladder (Employee → Manager → HR → Super Admin).
// PAYROLL_OFFICER and FINANCE are specialised roles that sit off the ladder — they
// hold no HR/manager authority, so they rank at 0 here and gain payroll access via
// the capability table below instead of via minimum-role checks.
export const ROLE_HIERARCHY: Record<Role, number> = {
	EMPLOYEE: 0,
	FINANCE: 0,
	PAYROLL_OFFICER: 0,
	MANAGER: 1,
	HR_ADMIN: 2,
	SUPER_ADMIN: 3
}

export function hasMinRole(userRole: Role, minimumRole: Role): boolean {
	return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minimumRole]
}

/**
 * Capability → the roles that hold it.
 *
 * Keyed by capability rather than by role: a capability's holders are what call sites
 * actually ask about, and adding a role then means answering "does it get this?" once
 * per capability instead of hunting every `includes([...])` in the codebase.
 *
 * Membership is listed explicitly even where it mirrors the ladder. For an
 * authorization table, being able to read off exactly who holds a capability beats
 * deriving it — and it means a newly added Role grants nothing until someone decides
 * it should, rather than silently inheriting through a comparison or an `else` branch.
 */
export const CAPABILITIES = {
	/** Org-wide HR administration: rosters, settings, attendance, disbursement reveal. */
	MANAGE_HR: ['HR_ADMIN', 'SUPER_ADMIN'],
	/** The manager ladder: sees a team, approves timesheets. */
	VIEW_TEAM: ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'],
	/** System administration: role assignment, payroll config, unlocking locked days. */
	ADMINISTER_SYSTEM: ['SUPER_ADMIN'],
	/** Reaches the approvals surface — manager ladder plus the Payroll stage owner. */
	APPROVE_REQUESTS: ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN', 'PAYROLL_OFFICER'],
	/** Runs payroll: periods, runs, loans, cash advances, calculator. */
	MANAGE_PAYROLL: ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER'],
	/** Reads payroll reports — adds read-only Finance. */
	VIEW_PAYROLL_REPORTS: ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'FINANCE']
} as const satisfies Record<string, readonly Role[]>

export type Capability = keyof typeof CAPABILITIES

export function can(userRole: Role, capability: Capability): boolean {
	return (CAPABILITIES[capability] as readonly Role[]).includes(userRole)
}
