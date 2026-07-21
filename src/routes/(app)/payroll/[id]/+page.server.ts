import { error, fail, isHttpError } from '@sveltejs/kit'
import { z } from 'zod'
import { requirePayrollManage } from '$lib/server/rbac'
import { canAny } from '$lib/rbac'
import {
	getPayrollRun,
	overridePayrollEntry,
	computePayroll
} from '$lib/server/services/payroll/index'
import { livePayrollStage, decidePayrollRun, canActOnStage } from '$lib/server/services/approvals'
import type { Actions, PageServerLoad } from './$types'

function ctxOf(locals: App.Locals, ip: string) {
	const user = locals.user!
	return {
		organizationId: user.organizationId,
		actorId: user.id,
		actorRole: user.role,
		actorRoles: user.roles,
		ipAddress: ip
	}
}

function rolesOf(user: App.Locals['user']) {
	return user!.roles?.length ? user!.roles : [user!.role]
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.user!
	const roles = rolesOf(user)
	// Payroll managers run/override; the sign-off roles (Verifier/Approver) need to see
	// the run to check its numbers and act on their stage (#134). Everyone else is out.
	const canManage = canAny(roles, 'MANAGE_PAYROLL')
	const canSignOff = canAny(roles, 'VERIFY_REQUESTS') || canAny(roles, 'APPROVE_SIGNOFF')
	if (!canManage && !canSignOff) error(403, 'Insufficient permissions')

	const run = await getPayrollRun(params.id, user.organizationId)

	// Whether the current user can act on the run's live maker-checker stage: only when
	// the run is COMPUTED, a stage is open, they hold that stage's capability, and they
	// aren't the maker of the live attempt (separation of duties).
	const live = run.status === 'COMPUTED' ? livePayrollStage(run.approvalSteps) : null
	const makeActorId = live
		? run.approvalSteps.find((s) => s.attempt === live.attempt && s.stage === 'MAKE')?.actorId
		: null
	const canAct = Boolean(
		live?.currentStep &&
		canActOnStage(live.currentStep.stage, roles, null, null) &&
		makeActorId !== user.id
	)

	return { run, liveStage: live?.currentStep?.stage ?? null, canAct, canManage }
}

// `finite()` matters as much as `min(0)`: z.coerce.number() turns "" into 0 and
// "abc" into NaN, and NaN would otherwise satisfy a bare number() check.
const overrideSchema = z.object({
	entryId: z.string().min(1),
	netPay: z.coerce.number().finite().min(0),
	note: z.string().trim().min(1)
})

const decideSchema = z.object({
	// 'approve' advances the stage; 'return' sends the run back to the maker.
	action: z.enum(['approve', 'return']),
	note: z.string().trim().optional()
})

export const actions: Actions = {
	override: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requirePayrollManage(user.role)

		const data = await request.formData()

		// parseFloat with no guard let NaN and negative amounts through to a Decimal
		// column — NaN blew up at the driver, a negative net pay was written silently.
		const parsed = overrideSchema.safeParse({
			entryId: data.get('entryId'),
			netPay: data.get('netPay'),
			note: data.get('note')
		})
		if (!parsed.success) {
			return fail(422, { error: 'Enter a valid, non-negative net pay and a reason.' })
		}
		const { entryId, netPay, note } = parsed.data

		await overridePayrollEntry(
			entryId,
			user.organizationId,
			{ netPay },
			note,
			ctxOf(locals, getClientAddress())
		)
	},

	// Recompute this run in place (e.g. after assigning recurring earnings or
	// deductions) — allowed until the run is approved.
	compute: async ({ params, locals, getClientAddress }) => {
		const user = locals.user!
		requirePayrollManage(user.role)

		try {
			await computePayroll(params.id, user.organizationId, ctxOf(locals, getClientAddress()))
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
	},

	// Verify / approve / return the run through the maker-checker chain (#134). Gated at
	// the approvals surface (Verifier/Approver reach this, not just payroll managers);
	// the service enforces the exact stage capability + separation of duties, and a
	// return needs a reason.
	decide: async ({ request, locals, params, getClientAddress }) => {
		const user = locals.user!
		const roles = user.roles?.length ? user.roles : [user.role]
		if (!canAny(roles, 'APPROVE_REQUESTS')) error(403, 'Insufficient permissions')

		const parsed = decideSchema.safeParse(Object.fromEntries(await request.formData()))
		if (!parsed.success) return fail(400, { error: 'Invalid decision' })
		const { action, note } = parsed.data

		try {
			await decidePayrollRun(
				params.id,
				user.organizationId,
				action === 'approve',
				note,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
	}
}
