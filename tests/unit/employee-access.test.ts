import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'
import { ROLE_HIERARCHY, CAPABILITIES } from '$lib/rbac'

/**
 * #228 — object-level scoping for employee records.
 *
 * The original guard was `requireMinRole('MANAGER')` + `if (!can(role,'MANAGE_HR'))`, which is an
 * empty set: MANAGER ranks level with HR_ADMIN *and* holds MANAGE_HR. It read as a restriction and
 * never ran, so every MANAGER could read and modify every employee in the tenant. These tests pin
 * both the capability split and the resulting rule.
 */

const { dbMock, listReportIdsFor } = vi.hoisted(() => ({
	listReportIdsFor: vi.fn(),
	dbMock: {
		employee: { findUnique: vi.fn(), findFirst: vi.fn() },
		branch: { findMany: vi.fn() }
	}
}))

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/services/supervisors', () => ({ listReportIdsFor }))

const { canTouchEmployee, assertCanTouchEmployee } =
	await import('$lib/server/services/employee-access')

const actor = (role: Role) => ({ id: 'user1', role, organizationId: 'org1' })
/** The manager's own employee record. */
const SELF = { id: 'mgr-emp' }

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.employee.findUnique.mockResolvedValue(SELF)
	listReportIdsFor.mockResolvedValue([])
	dbMock.branch.findMany.mockResolvedValue([])
	dbMock.employee.findFirst.mockResolvedValue({ branchId: null })
})

describe('the capability split this fix depends on (#228)', () => {
	it('MANAGE_HR cannot express "real HR" — it holds MANAGER, who also clears the rank gate', () => {
		const clearsManagerFloor = Object.entries(ROLE_HIERARCHY)
			.filter(([, rank]) => rank >= ROLE_HIERARCHY.MANAGER)
			.map(([role]) => role)
			.sort()
		// Identical sets ⇒ `requireMinRole('MANAGER')` + `!can(MANAGE_HR)` is unreachable.
		expect([...CAPABILITIES.MANAGE_HR].sort()).toEqual(clearsManagerFloor)
	})

	it('ADMINISTER_HR_ORGWIDE is the one that actually excludes MANAGER', () => {
		expect(CAPABILITIES.ADMINISTER_HR_ORGWIDE).not.toContain('MANAGER')
		expect([...CAPABILITIES.ADMINISTER_HR_ORGWIDE].sort()).toEqual([
			'CEO',
			'HR_ADMIN',
			'SUPER_ADMIN'
		])
	})
})

describe('canTouchEmployee (#228)', () => {
	it('lets HR_ADMIN reach anyone without even looking up a team', async () => {
		expect(await canTouchEmployee(actor('HR_ADMIN'), 'stranger')).toBe(true)
		expect(dbMock.employee.findUnique).not.toHaveBeenCalled()
	})

	it('lets CEO and SUPER_ADMIN reach anyone', async () => {
		expect(await canTouchEmployee(actor('CEO'), 'stranger')).toBe(true)
		expect(await canTouchEmployee(actor('SUPER_ADMIN'), 'stranger')).toBe(true)
	})

	it('refuses a MANAGER on an employee who is neither their report nor in their branch', async () => {
		expect(await canTouchEmployee(actor('MANAGER'), 'stranger')).toBe(false)
	})

	it('allows a MANAGER on their own record', async () => {
		expect(await canTouchEmployee(actor('MANAGER'), SELF.id)).toBe(true)
	})

	it('allows a MANAGER on a direct or additional report (#176)', async () => {
		listReportIdsFor.mockResolvedValue(['report1'])
		expect(await canTouchEmployee(actor('MANAGER'), 'report1')).toBe(true)
	})

	it('allows a MANAGER on someone in a branch they manage', async () => {
		dbMock.branch.findMany.mockResolvedValue([{ id: 'br1' }])
		dbMock.employee.findFirst.mockResolvedValue({ branchId: 'br1' })
		expect(await canTouchEmployee(actor('MANAGER'), 'crew1')).toBe(true)
	})

	it('refuses a report who belongs to another organization', async () => {
		// createEmployee takes reportsToId as given, so a cross-tenant report row is writable.
		// The relationship must not survive the org filter.
		listReportIdsFor.mockResolvedValue(['report1'])
		dbMock.employee.findFirst.mockResolvedValue(null)
		expect(await canTouchEmployee(actor('MANAGER'), 'report1')).toBe(false)
	})

	it('refuses a MANAGER on someone in a branch they do NOT manage', async () => {
		dbMock.branch.findMany.mockResolvedValue([{ id: 'br1' }])
		dbMock.employee.findFirst.mockResolvedValue({ branchId: 'br2' })
		expect(await canTouchEmployee(actor('MANAGER'), 'crew2')).toBe(false)
	})

	it('fails closed when the actor has no employee record of their own', async () => {
		dbMock.employee.findUnique.mockResolvedValue(null)
		expect(await canTouchEmployee(actor('MANAGER'), 'anyone')).toBe(false)
	})
})

describe('assertCanTouchEmployee (#228)', () => {
	it('throws 403 rather than 404 — the record exists, the actor just cannot have it', async () => {
		await expect(assertCanTouchEmployee(actor('MANAGER'), 'stranger')).rejects.toMatchObject({
			status: 403
		})
	})

	it('resolves quietly for an allowed pairing', async () => {
		listReportIdsFor.mockResolvedValue(['report1'])
		await expect(assertCanTouchEmployee(actor('MANAGER'), 'report1')).resolves.toBeUndefined()
	})
})
