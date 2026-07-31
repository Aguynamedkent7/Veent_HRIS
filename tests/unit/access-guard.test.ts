import { describe, it, expect } from 'vitest'
import { isSessionBlocked } from '../../src/lib/server/access-guard'

// #193 — offboarded employees must lose access. Offboarding sets User.isActive = false
// (offboardEmployee / finalizeSeparation); the auth hook then blocks the session via this
// predicate. This locks that invariant so a future change can't silently let a deactivated
// (offboarded) login back in.
describe('isSessionBlocked (#193)', () => {
	it('blocks a deactivated (offboarded) user', () => {
		expect(isSessionBlocked({ isActive: false })).toBe(true)
	})

	it('allows an active user', () => {
		expect(isSessionBlocked({ isActive: true })).toBe(false)
	})

	it('does nothing for an anonymous (no) session', () => {
		expect(isSessionBlocked(null)).toBe(false)
	})
})
