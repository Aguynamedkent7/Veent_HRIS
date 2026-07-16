import { error } from '@sveltejs/kit'
import { getRequestDocument } from '$lib/server/services/requests/documents'
import { APPROVER_ROLES } from '$lib/server/services/approvals'
import { readStoredFile } from '$lib/server/storage'
import { db } from '$lib/server/db'
import type { RequestHandler } from './$types'

// Stream a request's supporting document. Access: the employee who filed the
// request, or any approver role (the same set that can open the request detail).
export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) error(401, 'Unauthorized')
	const user = locals.user

	const doc = await getRequestDocument(params.docId, user.organizationId)
	if (doc.requestId !== params.id) error(404, 'Document not found')

	if (!APPROVER_ROLES.includes(user.role)) {
		const me = await db.employee.findUnique({ where: { userId: user.id }, select: { id: true } })
		if (me?.id !== doc.request.employeeId) error(403, 'Insufficient permissions')
	}

	const bytes = await readStoredFile(doc.storageKey)
	return new Response(new Uint8Array(bytes), {
		headers: {
			'Content-Type': doc.mimeType,
			'Content-Length': String(doc.size),
			'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.fileName)}"`,
			'Cache-Control': 'private, no-store'
		}
	})
}
