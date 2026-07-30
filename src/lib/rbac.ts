import type { Role } from '@prisma/client'

/**
 * Single source of truth for "which roles may do what".
 *
 * Shared (not `$lib/server`) because the sidebar needs the same answers the server
 * enforces — a nav item that appears for a role the server rejects is its own bug.
 * This module only answers questions; `$lib/server/rbac` wraps it in the throwing
 * `require*` guards. Deciding here and enforcing there keeps one table authoritative.
 */

// The hierarchy only ranks the HR ladder (Employee → Manager/HR → Super Admin).
// FINANCE, PAYROLL_OFFICER, VERIFIER and APPROVER sit off the ladder — they hold no
// HR/manager authority, so they rank at 0 here and gain their access via the
// capability table below instead of via minimum-role checks.
export const ROLE_HIERARCHY: Record<Role, number> = {
	EMPLOYEE: 0,
	FINANCE: 0,
	PAYROLL_OFFICER: 0,
	VERIFIER: 0,
	APPROVER: 0,
	// MANAGER is on-branch HR for JoJo/Sweetleaf (#133), so it ranks level with HR_ADMIN
	// and clears every `requireMinRole('HR_ADMIN')` gate. CEO likewise mirrors HR_ADMIN.
	// None of the three clear the SUPER_ADMIN floor (e.g. payroll approval); the extra
	// authority CEO/HR_ADMIN hold over MANAGER lives in the capability table, not rank.
	MANAGER: 2,
	HR_ADMIN: 2,
	CEO: 2,
	SUPER_ADMIN: 3
}

export function hasMinRole(userRole: Role, minimumRole: Role): boolean {
	return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minimumRole]
}

/** Multi-role variant (#133): true if ANY of the user's roles clears the floor. */
export function hasAnyMinRole(userRoles: Role[], minimumRole: Role): boolean {
	return userRoles.some((r) => hasMinRole(r, minimumRole))
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
	MANAGE_HR: ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN', 'CEO'],
	/** The manager ladder: sees a team, approves timesheets. */
	VIEW_TEAM: ['MANAGER', 'HR_ADMIN', 'SUPER_ADMIN', 'CEO'],
	/** System administration: payroll config, unlocking locked days. Super Admin only. */
	ADMINISTER_SYSTEM: ['SUPER_ADMIN'],
	/** Changing a user's role — CEO exclusively (#132), across every tenant. */
	MANAGE_USER_ROLES: ['CEO'],
	/** Reaches the approvals surface — HR ladder, Payroll stage owner, and sign-off roles. */
	APPROVE_REQUESTS: [
		'MANAGER',
		'HR_ADMIN',
		'SUPER_ADMIN',
		'PAYROLL_OFFICER',
		'CEO',
		'VERIFIER',
		'APPROVER'
	],
	/** Verifier stage sign-off (#133) — the middle of the maker→verifier→approver chain. */
	VERIFY_REQUESTS: ['VERIFIER'],
	/** Approver stage sign-off (#133) — the final gate of the approval chain. */
	APPROVE_SIGNOFF: ['APPROVER'],
	/**
	 * Final sign-off on anything financial — payroll runs today, and any future
	 * money movement (disbursements, cash advances, loans). The CEO and Super Admin
	 * are the only approvers for finance (#174); the generic APPROVER handles HR
	 * requests (leave, OT) but never signs off money.
	 */
	APPROVE_FINANCE: ['CEO', 'SUPER_ADMIN'],
	/**
	 * Statutory rate tables (#220). Edit directly + confirm/reject proposals — the finance
	 * authority the CEO and Super Admin already hold over payroll money.
	 */
	MANAGE_STATUTORY_RATES: ['CEO', 'SUPER_ADMIN'],
	/** Submit a statutory rate change for CEO approval — HR maintains the tables, CEO signs off. */
	PROPOSE_STATUTORY_RATES: ['HR_ADMIN'],
	/** Runs payroll: periods, runs, loans, cash advances, calculator. */
	MANAGE_PAYROLL: ['MANAGER', 'SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'CEO'],
	/** Reads payroll reports — adds read-only Finance. */
	VIEW_PAYROLL_REPORTS: ['MANAGER', 'SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'FINANCE', 'CEO']
} as const satisfies Record<string, readonly Role[]>

export type Capability = keyof typeof CAPABILITIES

export function can(userRole: Role, capability: Capability): boolean {
	return (CAPABILITIES[capability] as readonly Role[]).includes(userRole)
}

/**
 * Multi-role variant (#133): true if ANY of the user's roles holds the capability.
 * Lets a [MANAGER, VERIFIER] user carry both HR authority and verifier sign-off.
 */
export function canAny(userRoles: Role[], capability: Capability): boolean {
	return userRoles.some((r) => can(r, capability))
}
