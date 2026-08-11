import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'

/**
 * #282 §3-C — `PATCH /api/v1/leave/[id]`.
 *
 * The override branch read `requireAnyMinRole(user.roles,'HR_ADMIN')` and 403'd with
 * "override-approve requires HR_ADMIN or higher" — a false message, because MANAGER clears that
 * floor (#133). `override-approve` bypasses the approval chain outright, so every manager could
 * skip it.
 *
 * Narrowed to `ADMINISTER_HR_ORGWIDE` (HR_ADMIN / CEO / SUPER_ADMIN). This is a WHAT question, not
 * a WHOSE one: overriding a chain is an authority level, not a data scope.
 */

const { reviewLeaveRequest } = vi.hoisted(() => ({ reviewLeaveRequest: vi.fn() }))
vi.mock('$lib/server/services/leave', () => ({ reviewLeaveRequest }))

const { PATCH } = await import('../../src/routes/api/v1/leave/[id]/+server')

const event = (roles: Role[], action: string) =>
	({
		locals: { user: { id: 'user-actor', organizationId: 'org1', roles } },
		params: { id: 'req1' },
		request: { json: async () => ({ action, note: 'x' }) },
		getClientAddress: () => '127.0.0.1'
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	}) as any

beforeEach(() => {
	vi.clearAllMocks()
	reviewLeaveRequest.mockResolvedValue({ id: 'req1', status: 'APPROVED' })
})

describe('override-approve is org-wide HR only (#282 §3-C)', () => {
	it('403s a MANAGER on override-approve', async () => {
		const res = await PATCH(event(['MANAGER'], 'override-approve'))
		expect(res.status).toBe(403)
		// The point of the fix is that the chain is not bypassed — assert the service never ran.
		expect(reviewLeaveRequest).not.toHaveBeenCalled()
	})

	it('lets HR_ADMIN, CEO and SUPER_ADMIN override', async () => {
		for (const role of ['HR_ADMIN', 'CEO', 'SUPER_ADMIN'] as const) {
			const res = await PATCH(event([role], 'override-approve'))
			expect(res.status).toBe(200)
		}
		expect(reviewLeaveRequest).toHaveBeenCalledTimes(3)
	})

	// The other half of the fix: it must not have over-narrowed the ordinary path. A MANAGER
	// approving through the chain is exactly what the route is for.
	it('still lets a MANAGER approve and reject normally', async () => {
		expect((await PATCH(event(['MANAGER'], 'approve'))).status).toBe(200)
		const rejected = await PATCH({
			...event(['MANAGER'], 'reject'),
			request: { json: async () => ({ action: 'reject', rejectionReason: 'no' }) }
		})
		expect(rejected.status).toBe(200)
	})
})
