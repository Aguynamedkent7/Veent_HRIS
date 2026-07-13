import { describe, it, expect } from 'vitest'
import { isAllowedType, ALLOWED_MIME, MAX_UPLOAD_BYTES } from '$lib/server/storage'

describe('storage allowlist', () => {
	it('accepts PDF and common images', () => {
		expect(isAllowedType('application/pdf')).toBe(true)
		expect(isAllowedType('image/png')).toBe(true)
		expect(isAllowedType('image/jpeg')).toBe(true)
		expect(isAllowedType('image/webp')).toBe(true)
	})
	it('rejects executables / office / unknown types', () => {
		expect(isAllowedType('application/x-msdownload')).toBe(false)
		expect(isAllowedType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false)
		expect(isAllowedType('')).toBe(false)
	})
	it('maps every allowed mime to an extension and caps size at 10MB', () => {
		for (const ext of Object.values(ALLOWED_MIME)) expect(ext.startsWith('.')).toBe(true)
		expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024)
	})
})
