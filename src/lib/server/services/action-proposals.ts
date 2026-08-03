import { error } from '@sveltejs/kit'
import { Prisma, type ProposalDomain } from '@prisma/client'
import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { canAny, CAPABILITIES, type Capability } from '$lib/server/rbac'
import { notifyMany } from './notifications'
import type { AuditContext } from './types'

/**
 * Propose → confirm for pay writes that must not be unilateral (#224 Part 2, #243).
 *
 * Two situations funnel through one table, and they are NOT the same risk:
 *
 *   - **Self-action** — the initiator is the target (a CEO changing their own pay). The risk is
 *     self-dealing, so the confirmer must hold `APPROVE_FINANCE` (CEO / SUPER_ADMIN). An HR_ADMIN
 *     signing off the CEO's own raise would inverts the reporting line, which is the thing #224
 *     set out to prevent.
 *   - **On behalf of someone else** — a MANAGER proposing for one of their reports (#243). The
 *     risk is unilateral authority, not self-dealing, so `ADMINISTER_HR_ORGWIDE` (HR_ADMIN / CEO /
 *     SUPER_ADMIN) is enough — which is what #243 decided.
 *
 * The distinction is derived from initiator vs target, never stored, so a stale row cannot claim a
 * weaker confirmer than its own shape implies.
 *
 * Generalizes `StatutoryRateProposal` (#220) rather than inventing a second framework: same
 * status-guarded atomic claim, same "re-validate at apply time" trust boundary. The difference is
 * that #220 models two parties and this models three.
 */

/** Which capability a confirmer must hold, given whether the initiator is also the target. */
export function confirmerCapabilityFor(isSelfAction: boolean): Capability {
	return isSelfAction ? 'APPROVE_FINANCE' : 'ADMINISTER_HR_ORGWIDE'
}

/**
 * Deliberately capability-keyed, never a `requireMinRole` floor. `ROLE_HIERARCHY` ranks MANAGER
 * level with HR_ADMIN, so a rank floor would let a manager confirm the very proposals that exist
 * because managers must not act alone — the bug shape behind #228 and #243. MANAGER holds neither
 * capability, so it is excluded by construction.
 */
function assertMayConfirm(ctx: AuditContext, isSelfAction: boolean): void {
	const roles = ctx.actorRoles?.length ? ctx.actorRoles : [ctx.actorRole]
	if (!canAny(roles, confirmerCapabilityFor(isSelfAction))) {
		error(403, 'You are not authorized to confirm this proposal.')
	}
}

/** User ids in the org who could confirm a proposal of this shape, excluding the initiator. */
async function eligibleConfirmerIds(
	organizationId: string,
	initiatorId: string,
	isSelfAction: boolean
): Promise<string[]> {
	const roles = CAPABILITIES[confirmerCapabilityFor(isSelfAction)]
	const users = await db.user.findMany({
		where: {
			organizationId,
			isActive: true,
			role: { in: [...roles] },
			id: { not: initiatorId }
		},
		select: { id: true }
	})
	return users.map((u) => u.id)
}

/**
 * File a PENDING proposal. The payload is the writer's own input object, stored verbatim and
 * re-validated when it is applied.
 *
 * Refuses up front when nobody could ever confirm it (e.g. the initiator is the org's only
 * `APPROVE_FINANCE` holder). Writing an unconfirmable row instead would look like success to the
 * initiator and strand the change forever.
 */
export async function createProposal(
	organizationId: string,
	input: {
		targetEmployeeId: string
		targetUserId: string
		domain: ProposalDomain
		payload: unknown
	},
	ctx: AuditContext
) {
	const isSelfAction = input.targetUserId === ctx.actorId
	const confirmers = await eligibleConfirmerIds(organizationId, ctx.actorId, isSelfAction)
	if (confirmers.length === 0) {
		error(
			409,
			'This change needs a second authorized person to confirm it, and no one else in the organization can. Ask a Super Admin to make the change directly.'
		)
	}

	const proposal = await db.actionProposal.create({
		data: {
			organizationId,
			initiatorId: ctx.actorId,
			targetEmployeeId: input.targetEmployeeId,
			domain: input.domain,
			payload: input.payload as Prisma.InputJsonValue
		}
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'ActionProposal',
		entityId: proposal.id,
		newValue: {
			domain: input.domain,
			targetEmployeeId: input.targetEmployeeId,
			isSelfAction,
			payload: input.payload
		}
	})

	await notifyMany(
		confirmers,
		'A pay change is waiting for your confirmation.',
		'/approvals/proposals'
	)

	return proposal
}

/**
 * Claim a PENDING proposal and apply it.
 *
 * `apply` runs inside the same transaction as the claim, so if applying throws — including because
 * re-validation rejects a payload that has gone stale — the claim rolls back to PENDING rather than
 * burning the proposal.
 */
export async function confirmProposal(
	organizationId: string,
	proposalId: string,
	apply: (
		proposal: { targetEmployeeId: string; domain: ProposalDomain; payload: unknown },
		tx: Prisma.TransactionClient
	) => Promise<unknown>,
	ctx: AuditContext
) {
	const pending = await requirePending(organizationId, proposalId)
	assertMayConfirm(ctx, await isSelfAction(pending))

	// The initiator can never be the confirmer — the entire point of the table. Checked separately
	// from the capability so a CEO who holds APPROVE_FINANCE still cannot sign off their own filing.
	if (pending.initiatorId === ctx.actorId) {
		error(403, 'You cannot confirm a change you proposed yourself.')
	}

	const applied = await db.$transaction(async (tx) => {
		// Status-guarded claim: exactly one confirmer can move PENDING → APPLIED, so two racing
		// confirmations cannot both apply the change (the #220 pattern).
		const claim = await tx.actionProposal.updateMany({
			where: { id: proposalId, organizationId, status: 'PENDING' },
			data: { status: 'APPLIED', decidedById: ctx.actorId, decidedAt: new Date() }
		})
		if (claim.count === 0) error(404, 'Pending proposal not found')

		await apply(
			{
				targetEmployeeId: pending.targetEmployeeId,
				domain: pending.domain,
				payload: pending.payload
			},
			tx
		)
		return tx.actionProposal.findUniqueOrThrow({ where: { id: proposalId } })
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'ActionProposal',
		entityId: proposalId,
		oldValue: { status: 'PENDING' },
		newValue: { status: 'APPLIED', decidedById: ctx.actorId }
	})
	await notifyMany([pending.initiatorId], 'Your proposed pay change was confirmed and applied.')

	return applied
}

/** Reject a PENDING proposal. A reason is required so the initiator knows what to fix. */
export async function rejectProposal(
	organizationId: string,
	proposalId: string,
	note: string,
	ctx: AuditContext
) {
	if (!note.trim()) error(400, 'A reason is required to reject a proposal.')

	const pending = await requirePending(organizationId, proposalId)
	assertMayConfirm(ctx, await isSelfAction(pending))

	const claim = await db.actionProposal.updateMany({
		where: { id: proposalId, organizationId, status: 'PENDING' },
		data: {
			status: 'REJECTED',
			decidedById: ctx.actorId,
			decidedAt: new Date(),
			decisionNote: note
		}
	})
	if (claim.count === 0) error(404, 'Pending proposal not found')

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'ActionProposal',
		entityId: proposalId,
		oldValue: { status: 'PENDING' },
		newValue: { status: 'REJECTED', decidedById: ctx.actorId, note }
	})
	await notifyMany([pending.initiatorId], `Your proposed pay change was returned: ${note}`)

	return { id: proposalId }
}

export function listPendingProposals(organizationId: string) {
	return db.actionProposal.findMany({
		where: { organizationId, status: 'PENDING' },
		include: {
			target: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } }
		},
		orderBy: { createdAt: 'desc' }
	})
}

async function requirePending(organizationId: string, proposalId: string) {
	const proposal = await db.actionProposal.findFirst({
		where: { id: proposalId, organizationId, status: 'PENDING' }
	})
	if (!proposal) error(404, 'Pending proposal not found')
	return proposal
}

/** Self-action is a property of the row, re-derived from the target's user link, never stored. */
async function isSelfAction(proposal: {
	initiatorId: string
	targetEmployeeId: string
}): Promise<boolean> {
	const target = await db.employee.findUnique({
		where: { id: proposal.targetEmployeeId },
		select: { userId: true }
	})
	return target?.userId === proposal.initiatorId
}
