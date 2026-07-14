import { json } from '@sveltejs/kit'
import { z } from 'zod'
import { requirePayrollManage } from '$lib/server/rbac'
import { apiError, badRequest, forbidden } from '$lib/server/api-error'
import { listLoans, createLoan } from '$lib/server/services/payroll/loans'
import type { RequestHandler } from './$types'

const createSchema = z.object({
	employeeId: z.string().min(1),
	type: z.string().optional(),
	principal: z.coerce.number().positive(),
	installment: z.coerce.number().positive()
})

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')
	try {
		requirePayrollManage(locals.user.role)
	} catch {
		return forbidden()
	}
	const employeeId = url.searchParams.get('employeeId')
	if (!employeeId) return badRequest('employeeId is required')
	return json({ data: await listLoans(employeeId) })
}

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) return apiError(401, 'Unauthorized')
	try {
		requirePayrollManage(locals.user.role)
	} catch {
		return forbidden()
	}
	let body: unknown
	try {
		body = await request.json()
	} catch {
		return badRequest('Invalid JSON body')
	}
	const parsed = createSchema.safeParse(body)
	if (!parsed.success) return badRequest('Invalid input', parsed.error.flatten())

	const ctx = {
		organizationId: locals.user.organizationId,
		actorId: locals.user.id,
		actorRole: locals.user.role,
		ipAddress: getClientAddress()
	}
	try {
		const loan = await createLoan(
			parsed.data.employeeId,
			locals.user.organizationId,
			parsed.data,
			ctx
		)
		return json({ data: loan }, { status: 201 })
	} catch (e: unknown) {
		const err = e as { status?: number; body?: { message?: string } }
		if (err?.status && [400, 404].includes(err.status))
			return apiError(err.status, err.body?.message ?? 'Error')
		throw e
	}
}
