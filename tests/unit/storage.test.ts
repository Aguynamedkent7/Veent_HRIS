import { describe, it, expect } from 'vitest'
import {
	isAllowedType,
	sniffMime,
	contentMatchesType,
	ALLOWED_MIME,
	MAX_UPLOAD_BYTES
} from '$lib/server/storage'

// Minimal valid headers for each allowed format.
const PDF = Buffer.from('%PDF-1.7\n...')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const WEBP = Buffer.concat([
	Buffer.from('RIFF', 'latin1'),
	Buffer.from([0x00, 0x00, 0x00, 0x00]),
	Buffer.from('WEBP', 'latin1')
])
// A tiny PE/EXE header ("MZ") — e.g. an executable renamed to claim application/pdf.
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])

describe('storage allowlist', () => {
	it('accepts PDF and common images', () => {
		expect(isAllowedType('application/pdf')).toBe(true)
		expect(isAllowedType('image/png')).toBe(true)
		expect(isAllowedType('image/jpeg')).toBe(true)
		expect(isAllowedType('image/webp')).toBe(true)
	})
	it('rejects executables / office / unknown types', () => {
		expect(isAllowedType('application/x-msdownload')).toBe(false)
		expect(
			isAllowedType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
		).toBe(false)
		expect(isAllowedType('')).toBe(false)
	})
	it('maps every allowed mime to an extension and caps size at 10MB', () => {
		for (const ext of Object.values(ALLOWED_MIME)) expect(ext.startsWith('.')).toBe(true)
		expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024)
	})
})

describe('sniffMime (#74 magic-byte detection)', () => {
	it('detects each allowed format from its leading bytes', () => {
		expect(sniffMime(PDF)).toBe('application/pdf')
		expect(sniffMime(PNG)).toBe('image/png')
		expect(sniffMime(JPEG)).toBe('image/jpeg')
		expect(sniffMime(WEBP)).toBe('image/webp')
	})

	it('returns null for content that is not an allowed format', () => {
		expect(sniffMime(EXE)).toBeNull()
		expect(sniffMime(Buffer.from('just some text'))).toBeNull()
		expect(sniffMime(Buffer.alloc(0))).toBeNull()
		// RIFF container that is not WEBP (e.g. a WAV) must not pass as an image.
		const WAV = Buffer.concat([
			Buffer.from('RIFF', 'latin1'),
			Buffer.from([0, 0, 0, 0]),
			Buffer.from('WAVE', 'latin1')
		])
		expect(sniffMime(WAV)).toBeNull()
	})

	it('contentMatchesType requires the bytes to be the declared type', () => {
		expect(contentMatchesType(PDF, 'application/pdf')).toBe(true)
		expect(contentMatchesType(PNG, 'image/png')).toBe(true)
		// Renamed executable claiming PDF — rejected.
		expect(contentMatchesType(EXE, 'application/pdf')).toBe(false)
		// Type confusion: real PNG bytes declared as PDF — rejected.
		expect(contentMatchesType(PNG, 'application/pdf')).toBe(false)
	})
})
