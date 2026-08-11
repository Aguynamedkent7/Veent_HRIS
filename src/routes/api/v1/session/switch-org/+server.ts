import { json, error } from '@sveltejs/kit'
import { z } from 'zod'
import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import type { RequestHandler } from './$types'

const schema = z.object({ organizationId: z.string().min(1) })

// Change the active org for a cross-org member (#131). The membership check is the
// tenant-isolation boundary: only orgs the user actually belongs to can become
// current. hooks.server.ts then resolves locals.user.organizationId from the stored
// session value on every subsequent request.
export const POST: RequestHandler = async ({ locals, request, getClientAddress }) => {
	if (!locals.user || !locals.session) error(401, 'Unauthorized')

	const parsed = schema.safeParse(await request.json().catch(() => null))
	if (!parsed.success) error(400, 'Invalid request')

	const { organizationId } = parsed.data

	const membership = await db.userOrganization.findUnique({
		where: { userId_organizationId: { userId: locals.user.id, organizationId } }
	})
	if (!membership) error(403, 'Not a member of that organization')

	const previousOrgId = locals.user.organizationId

	await db.session.update({
		where: { id: locals.session.id },
		data: { currentOrgId: organizationId }
	})

	await writeAuditLog(
		{
			organizationId,
			actorId: locals.user.id,
			actorRoles: locals.user.roles,
			ipAddress: getClientAddress()
		},
		{
			action: 'UPDATE',
			entityType: 'Session',
			entityId: locals.session.id,
			oldValue: { currentOrgId: previousOrgId },
			newValue: { currentOrgId: organizationId }
		}
	)

	return json({ ok: true })
}
