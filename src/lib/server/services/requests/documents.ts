import { db } from '$lib/server/db'
import { error } from '@sveltejs/kit'
import { writeAuditLog } from '$lib/server/audit'
import { saveFile, deleteStoredFile, isAllowedType, MAX_UPLOAD_BYTES } from '$lib/server/storage'
import type { AuditContext } from '../types'

// Supporting documents attached to a Request (issue #51). Bytes share the T162
// store (UPLOAD_DIR) with EmployeeDocument; rows carry a verification sign-off
// (verifiedById/verifiedAt) set by an approver during review.

export const MAX_REQUEST_DOCS = 5

export interface RequestUpload {
	fileName: string
	mimeType: string
	bytes: Buffer
}

// Validate a batch of uploads without touching disk — the create action calls this
// BEFORE creating the request so a bad file never leaves an orphan request behind.
export function assertValidRequestUploads(files: RequestUpload[], existingCount = 0) {
	if (files.length + existingCount > MAX_REQUEST_DOCS) {
		error(400, `A request can have at most ${MAX_REQUEST_DOCS} supporting documents`)
	}
	for (const f of files) {
		if (!f.bytes.byteLength) error(400, `"${f.fileName}" is empty`)
		if (f.bytes.byteLength > MAX_UPLOAD_BYTES) {
			error(413, `"${f.fileName}" exceeds the 10 MB limit`)
		}
		if (!isAllowedType(f.mimeType)) {
			error(415, `"${f.fileName}" has an unsupported type. Allowed: PDF, PNG, JPEG, WEBP`)
		}
	}
}

// Attach uploads to the employee's own still-editable request. Used right after
// createRequest (status PENDING) and from the detail page while PENDING/RETURNED.
export async function saveRequestDocuments(
	requestId: string,
	employeeId: string,
	organizationId: string,
	files: RequestUpload[],
	ctx: AuditContext
) {
	if (!files.length) return []

	const req = await db.request.findFirst({
		where: { id: requestId, employeeId, employee: { user: { organizationId } } },
		select: { id: true, status: true, _count: { select: { documents: true } } }
	})
	if (!req) error(404, 'Request not found')
	if (req.status !== 'PENDING' && req.status !== 'RETURNED') {
		error(400, 'Documents can only be added while a request is pending or returned')
	}
	assertValidRequestUploads(files, req._count.documents)

	const docs = []
	for (const f of files) {
		const saved = await saveFile(f.bytes, f.mimeType, `requests/${requestId}`)
		const doc = await db.requestDocument.create({
			data: {
				requestId,
				label: f.fileName,
				fileName: f.fileName,
				mimeType: f.mimeType,
				size: saved.size,
				storageKey: saved.storageKey
			}
		})
		docs.push(doc)
		await writeAuditLog(ctx, {
			action: 'CREATE',
			entityType: 'RequestDocument',
			entityId: doc.id,
			newValue: { requestId, fileName: f.fileName, size: saved.size }
		})
	}
	return docs
}

// Returns the row incl. storageKey (plus the owning request) so the download route
// can stream the file and check access.
export async function getRequestDocument(docId: string, organizationId: string) {
	const doc = await db.requestDocument.findFirst({
		where: { id: docId, request: { employee: { user: { organizationId } } } },
		include: { request: { select: { id: true, employeeId: true } } }
	})
	if (!doc) error(404, 'Document not found')
	return doc
}

// Approver marks a document as verified (or clears the sign-off). Role gating
// (APPROVER_ROLES) is the caller's job; this enforces org scoping only.
export async function setRequestDocumentVerified(
	docId: string,
	organizationId: string,
	verified: boolean,
	ctx: AuditContext
) {
	const doc = await getRequestDocument(docId, organizationId)
	const updated = await db.requestDocument.update({
		where: { id: doc.id },
		data: verified
			? { verifiedById: ctx.actorId, verifiedAt: new Date() }
			: { verifiedById: null, verifiedAt: null }
	})
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'RequestDocument',
		entityId: doc.id,
		newValue: { requestId: doc.requestId, verified }
	})
	return updated
}

// Owner removes a document from their own still-editable request. Verified docs are
// locked — an approver already signed off on that exact file, so it can't be swapped
// out from under them.
export async function deleteRequestDocument(
	docId: string,
	employeeId: string,
	organizationId: string,
	ctx: AuditContext
) {
	const doc = await getRequestDocument(docId, organizationId)

	const req = await db.request.findFirst({
		where: { id: doc.requestId, employeeId },
		select: { id: true, status: true }
	})
	if (!req) error(403, 'You can only remove documents from your own requests')
	if (req.status !== 'PENDING' && req.status !== 'RETURNED') {
		error(400, 'Documents can only be removed while a request is pending or returned')
	}
	if (doc.verifiedAt) error(409, 'Verified documents cannot be removed')

	await db.requestDocument.delete({ where: { id: doc.id } })
	await deleteStoredFile(doc.storageKey)
	await writeAuditLog(ctx, {
		action: 'DELETE',
		entityType: 'RequestDocument',
		entityId: doc.id,
		oldValue: { requestId: doc.requestId, fileName: doc.fileName }
	})
	return { deleted: true }
}
