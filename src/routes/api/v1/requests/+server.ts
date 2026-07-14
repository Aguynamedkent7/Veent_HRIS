import { json, error } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { createRequest, listRequests } from '$lib/server/services/requests'
import { requestSchema } from '$lib/server/schemas/requests'
import { ROLE_HIERARCHY } from '$lib/server/rbac'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) error(401, 'Unauthorized')
	const user = locals.user

	// Non-managers only ever see their own requests.
	const isManager = ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY.MANAGER
	const myEmployee = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true }
	})

	const results = await listRequests({
		organizationId: user.organizationId,
		employeeId: isManager ? (url.searchParams.get('employeeId') ?? undefined) : myEmployee?.id,
		type: (url.searchParams.get('type') as never) ?? undefined,
		status: url.searchParams.get('status') ?? undefined
	})
	return json({ results })
}

export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user) error(401, 'Unauthorized')
	const user = locals.user

	const myEmployee = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true }
	})
	if (!myEmployee) error(400, 'No employee profile found')

	const parsed = requestSchema.safeParse(await request.json())
	if (!parsed.success) error(422, parsed.error.errors[0]?.message ?? 'Invalid input')

	const created = await createRequest(myEmployee.id, user.organizationId, parsed.data, {
		organizationId: user.organizationId,
		actorId: user.id,
		actorRole: user.role,
		ipAddress: getClientAddress()
	})
	return json({ request: created }, { status: 201 })
}
