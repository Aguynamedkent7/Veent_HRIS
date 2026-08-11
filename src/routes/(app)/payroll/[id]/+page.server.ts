import { error, fail, isHttpError } from '@sveltejs/kit'
import { z } from 'zod'
import { requireAnyCapability, requirePayrollManage } from '$lib/server/rbac'
import { canAny } from '$lib/rbac'
import { listVisiblePayEmployeeIds } from '$lib/server/services/employee-access'
import {
	getPayrollRun,
	overridePayrollEntry,
	computePayroll
} from '$lib/server/services/payroll/index'
import { isPayslipVisible } from '$lib/server/services/payroll/runs'
import {
	livePayrollStage,
	decidePayrollRun,
	canActOnPayrollStage
} from '$lib/server/services/approvals'
import type { Actions, PageServerLoad } from './$types'

function ctxOf(locals: App.Locals, ip: string) {
	const user = locals.user!
	return {
		organizationId: user.organizationId,
		actorId: user.id,
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
	const canManagePayroll = canAny(roles, 'MANAGE_PAYROLL')
	const canSignOff = canAny(roles, 'VERIFY_REQUESTS') || canAny(roles, 'APPROVE_FINANCE')
	if (!canManagePayroll && !canSignOff) error(403, 'Insufficient permissions')

	// #249: a run carries every employee's gross, itemized statutory deductions and net, and
	// MANAGE_PAYROLL holds MANAGER — so without this a branch manager reads the whole org's pay
	// here, the same leak the payslip doors were narrowed to close. `null` = unrestricted.
	const visibleEmployeeIds = await listVisiblePayEmployeeIds({
		id: user.id,
		roles,
		organizationId: user.organizationId
	})

	// Finance approvers reach any tenant's run to sign it off (#174); managers/verifiers
	// stay in their own org.
	const run = await getPayrollRun(params.id, user.organizationId, roles, visibleEmployeeIds)

	// Managing (override/recompute) is only ever your own org's payroll — a finance approver
	// reviewing another tenant's run gets a read-only view plus the sign-off action.
	const canManage = canManagePayroll && run.organizationId === user.organizationId

	// Whether the current user can act on the run's live maker-checker stage: only when
	// the run is COMPUTED, a stage is open, they hold that stage's capability, and they
	// aren't the maker of the live attempt (separation of duties).
	const live = run.status === 'COMPUTED' ? livePayrollStage(run.approvalSteps) : null
	const makeActorId = live
		? run.approvalSteps.find((s) => s.attempt === live.attempt && s.stage === 'MAKE')?.actorId
		: null
	const canAct = Boolean(
		live?.currentStep &&
		canActOnPayrollStage(live.currentStep.stage, roles) &&
		makeActorId !== user.id
	)

	// Tells the page its table is a slice, not the run — the totals above it were recomputed to
	// match, so without this the view is honest but indistinguishable from the full run.
	return {
		run,
		liveStage: live?.currentStep?.stage ?? null,
		canAct,
		canManage,
		scopedToTeam: visibleEmployeeIds != null,
		// #278: every payslip door 403s until the run is filed, so the table must not offer a link
		// that is a guaranteed dead end. Decided here rather than in the component: the rule already
		// lives in one place, and a fourth copy of it is the defect #278 is about.
		payslipVisible: isPayslipVisible(run)
	}
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
		requirePayrollManage(user.roles)

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
		requirePayrollManage(user.roles)

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
		requireAnyCapability(user.roles, 'APPROVE_REQUESTS')

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
