import { db } from '$lib/server/db'
import { error } from '@sveltejs/kit'
import { writeAuditLog } from '$lib/server/audit'
import {
	saveFile,
	deleteStoredFile,
	isAllowedType,
	contentMatchesType,
	MAX_UPLOAD_BYTES
} from '$lib/server/storage'
import type { RequestDocument } from '@prisma/client'
import type { AuditContext } from '../types'

// Supporting documents attached to a Request (issue #51). Bytes share the T162
// store (UPLOAD_DIR) with EmployeeDocument; rows carry a verification sign-off
// set by an approver during review.
//
// #283/D11: the two sign-off columns mean DIFFERENT things. `verifiedAt` means "currently
// verified" and is what every consumer keys on. `verifiedById` is the durable record of who LAST
// signed off, and it survives a clear — because the #283/F3 bar (a document's verifier may not
// also decide that request) reads it, and a field that a barred actor can null in one click is
// not a bar at all.

export const MAX_REQUEST_DOCS = 5

export interface RequestUpload {
	fileName: string
	mimeType: string
	bytes: Buffer
}

// Shared count/size/type checks. File satisfies this shape, so the form parser can
// validate metadata BEFORE buffering any bytes.
function assertUploadMetadata(
	files: { name: string; size: number; type: string }[],
	existingCount = 0
) {
	if (files.length + existingCount > MAX_REQUEST_DOCS) {
		error(400, `A request can have at most ${MAX_REQUEST_DOCS} supporting documents`)
	}
	for (const f of files) {
		if (!f.size) error(400, `"${f.name}" is empty`)
		if (f.size > MAX_UPLOAD_BYTES) error(413, `"${f.name}" exceeds the 10 MB limit`)
		if (!isAllowedType(f.type)) {
			error(415, `"${f.name}" has an unsupported type. Allowed: PDF, PNG, JPEG, WEBP`)
		}
	}
}

// Validate a batch of uploads without touching disk — runs again inside
// saveRequestDocuments with the request's existing document count.
export function assertValidRequestUploads(files: RequestUpload[], existingCount = 0) {
	assertUploadMetadata(
		files.map((f) => ({ name: f.fileName, size: f.bytes.byteLength, type: f.mimeType })),
		existingCount
	)
}

// Collect the optional `documents` uploads from a form. Browsers submit an empty File
// when the input is left blank — those are filtered out. Count/size/type are checked
// from the File metadata before buffering, so an invalid batch never allocates and a
// bad file fails before any request row is created.
export async function uploadsFromForm(f: FormData): Promise<RequestUpload[]> {
	const entries = f
		.getAll('documents')
		.filter((e): e is File => e instanceof File && e.size > 0 && Boolean(e.name))
	assertUploadMetadata(entries)
	const uploads: RequestUpload[] = []
	for (const e of entries) {
		uploads.push({
			fileName: e.name,
			mimeType: e.type,
			bytes: Buffer.from(await e.arrayBuffer())
		})
	}
	return uploads
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
	// #74: verify each file's magic bytes match its declared (allowlisted) type before
	// touching disk, so a renamed file can't be stored under a trusted content type.
	for (const f of files) {
		if (!contentMatchesType(f.bytes, f.mimeType))
			error(415, `"${f.fileName}" contents do not match its type. Allowed: PDF, PNG, JPEG, WEBP`)
	}

	const docs: RequestDocument[] = []
	const savedKeys: string[] = []
	try {
		for (const f of files) {
			const saved = await saveFile(f.bytes, f.mimeType, `requests/${requestId}`)
			savedKeys.push(saved.storageKey)
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
	} catch (e) {
		// A mid-batch failure must not leave earlier uploads half-attached: drop the rows
		// and bytes stored so far (best-effort), then surface the original error.
		if (docs.length) {
			await db.requestDocument
				.deleteMany({ where: { id: { in: docs.map((d) => d.id) } } })
				.catch(() => {})
		}
		for (const key of savedKeys) await deleteStoredFile(key).catch(() => {})
		throw e
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
			: // #283/D11: clearing the sign-off clears verifiedAt ONLY. Nulling verifiedById too would
				// let a barred approver un-verify their own sign-off and then decide the request, which
				// is the whole F3 bypass — no ADMINISTER_SYSTEM needed, and the selfVerifiedEvidence
				// audit marker never fires. Every other consumer keys on verifiedAt (approvals.ts's
				// queue filter, the delete lock below, requests/[id] and requests/approvals), so
				// "currently verified" still means verifiedAt != null and the ordinary un-verify
				// correction path is unchanged.
				//
				// ponytail: known ceiling — if a DIFFERENT actor later verifies this same document,
				// verifiedById is overwritten and the earlier signer's bar is forgotten. Two people
				// must collude, so it is accepted for now; the upgrade path is a
				// RequestDocumentVerification history table (one row per sign-off), at which point the
				// F3 bar reads the whole history instead of a scalar.
				{ verifiedAt: null }
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
	// The row is gone, so a storage-cleanup failure must not surface as an error or
	// skip the DELETE audit entry — the bytes just become an orphan to sweep later.
	await deleteStoredFile(doc.storageKey).catch((e) =>
		console.error('[storage] failed to remove', doc.storageKey, e)
	)
	await writeAuditLog(ctx, {
		action: 'DELETE',
		entityType: 'RequestDocument',
		entityId: doc.id,
		oldValue: { requestId: doc.requestId, fileName: doc.fileName }
	})
	return { deleted: true }
}
