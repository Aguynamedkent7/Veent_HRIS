import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

// Files live OUTSIDE the web root (never in static/) so they are only reachable via
// an authenticated download route. Override the location with UPLOAD_DIR in prod.
const UPLOAD_DIR = process.env.UPLOAD_DIR
	? path.resolve(process.env.UPLOAD_DIR)
	: path.resolve(process.cwd(), 'uploads')

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB
export const ALLOWED_MIME: Record<string, string> = {
	'application/pdf': '.pdf',
	'image/png': '.png',
	'image/jpeg': '.jpg',
	'image/webp': '.webp'
}

export function isAllowedType(mime: string): boolean {
	return mime in ALLOWED_MIME
}

// Resolve a storageKey to an absolute path, refusing anything that escapes UPLOAD_DIR.
function resolveKey(storageKey: string): string {
	const abs = path.resolve(UPLOAD_DIR, storageKey)
	if (abs !== UPLOAD_DIR && !abs.startsWith(UPLOAD_DIR + path.sep)) {
		throw new Error('Invalid storage key')
	}
	return abs
}

export interface SavedFile {
	storageKey: string
	size: number
}

// Persist bytes under `<subdir>/<uuid><ext>`; ext is derived from the (validated) mime.
export async function saveFile(bytes: Buffer, mime: string, subdir: string): Promise<SavedFile> {
	const ext = ALLOWED_MIME[mime] ?? ''
	const key = path.posix.join(subdir, `${randomUUID()}${ext}`)
	const abs = resolveKey(key)
	await mkdir(path.dirname(abs), { recursive: true })
	await writeFile(abs, bytes)
	return { storageKey: key, size: bytes.byteLength }
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
	return readFile(resolveKey(storageKey))
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
	try {
		await unlink(resolveKey(storageKey))
	} catch (e: unknown) {
		// Missing file is fine — the DB row is the source of truth.
		if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e
	}
}
