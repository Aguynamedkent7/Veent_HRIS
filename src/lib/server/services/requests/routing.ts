import type { RequestType, Role } from '@prisma/client'

// A resolved approval stage: either the employee's direct supervisor (reportsTo)
// or a named role group. `resolveChain` turns these into ApprovalStep rows.
export type StageSpec = { kind: 'SUPERVISOR' } | { kind: 'ROLE'; role: Role }

// Default per-type approval chains (spec §5: Employee → Supervisor → HR → Payroll).
// Data-driven so routing stays configurable (FR-059); future work can override this
// per-org/department. OT and Holiday-work reach Payroll because they change pay.
export const DEFAULT_ROUTING: Record<RequestType, StageSpec[]> = {
	LEAVE: [{ kind: 'SUPERVISOR' }, { kind: 'ROLE', role: 'HR_ADMIN' }],
	OVERTIME: [
		{ kind: 'SUPERVISOR' },
		{ kind: 'ROLE', role: 'HR_ADMIN' },
		{ kind: 'ROLE', role: 'PAYROLL_OFFICER' }
	],
	UNDERTIME: [{ kind: 'SUPERVISOR' }, { kind: 'ROLE', role: 'HR_ADMIN' }],
	OFFICIAL_BUSINESS: [{ kind: 'SUPERVISOR' }, { kind: 'ROLE', role: 'HR_ADMIN' }],
	REST_DAY_WORK: [
		{ kind: 'SUPERVISOR' },
		{ kind: 'ROLE', role: 'HR_ADMIN' },
		{ kind: 'ROLE', role: 'PAYROLL_OFFICER' }
	],
	HOLIDAY_WORK: [
		{ kind: 'SUPERVISOR' },
		{ kind: 'ROLE', role: 'HR_ADMIN' },
		{ kind: 'ROLE', role: 'PAYROLL_OFFICER' }
	],
	INFO_UPDATE: [{ kind: 'ROLE', role: 'HR_ADMIN' }]
}

// Resolve a type's chain into ApprovalStep-shaped rows. A SUPERVISOR stage with no
// supervisor on the employee is dropped (no one to route to); if that leaves an
// empty chain, the caller should treat the request as needing HR only.
export function resolveChain(
	type: RequestType,
	opts: { hasSupervisor: boolean }
): { stageIndex: number; stageKind: 'SUPERVISOR' | 'ROLE'; role: Role | null }[] {
	const specs = DEFAULT_ROUTING[type].filter((s) => s.kind !== 'SUPERVISOR' || opts.hasSupervisor)
	return specs.map((s, i) => ({
		stageIndex: i,
		stageKind: s.kind,
		role: s.kind === 'ROLE' ? s.role : null
	}))
}
