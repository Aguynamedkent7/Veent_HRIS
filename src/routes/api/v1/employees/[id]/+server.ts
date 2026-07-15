import { json } from '@sveltejs/kit'
import { requireRole, requireMinRole } from '$lib/server/rbac'
import { getEmployee, updateEmployee, offboardEmployee } from '$lib/server/services/employees'
import { apiError } from '$lib/server/api-error'
import { db } from '$lib/server/db'
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
	employmentType: z.enum(['FULL_TIME', 'PROBATIONARY', 'CONTRACTUAL', 'PART_TIME']).optional(),
	employmentStatus: z.enum(['ACTIVE', 'ON_LEAVE', 'OFFBOARDED']).optional(),
	basicMonthlySalary: z.coerce.number().positive().optional(),
	sssNumber: z.string().optional(),
	philhealthNumber: z.string().optional(),
	pagibigNumber: z.string().optional(),
	tinNumber: z.string().optional(),
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
		const employee = await getEmployee(params.id, locals.user.organizationId, locals.user.role)

		// Object-level access control: a MANAGER may only read their own direct
		// reports. HR/Super-Admin are unrestricted. Mirrors the 201-file page load.
		if (locals.user.role === 'MANAGER') {
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
		requireRole(locals.user.role, 'HR_ADMIN', 'SUPER_ADMIN')
	} catch {
		return apiError(403, 'Insufficient permissions')
	}

	const body = await request.json()
	const parsed = updateSchema.safeParse(body)

	if (!parsed.success) {
		return apiError(400, 'Invalid request body')
	}

	try {
		const updated = await updateEmployee(params.id, locals.user.organizationId, parsed.data, {
			organizationId: locals.user.organizationId,
			actorId: locals.user.id,
			actorRole: locals.user.role
		})
		return json({ data: updated })
	} catch (e: unknown) {
		const err = e as { status?: number }
		if (err?.status === 404) return apiError(404, 'Employee not found')
		throw e
	}
}

export const POST: RequestHandler = async ({ locals, params, request, url }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')

	const action = url.searchParams.get('action')

	if (action === 'offboard') {
		try {
			requireRole(locals.user.role, 'HR_ADMIN', 'SUPER_ADMIN')
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
			const err = e as { status?: number }
			if (err?.status === 404) return apiError(404, 'Employee not found')
			throw e
		}
	}

	return apiError(400, 'Unknown action')
}
