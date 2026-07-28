import { describe, it, expect, vi } from 'vitest'

/**
 * #141 announcement byline. The name lives on Employee, not on the User the announcement
 * points at, so the byline is a two-hop join with two legitimate ways to come up short:
 * an author account with no employee record (the seeded CEO has none), and an announcement
 * with no author at all (`Announcement.authorId` is nullable).
 */

vi.mock('$lib/server/db', () => ({ db: {} }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('$lib/server/services/notifications', () => ({ notifyMany: vi.fn() }))

const { announcementAuthorName } = await import('$lib/server/services/announcements')

describe('announcementAuthorName', () => {
	it('uses the employee’s full name', () => {
		expect(
			announcementAuthorName({
				email: 'hr@veent.ph',
				employee: { firstName: 'Hannah', lastName: 'HR' }
			})
		).toBe('Hannah HR')
	})

	it('falls back to the email local-part when the account has no employee record', () => {
		expect(announcementAuthorName({ email: 'ceo@veent.ph', employee: null })).toBe('ceo')
	})

	it('returns null when the announcement has no author', () => {
		// Callers drop the line entirely rather than render a dangling em dash.
		expect(announcementAuthorName(null)).toBeNull()
	})

	it('returns null rather than an empty byline for a malformed email', () => {
		expect(announcementAuthorName({ email: '@veent.ph', employee: null })).toBeNull()
	})
})
