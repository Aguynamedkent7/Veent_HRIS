import { json } from '@sveltejs/kit'
import { requireCapability, requireMinRole } from '$lib/server/rbac'
import {
	getEmployee,
	updateEmployee,
	offboardEmployee,
	promoteEmployee,
	AWAITING_CONFIRMATION,
	NO_CHANGE_MESSAGE,
	NO_CHANGE_STATUS
} from '$lib/server/services/employees'
import { canTouchEmployee } from '$lib/server/services/employee-access'
import { apiError } from '$lib/server/api-error'
import { govIdSchema } from '$lib/utils/gov-ids'
import { isRateBasisAllowed, RATE_BASIS_MISMATCH } from '$lib/utils/rate-basis'
import { EMPLOYMENT_TYPES } from '$lib/utils/employment-type'
import { z } from 'zod'
import type { RequestHandler } from './$types'

const updateSchema = z.object({
	firstName: z.string().min(1).optional(),
	lastName: z.string().min(1).optional(),
	middleName: z.string().optional(),
	contactPhone: z.string().optional(),
	contactAddress: z.string().optional(),
	departmentId: z.string().optional(),
	jobTitle: z.string().optional(),
	employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
	employmentStatus: z.enum(['ACTIVE', 'ON_LEAVE', 'OFFBOARDED']).optional(),
	basicMonthlySalary: z.coerce.number().positive().optional(),
	rateType: z.enum(['MONTHLY', 'DAILY', 'HOURLY']).optional(),
	// #191: a PATCH only carries the fields the caller intends to change, so anything sent
	// here is by definition new and is format-checked and stored canonically. #267: "sent" is
	// literal — an omitted field is absent from parsed.data and is never written; an explicit ""
	// is a request to clear. Both depend on govIdSchema keeping absent and empty distinct.
	sssNumber: govIdSchema('sssNumber'),
	philhealthNumber: govIdSchema('philhealthNumber'),
	pagibigNumber: govIdSchema('pagibigNumber'),
	tinNumber: govIdSchema('tinNumber'),
	reportsToId: z.string().optional()
})

const offboardSchema = z.object({
	endDate: z.coerce.date()
})

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')

	try {
		requireMinRole(locals.user.role, 'MANAGER')
	} catch {
		return apiError(403, 'Insufficient permissions')
	}

	try {
		const employee = await getEmployee(params.id, locals.user.organizationId, {
			viewerRole: locals.user.role
		})

		// Object-level access control (#228): a MANAGER is scoped to their own team and the branches
		// they manage; HR/CEO/Super-Admin are unrestricted. This was gated on `!can(role,'MANAGE_HR')`,
		// which is never true — MANAGER holds MANAGE_HR — so the check never ran.
		if (!(await canTouchEmployee(locals.user, params.id))) {
			return apiError(403, 'You can only view your own team members.')
		}
		return json({ data: employee })
	} catch (e: unknown) {
		const err = e as { status?: number; body?: { message?: string } }
		if (err?.status === 404) return apiError(404, 'Employee not found')
		throw e
	}
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')

	try {
		requireCapability(locals.user.role, 'MANAGE_HR')
	} catch {
		return apiError(403, 'Insufficient permissions')
	}

	// #228: same object-level scoping as the 201 page — a MANAGER may only write to their own team
	// or a branch they manage. Before any parsing, so a rejected caller learns nothing.
	if (!(await canTouchEmployee(locals.user, params.id))) {
		return apiError(403, 'You can only edit your own team members.')
	}

	const body = await request.json()
	const parsed = updateSchema.safeParse(body)

	if (!parsed.success) {
		return apiError(400, 'Invalid request body')
	}

	// #170/#222: pay and employment type must never be written straight onto the Employee row — both
	// are effective-dated, so a bare Employee write would desync the history the payroll run reads.
	// Split them out: everything else still goes through updateEmployee, while pay and type go to
	// promoteEmployee, which records both as effective-today snapshots in ONE transaction. It has to
	// be one call rather than two writers: the rate-basis pairing (#189) can only be validated on the
	// resulting state, and a PART_TIME/HOURLY → REGULAR/MONTHLY change is invalid at every
	// intermediate step. Resending the same values is a no-op, not an error.
	const { basicMonthlySalary, rateType, employmentType, ...rest } = parsed.data
	const ctx = {
		organizationId: locals.user.organizationId,
		actorId: locals.user.id,
		actorRole: locals.user.role,
		actorRoles: locals.user.roles
	}

	try {
		// The two writers below are separate transactions, so a pairing that promoteEmployee will
		// reject must be caught BEFORE updateEmployee commits the unrelated fields — otherwise a
		// rejected PATCH still half-applies. Cheap pre-check against the resulting state; the writer
		// re-validates authoritatively.
		if (employmentType !== undefined || rateType !== undefined) {
			const current = await getEmployee(params.id, locals.user.organizationId)
			if (
				!isRateBasisAllowed(rateType ?? current.rateType, employmentType ?? current.employmentType)
			) {
				return apiError(400, RATE_BASIS_MISMATCH)
			}
		}
		// #224 Part 2 / #243: set when the pay change was filed for confirmation instead of applied.
		//
		// Runs BEFORE updateEmployee for the same reason as the pairing pre-check above, which the
		// pre-check alone no longer covers: promoteEmployee can now refuse for reasons that have
		// nothing to do with the values (a 409 when no one in the org could confirm the proposal).
		// Committing `rest` first would leave those rejections half-applied. Neither writer reads the
		// other's fields, so the order is free.
		let proposalId: string | undefined
		if (
			basicMonthlySalary !== undefined ||
			rateType !== undefined ||
			employmentType !== undefined
		) {
			try {
				;({ proposalId } = await promoteEmployee(
					params.id,
					locals.user.organizationId,
					{ basicMonthlySalary, rateType, employmentType, effectiveDate: new Date() },
					ctx
				))
			} catch (e: unknown) {
				// A PATCH resending the current salary/pay type/employment type is a no-op, not a failure —
				// swallow only the writer's "no change" 400 and let the (unchanged) record be returned. Any
				// other 400 (e.g. an invalid rate/type pairing) still propagates to the client below.
				const err = e as { status?: number; body?: { message?: string } }
				if (!(err?.status === NO_CHANGE_STATUS && err.body?.message === NO_CHANGE_MESSAGE)) {
					throw e
				}
			}
		}
		if (Object.keys(rest).length > 0) {
			await updateEmployee(params.id, locals.user.organizationId, rest, ctx)
		}
		// #111: re-fetch masked so the response reflects the new salary, never the pre-change record.
		const employee = await getEmployee(params.id, locals.user.organizationId, {
			viewerRole: locals.user.role
		})
		// 202, not 200: the pay change is on file awaiting a second authorized person, so `data` does
		// NOT yet reflect it. Returning 200 would tell the caller their raise landed when it has not.
		// Any non-pay fields in the same PATCH did apply — they are not routed through proposals.
		if (proposalId) {
			return json({ data: employee, proposalId, notice: AWAITING_CONFIRMATION }, { status: 202 })
		}
		return json({ data: employee })
	} catch (e: unknown) {
		const err = e as { status?: number; body?: { message?: string } }
		if (err?.status === 404) return apiError(404, 'Employee not found')
		if (err?.status === 400) return apiError(400, err.body?.message ?? 'Bad request')
		// createProposal refuses up front when nobody else in the org could ever confirm it.
		if (err?.status === 409) return apiError(409, err.body?.message ?? 'Conflict')
		throw e
	}
}

export const POST: RequestHandler = async ({ locals, params, request, url }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')

	const action = url.searchParams.get('action')

	if (action === 'offboard') {
		try {
			requireCapability(locals.user.role, 'MANAGE_HR')
		} catch {
			return apiError(403, 'Insufficient permissions')
		}
		// #228: offboarding is the most destructive write here — scope it like the rest.
		if (!(await canTouchEmployee(locals.user, params.id))) {
			return apiError(403, 'You can only offboard your own team members.')
		}

		const body = await request.json()
		const parsed = offboardSchema.safeParse(body)

		if (!parsed.success) {
			return apiError(400, 'Invalid request body: endDate is required')
		}

		try {
			const result = await offboardEmployee(
				params.id,
				locals.user.organizationId,
				parsed.data.endDate,
				{
					organizationId: locals.user.organizationId,
					actorId: locals.user.id,
					actorRole: locals.user.role
				}
			)
			return json({ data: result })
		} catch (e: unknown) {
			const err = e as { status?: number; body?: { message?: string } }
			if (err?.status === 404) return apiError(404, 'Employee not found')
			if (err?.status === 400) return apiError(400, err.body?.message ?? 'Bad request')
			throw e
		}
	}

	return apiError(400, 'Unknown action')
}
