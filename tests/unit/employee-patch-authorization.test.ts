import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'

/**
 * #263 — the v1 PATCH wrote two privilege-relevant columns with none of the routing its UI twin has.
 * `reportsToId` re-parents a reporting line, which decides who approves that employee's timesheets
 * and leave; it reached `updateEmployee`, which has no `proposeIfRequired` call at all, so a MANAGER
 * made the change alone while `?/promote` needed a second person. `employmentStatus` reached the
 * same writer as a bare column, with none of `offboardEmployee`'s `endDate` or
 * `User.isActive = false` — so an "offboarded" employee kept a live session. The plausible-looking
 * wrong fix for the first is a `requireMinRole('HR_ADMIN')` gate, which admits MANAGER
 * (`ROLE_HIERARCHY` ranks them level) and so describes an empty set.
 *
 * A fourth thing this file pins is what the route will not even parse. `updateSchema` was a plain
 * `z.object`, so zod stripped unknown keys and a PATCH naming a field it did not know was a 200 that
 * silently discarded it — the same silent-strip trap the two gaps above were each fixed loudly to
 * avoid (#264). Note the ordering the cases below depend on: `.strict()` is evaluated inside
 * `safeParse`, so an unknown key is refused before the handler destructures anything, and a body
 * carrying both an unknown key and `employmentStatus` gets the generic parse 400 rather than the
 * offboard pointer. That is intended — such a body used to succeed with a silent partial write.
 */

const { dbMock, txMock, listReportIdsFor } = vi.hoisted(() => {
	const txMock = {
		employeeCompensation: { create: vi.fn(), findFirst: vi.fn() },
		employeeEmploymentType: { create: vi.fn(), findFirst: vi.fn() },
		employee: { update: vi.fn() }
	}
	return {
		txMock,
		listReportIdsFor: vi.fn(),
		dbMock: {
			employee: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
			employeeCompensation: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
			employeeEmploymentType: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
			payrollRun: { findFirst: vi.fn() },
			position: { findFirst: vi.fn() },
			branch: { findMany: vi.fn() },
			$transaction: vi.fn(async (fn: (tx: typeof txMock) => unknown) => fn(txMock))
		}
	}
})

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/services/notifications', () => ({
	notify: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('$lib/server/services/supervisors', () => ({
	listReportIdsFor,
	// A factory mock replaces the whole module, so every export its importers pull must be present.
	listSupervisorsFor: vi.fn().mockResolvedValue([]),
	setSupervisors: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('$lib/server/services/action-proposals', () => ({
	createProposal: vi.fn().mockResolvedValue({ id: 'prop-1' }),
	// Imported by employees.ts for the audited reveal — unused here, but a factory mock replaces the
	// whole module, so omitting it makes the import undefined rather than absent.
	assertMayConfirmProposal: vi.fn()
}))

const { PATCH } = await import('../../src/routes/api/v1/employees/[id]/+server')

const ORG = 'org1'
const ACTOR_USER = 'user-actor'
const ACTOR_EMP = 'emp-actor'
const TARGET = 'emp1'

/** The target 201 file — someone else's, and a direct report of the actor. */
const EMP = {
	id: TARGET,
	userId: 'user-target',
	basicMonthlySalary: 30000,
	rateType: 'MONTHLY' as const,
	employmentType: 'REGULAR' as const,
	employmentStatus: 'ACTIVE' as const,
	startDate: new Date('2024-01-01'),
	positionId: null,
	jobTitle: 'Crew',
	reportsToId: ACTOR_EMP,
	branchId: null
}

const patch = (body: unknown, roles: Role[] = ['HR_ADMIN'], actorUser = ACTOR_USER) =>
	PATCH({
		locals: { user: { id: actorUser, organizationId: ORG, role: roles[0], roles } },
		params: { id: TARGET },
		request: { json: async () => body }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any)

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.employee.findFirst.mockResolvedValue(EMP)
	dbMock.employee.update.mockResolvedValue(EMP)
	// `canTouchEmployee` for a bare MANAGER: their own record, and a reporting line holding the target.
	dbMock.employee.findUnique.mockResolvedValue({ id: ACTOR_EMP })
	listReportIdsFor.mockResolvedValue([TARGET])
	dbMock.branch.findMany.mockResolvedValue([])
	// getEmployee's heal-on-read has no history to reconcile.
	dbMock.employeeCompensation.findMany.mockResolvedValue([])
	dbMock.employeeEmploymentType.findMany.mockResolvedValue([])
	dbMock.employeeCompensation.findFirst.mockResolvedValue(null)
	dbMock.employeeEmploymentType.findFirst.mockResolvedValue(null)
	dbMock.payrollRun.findFirst.mockResolvedValue(null)
	txMock.employeeCompensation.findFirst.mockResolvedValue(null)
	txMock.employeeEmploymentType.findFirst.mockResolvedValue(null)
})

describe('unknown fields are refused, not stripped (#264)', () => {
	it('refuses an unrecognized key with a 400 instead of a silent 200', async () => {
		const res = await patch({ nickname: 'Bibo' })

		expect(res.status).toBe(400)
		expect(dbMock.employee.update).not.toHaveBeenCalled()
		// The parse gate precedes every query — the same property the employmentStatus rejection has.
		expect(dbMock.employee.findFirst).not.toHaveBeenCalled()
	})

	it('refuses the whole body when an unknown key rides along with a known one', async () => {
		const res = await patch({ contactPhone: '0917', nickname: 'Bibo' })

		expect(res.status).toBe(400)
		// `.strict()` is not a partial apply: the known half does not land either.
		expect(dbMock.employee.update).not.toHaveBeenCalled()
	})
})
