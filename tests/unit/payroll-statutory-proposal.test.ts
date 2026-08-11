import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuditContext } from '$lib/server/services/types'
import type { StatutoryRateInput } from '$lib/server/services/payroll/statutory-rates'

/**
 * #220 HR-propose / CEO-confirm lifecycle. The DB and audit are mocked so this stays in the fast
 * unit suite. Rules under test:
 *  - propose records a PENDING proposal and NEVER touches the live StatutoryRateConfig.
 *  - confirm applies the proposal's payload to the live config and marks it APPLIED.
 *  - reject marks the proposal REJECTED and leaves the live config untouched (the change is discarded).
 *  - confirm/reject of a non-pending proposal is rejected.
 */

const { dbMock } = vi.hoisted(() => {
	const db = {
		statutoryRateProposal: {
			create: vi.fn(),
			findFirst: vi.fn(),
			findMany: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
			findUniqueOrThrow: vi.fn()
		},
		statutoryRateConfig: { findUnique: vi.fn(), upsert: vi.fn() },
		$transaction: vi.fn()
	}
	// confirmProposal runs inside a $transaction; the callback gets the same mock as the tx client.
	db.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db))
	return { dbMock: db }
})

vi.mock('$lib/server/db', () => ({ db: dbMock }))
vi.mock('$lib/server/audit', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }))

const { proposeStatutoryRates, confirmProposal, rejectProposal } =
	await import('$lib/server/services/payroll/statutory-rates')

const HR: AuditContext = {
	organizationId: 'org1',
	actorId: 'hr1',
	actorRoles: ['HR_ADMIN'],
	ipAddress: 't'
}
const CEO: AuditContext = {
	organizationId: 'org1',
	actorId: 'ceo1',
	actorRoles: ['CEO'],
	ipAddress: 't'
}

// A valid full payload (passes statutoryRateInputSchema): scalars set, brackets cleared.
const PAYLOAD: StatutoryRateInput = {
	philhealthRate: 0.04,
	philhealthFloor: 10000,
	philhealthCeiling: 100000,
	pagibigRate: 0.02,
	pagibigCap: 100,
	sssBrackets: null,
	taxBrackets: null
}

beforeEach(() => vi.clearAllMocks())

describe('propose', () => {
	it('creates a PENDING proposal and never touches the live config', async () => {
		dbMock.statutoryRateProposal.create.mockResolvedValue({ id: 'prop1' })

		await proposeStatutoryRates('org1', PAYLOAD, HR)

		expect(dbMock.statutoryRateProposal.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					organizationId: 'org1',
					proposedById: 'hr1',
					payload: PAYLOAD
				})
			})
		)
		// The whole point: live rates are unchanged until a confirm.
		expect(dbMock.statutoryRateConfig.upsert).not.toHaveBeenCalled()
	})
})

describe('confirm', () => {
	it('atomically claims the proposal, applies the payload, and marks it APPLIED', async () => {
		// The status-guarded claim succeeds (one row moved PENDING → APPLIED).
		dbMock.statutoryRateProposal.updateMany.mockResolvedValue({ count: 1 })
		dbMock.statutoryRateProposal.findUniqueOrThrow.mockResolvedValue({
			id: 'prop1',
			organizationId: 'org1',
			proposedById: 'hr1',
			status: 'APPLIED',
			payload: PAYLOAD
		})
		dbMock.statutoryRateConfig.findUnique.mockResolvedValue(null)
		dbMock.statutoryRateConfig.upsert.mockResolvedValue({ id: 'cfg1' })

		await confirmProposal('org1', 'prop1', CEO)

		// Claim is status-guarded (only a PENDING row is moved) and stamps the confirmer.
		expect(dbMock.statutoryRateProposal.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'prop1', organizationId: 'org1', status: 'PENDING' },
				data: expect.objectContaining({ status: 'APPLIED', decidedById: 'ceo1' })
			})
		)
		// Payload reached the live config.
		expect(dbMock.statutoryRateConfig.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { organizationId: 'org1' },
				create: expect.objectContaining({ philhealthRate: 0.04, pagibigCap: 100 })
			})
		)
	})

	it('rejects a proposal that is not pending / not found (nothing claimed → no apply)', async () => {
		dbMock.statutoryRateProposal.updateMany.mockResolvedValue({ count: 0 })
		await expect(confirmProposal('org1', 'missing', CEO)).rejects.toThrow()
		expect(dbMock.statutoryRateConfig.upsert).not.toHaveBeenCalled()
	})
})

describe('reject', () => {
	it('marks the proposal REJECTED and discards it (live config untouched)', async () => {
		dbMock.statutoryRateProposal.findFirst.mockResolvedValue({
			id: 'prop1',
			organizationId: 'org1',
			proposedById: 'hr1',
			status: 'PENDING'
		})
		dbMock.statutoryRateProposal.update.mockResolvedValue({ id: 'prop1', status: 'REJECTED' })

		await rejectProposal('org1', 'prop1', CEO)

		expect(dbMock.statutoryRateProposal.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'prop1' },
				data: expect.objectContaining({ status: 'REJECTED', decidedById: 'ceo1' })
			})
		)
		expect(dbMock.statutoryRateConfig.upsert).not.toHaveBeenCalled()
	})
})
