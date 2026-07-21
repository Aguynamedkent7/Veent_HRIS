import { error, fail, isHttpError } from '@sveltejs/kit'
import { db } from '$lib/server/db'
import { getRequest } from '$lib/server/services/requests'
import {
	uploadsFromForm,
	saveRequestDocuments,
	deleteRequestDocument,
	setRequestDocumentVerified
} from '$lib/server/services/requests/documents'
import { APPROVER_ROLES } from '$lib/server/services/approvals'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals, params }) => {
	const user = locals.user!
	const req = await getRequest(params.id, user.organizationId)
	if (!req) error(404, 'Request not found')

	// Owner, or any approver (managers/HR/super-admin plus payroll officers) who can see
	// others' requests — the same set allowed in the approvals queue, so a reviewer can open
	// the detail of a request they're able to act on.
	const myEmployee = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true }
	})
	const isOwner = myEmployee?.id === req.employeeId
	const canReview = APPROVER_ROLES.includes(user.role)
	if (!isOwner && !canReview) error(403, 'Insufficient permissions')

	// LEAVE requests store their leaveTypeId in the JSON payload (no relation); resolve it to a
	// name for the details panel.
	let leaveTypeName: string | null = null
	if (req.type === 'LEAVE') {
		const leaveTypeId = ((req.payload ?? {}) as Record<string, unknown>).leaveTypeId
		if (typeof leaveTypeId === 'string') {
			const lt = await db.leaveType.findFirst({
				where: { id: leaveTypeId, organizationId: user.organizationId },
				select: { name: true }
			})
			leaveTypeName = lt?.name ?? null
		}
	}

	return { request: req, isOwner, canReview, leaveTypeName }
}

function ctxOf(locals: App.Locals, ip: string) {
	const user = locals.user!
	return {
		organizationId: user.organizationId,
		actorId: user.id,
		actorRole: user.role,
		ipAddress: ip
	}
}

async function myEmployeeId(userId: string) {
	const me = await db.employee.findUnique({ where: { userId }, select: { id: true } })
	return me?.id ?? null
}

export const actions: Actions = {
	// Owner attaches more documents while the request is still PENDING/RETURNED
	// (e.g. a request was returned with "please attach the receipt").
	uploadDocs: async ({ request, locals, params, getClientAddress }) => {
		const user = locals.user!
		const employeeId = await myEmployeeId(user.id)
		if (!employeeId) return fail(400, { error: 'No employee profile found.' })

		const data = await request.formData()
		try {
			const uploads = await uploadsFromForm(data)
			if (!uploads.length) return fail(400, { error: 'Please choose a file to upload.' })
			await saveRequestDocuments(
				params.id,
				employeeId,
				user.organizationId,
				uploads,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
		return { message: 'Document uploaded.' }
	},

	deleteDoc: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		const employeeId = await myEmployeeId(user.id)
		if (!employeeId) return fail(400, { error: 'No employee profile found.' })

		const docId = (await request.formData()).get('docId') as string
		if (!docId) return fail(400, { error: 'Missing document id.' })

		try {
			await deleteRequestDocument(
				docId,
				employeeId,
				user.organizationId,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
		return { message: 'Document removed.' }
	},

	// Approver signs off on a document (or clears the sign-off).
	verifyDoc: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		if (!APPROVER_ROLES.includes(user.role)) {
			return fail(403, { error: 'Insufficient permissions' })
		}

		const data = await request.formData()
		const docId = data.get('docId') as string
		const verified = data.get('verified') === 'true'
		if (!docId) return fail(400, { error: 'Missing document id.' })

		try {
			await setRequestDocumentVerified(
				docId,
				user.organizationId,
				verified,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			if (e instanceof Error) return fail(400, { error: e.message })
			throw e
		}
		return { message: verified ? 'Document marked as verified.' : 'Verification cleared.' }
	}
}
