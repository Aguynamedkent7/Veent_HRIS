import { describe, it, expect } from 'vitest'
import {
	assertValidRequestUploads,
	MAX_REQUEST_DOCS,
	type RequestUpload
} from '$lib/server/services/requests/documents'
import { MAX_UPLOAD_BYTES } from '$lib/server/storage'

const upload = (over: Partial<RequestUpload> = {}): RequestUpload => ({
	fileName: 'receipt.pdf',
	mimeType: 'application/pdf',
	bytes: Buffer.from('pdf bytes'),
	...over
})

describe('assertValidRequestUploads', () => {
	it('accepts a valid batch of allowed types', () => {
		expect(() =>
			assertValidRequestUploads([
				upload(),
				upload({ fileName: 'photo.png', mimeType: 'image/png' }),
				upload({ fileName: 'scan.jpg', mimeType: 'image/jpeg' }),
				upload({ fileName: 'shot.webp', mimeType: 'image/webp' })
			])
		).not.toThrow()
	})

	it('accepts an empty batch (documents are optional)', () => {
		expect(() => assertValidRequestUploads([])).not.toThrow()
	})

	it('rejects more than the per-request cap', () => {
		const files = Array.from({ length: MAX_REQUEST_DOCS + 1 }, () => upload())
		expect(() => assertValidRequestUploads(files)).toThrow()
	})

	it('counts documents already attached to the request toward the cap', () => {
		const files = [upload(), upload()]
		expect(() => assertValidRequestUploads(files, MAX_REQUEST_DOCS - 1)).toThrow()
		expect(() => assertValidRequestUploads(files, MAX_REQUEST_DOCS - 2)).not.toThrow()
	})

	it('rejects an empty file', () => {
		expect(() => assertValidRequestUploads([upload({ bytes: Buffer.alloc(0) })])).toThrow()
	})

	it('rejects a file over the size limit', () => {
		expect(() =>
			assertValidRequestUploads([upload({ bytes: Buffer.alloc(MAX_UPLOAD_BYTES + 1) })])
		).toThrow()
	})

	it('rejects disallowed mime types', () => {
		expect(() =>
			assertValidRequestUploads([
				upload({ fileName: 'run.exe', mimeType: 'application/x-msdownload' })
			])
		).toThrow()
		expect(() =>
			assertValidRequestUploads([
				upload({
					fileName: 'doc.docx',
					mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
				})
			])
		).toThrow()
	})
})
