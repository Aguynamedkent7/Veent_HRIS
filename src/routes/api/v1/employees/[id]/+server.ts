import { json } from '@sveltejs/kit'
import { can, requireCapability, requireMinRole } from '$lib/server/rbac'
import {
	getEmployee,
	updateEmployee,
	offboardEmployee,
	recordCompensationChange
} from '$lib/server/services/employees'
import { apiError } from '$lib/server/api-error'
import { db } from '$lib/server/db'
import { govIdSchema } from '$lib/utils/gov-ids'
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
	employmentType: z
		.enum(['REGULAR', 'PROBATIONARY', 'CONTRACTUAL', 'PART_TIME', 'ON_CALL', 'INTERN'])
		.optional(),
	employmentStatus: z.enum(['ACTIVE', 'ON_LEAVE', 'OFFBOARDED']).optional(),
	basicMonthlySalary: z.coerce.number().positive().optional(),
	rateType: z.enum(['MONTHLY', 'DAILY', 'HOURLY']).optional(),
	// #191: a PATCH only carries the fields the caller intends to change, so anything sent
	// here is by definition new and is format-checked and stored canonically.
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

		// Object-level access control: a MANAGER may only read their own direct
		// reports. HR/Super-Admin are unrestricted. Mirrors the 201-file page load.
		// Negated capability, not role equality: anyone who clears the MANAGER floor
		// without holding MANAGE_HR is scoped to their reports rather than unrestricted.
		if (!can(locals.user.role, 'MANAGE_HR')) {
			const self = await db.employee.findUnique({
				where: { userId: locals.user.id },
				select: { id: true }
			})
			if (!self || employee.reportsToId !== self.id) {
				return apiError(403, 'You can only view your own team members.')
			}
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

	const body = await request.json()
	const parsed = updateSchema.safeParse(body)

	if (!parsed.success) {
		return apiError(400, 'Invalid request body')
	}

	// #170: pay must never be written straight onto the Employee row — the payroll run reads
	// period-end salary from EmployeeCompensation history, so a bare Employee write would be silently
	// ignored. Split pay out: non-pay fields still go through updateEmployee; a salary/rateType change
	// is recorded as an effective-today snapshot via recordCompensationChange (which also updates the
	// cache). Resending the same salary is a no-op, not an error.
	const { basicMonthlySalary, rateType, ...rest } = parsed.data
	const ctx = {
		organizationId: locals.user.organizationId,
		actorId: locals.user.id,
		actorRole: locals.user.role
	}

	try {
		if (Object.keys(rest).length > 0) {
			await updateEmployee(params.id, locals.user.organizationId, rest, ctx)
		}
		if (basicMonthlySalary !== undefined || rateType !== undefined) {
			try {
				await recordCompensationChange(
					params.id,
					locals.user.organizationId,
					{ basicMonthlySalary, rateType, effectiveDate: new Date() },
					ctx
				)
			} catch (e: unknown) {
				// A PATCH resending the current salary/pay type is a no-op, not a failure — swallow only
				// the writer's "no change" 400 and let the (unchanged) record be returned. Any other 400
				// (e.g. an invalid rate/type pairing) still propagates to the client below.
				const err = e as { status?: number; body?: { message?: string } }
				if (!(err?.status === 400 && err.body?.message?.includes('No change'))) throw e
			}
		}
		// #111: re-fetch masked so the response reflects the new salary, never the pre-change record.
		const employee = await getEmployee(params.id, locals.user.organizationId, {
			viewerRole: locals.user.role
		})
		return json({ data: employee })
	} catch (e: unknown) {
		const err = e as { status?: number; body?: { message?: string } }
		if (err?.status === 404) return apiError(404, 'Employee not found')
		if (err?.status === 400) return apiError(400, err.body?.message ?? 'Bad request')
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
