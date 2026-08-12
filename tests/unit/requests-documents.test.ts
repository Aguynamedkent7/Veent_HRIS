import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #283/D11 — clearing a document's sign-off clears `verifiedAt` ONLY.
 *
 * VALIDATE found the F3 bar bypassable in one click: `actions.verifyDoc` accepts verified=false,
 * and this writer used to null `verifiedById` as well. A barred approver un-verified their own
 * sign-off, decided the request, and the selfVerifiedEvidence audit marker never fired — with
 * AC-19 passing the whole time, because the guard was live and the field it reads had been erased.
 * "The test is green" and "the guard works" are different claims.
 *
 * The premise that makes the fix safe: nothing in src/ reads `verifiedById` for "is it verified" —
 * all six consumers key on `verifiedAt`. So the column can change meaning from "who currently
 * verifies" to "who last signed off" without touching any of them.
 */

const { dbMock } = vi.hoisted(() => ({
	dbMock: {
		requestDocument: { findFirst: vi.fn(), update: vi.fn() }
	}
}))
vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))
vi.mock('$lib/server/storage', () => ({
	saveFile: vi.fn(),
	deleteStoredFile: vi.fn(),
	isAllowedType: vi.fn(),
	contentMatchesType: vi.fn(),
	MAX_UPLOAD_BYTES: 1
}))

const { setRequestDocumentVerified } = await import('$lib/server/services/requests/documents')

const CTX = {
	organizationId: 'org1',
	actorId: 'user-signer',
	actorRoles: ['APPROVER' as const],
	ipAddress: 'test'
}

beforeEach(() => {
	vi.clearAllMocks()
	dbMock.requestDocument.findFirst.mockResolvedValue({
		id: 'doc1',
		requestId: 'req1',
		storageKey: 'k',
		request: { id: 'req1', employeeId: 'emp-owner' }
	})
	dbMock.requestDocument.update.mockResolvedValue({ id: 'doc1' })
})

describe('setRequestDocumentVerified (#283/D11)', () => {
	it('records the signer on a verify', async () => {
		await setRequestDocumentVerified('doc1', 'org1', true, CTX)

		expect(dbMock.requestDocument.update).toHaveBeenCalledWith({
			where: { id: 'doc1' },
			data: { verifiedById: 'user-signer', verifiedAt: expect.any(Date) }
		})
	})

	// The whole of AC-28's service half. Asserting the exact `data` payload is the point: the bug
	// was one extra key in it, and any looser assertion passes with the key restored.
	it('clearing keeps verifiedById and nulls only verifiedAt (#283/AC-28)', async () => {
		await setRequestDocumentVerified('doc1', 'org1', false, CTX)

		expect(dbMock.requestDocument.update).toHaveBeenCalledWith({
			where: { id: 'doc1' },
			data: { verifiedAt: null }
		})
		expect(dbMock.requestDocument.update.mock.calls[0][0].data).not.toHaveProperty('verifiedById')
	})
})
