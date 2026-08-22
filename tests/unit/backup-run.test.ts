import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
	collectDocuments,
	copyAll,
	backupNotificationMessage,
	sweepStaleRuns,
	type BackupIo,
	type PendingFile
} from '$lib/server/backup/run'

const uploadedAt = new Date('2026-02-11T03:12:44.000Z')

function pending(id: string, storageKey: string, size = 3): PendingFile {
	return {
		source: 'employeeDocument',
		id,
		storageKey,
		employeeId: 'e1',
		employeeNumber: 'EMP-015',
		employeeName: 'Dela Cruz, Juan',
		category: 'CONTRACT',
		requestId: null,
		label: 'Signed contract 2026',
		fileName: 'contract-signed.pdf',
		mimeType: 'application/pdf',
		size,
		uploadedAt
	}
}

function io(over: Partial<BackupIo> = {}): BackupIo {
	return {
		readStoredFile: async () => Buffer.from('pdf'),
		writeObject: async () => {},
		readObject: async () => null,
		listRunIds: async () => [],
		deleteRun: async () => {},
		checkFreeSpace: async () => {},
		...over
	}
}

// T-U-03 — one bad file costs one manifest entry, never the whole run (ST1).
describe('copyAll (T-U-03)', () => {
	const files = ['a', 'b', 'c', 'd', 'e'].map((k, i) => pending(`doc${i}`, `employees/e1/${k}.pdf`))

	it('records the unreadable file and copies the other four', async () => {
		const written: string[] = []
		const result = await copyAll(
			files,
			'org_a/run1',
			io({
				readStoredFile: async (key) => {
					if (key === 'employees/e1/c.pdf') throw new Error('ENOENT')
					return Buffer.from('pdf')
				},
				writeObject: async (relPath) => void written.push(relPath)
			})
		)

		expect(result.copied).toHaveLength(4)
		expect(result.failed).toHaveLength(1)
		expect(result.failed[0]).toMatchObject({ id: 'doc2', reason: 'read-error' })
		expect(written).toHaveLength(4)
		expect(written).not.toContain('org_a/run1/files/employees/e1/c.pdf')
	})

	it('records a write failure distinctly from a read failure', async () => {
		const result = await copyAll(
			files.slice(0, 1),
			'org_a/run1',
			io({
				writeObject: async () =>
					void (() => {
						throw new Error('403')
					})()
			})
		)
		expect(result.failed[0].reason).toBe('write-error')
	})

	it('hashes the bytes it actually wrote, and totals only what succeeded', async () => {
		const bytes = Buffer.from('the real contents')
		const result = await copyAll(
			files.slice(0, 1),
			'org_a/run1',
			io({ readStoredFile: async () => bytes })
		)
		expect(result.copied[0].sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
		// The manifest size is the bytes on disk, not the possibly-stale `size` column.
		expect(result.copied[0].size).toBe(bytes.byteLength)
		expect(result.totalBytes).toBe(bytes.byteLength)
	})

	it('writes each object under files/ + storageKey inside the run prefix', async () => {
		const written: string[] = []
		await copyAll(
			files.slice(0, 1),
			'org_a/run1',
			io({ writeObject: async (p) => void written.push(p) })
		)
		expect(written[0]).toBe('org_a/run1/files/employees/e1/a.pdf')
	})
})

// T-U-11 — a failure alert cannot leak document content (S8).
describe('backupNotificationMessage (T-U-11)', () => {
	it('carries counts and nothing else', () => {
		const msg = backupNotificationMessage(1, 412)
		expect(msg).toBe(
			'Nightly document backup finished with errors (1 of 412 files could not be copied). Open Settings → Document Backup.'
		)
	})

	it('names no filename, employee, path, bucket or endpoint', () => {
		const msg = backupNotificationMessage(3, 5)
		for (const secret of [
			'contract-signed.pdf',
			'Dela Cruz',
			'/home/hyuse',
			'/app/backups',
			'veent-backups',
			'sgp1.example.com',
			'employees/e1'
		]) {
			expect(msg).not.toContain(secret)
		}
	})
})

// E-08 — a directory that HAS a manifest is a COMPLETE backup whose status write was
// lost. Flipping it to FAILED and letting the prune pass delete it destroys a good backup.
describe('sweepStaleRuns (E-08)', () => {
	const old = new Date('2026-08-21T00:00:00.000Z')
	const now = new Date('2026-08-22T02:30:00.000Z')

	function fakeDb(runs: { id: string; runId: string; startedAt: Date }[]) {
		const updates: { id: string; data: Record<string, unknown> }[] = []
		return {
			updates,
			db: {
				backupRun: {
					findMany: vi.fn(async () => runs),
					update: vi.fn(
						async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
							updates.push({ id: where.id, data })
							return {}
						}
					)
				}
			}
		}
	}

	it('promotes a stale RUNNING row whose manifest is on the destination', async () => {
		const { db, updates } = fakeDb([{ id: 'r1', runId: 'run1', startedAt: old }])
		const manifest = {
			counts: { files: 4, skipped: 1, failed: 0, totalBytes: 900 }
		}
		const deleted: string[] = []
		await sweepStaleRuns(
			db as never,
			'org_a',
			io({
				readObject: async () => Buffer.from(JSON.stringify(manifest)),
				deleteRun: async (_o, id) => void deleted.push(id)
			}),
			now
		)

		expect(updates[0].data).toMatchObject({
			status: 'SUCCESS',
			fileCount: 4,
			skippedCount: 1,
			failedCount: 0
		})
		expect(deleted).toEqual([])
	})

	it('records PARTIAL when the recovered manifest reports failures', async () => {
		const { db, updates } = fakeDb([{ id: 'r1', runId: 'run1', startedAt: old }])
		await sweepStaleRuns(
			db as never,
			'org_a',
			io({
				readObject: async () =>
					Buffer.from(
						JSON.stringify({ counts: { files: 3, skipped: 0, failed: 2, totalBytes: 7 } })
					)
			}),
			now
		)
		expect(updates[0].data).toMatchObject({ status: 'PARTIAL', failedCount: 2 })
	})

	it('fails and removes a stale run with no manifest — that one really is debris', async () => {
		const { db, updates } = fakeDb([{ id: 'r1', runId: 'run1', startedAt: old }])
		const deleted: string[] = []
		await sweepStaleRuns(
			db as never,
			'org_a',
			io({ readObject: async () => null, deleteRun: async (_o, id) => void deleted.push(id) }),
			now
		)
		expect(updates[0].data).toMatchObject({ status: 'FAILED' })
		expect(deleted).toEqual(['run1'])
	})
})

// T-U-15 — D3 exactly, and the eighth-includer promise in the schema comment.
describe('collectDocuments (T-U-15)', () => {
	const employee = {
		id: 'e1',
		employeeNumber: 'EMP-015',
		lastName: 'Dela Cruz',
		firstName: 'Juan'
	}

	function fakeDb() {
		const args: { employeeDocument?: unknown; requestDocument?: unknown } = {}
		return {
			args,
			db: {
				employeeDocument: {
					findMany: vi.fn(async (a: unknown) => {
						args.employeeDocument = a
						return [
							{
								id: 'ed1',
								storageKey: 'employees/e1/a.pdf',
								category: 'CONTRACT',
								label: 'Contract',
								fileName: 'a.pdf',
								mimeType: 'application/pdf',
								size: 10,
								uploadedAt,
								employee
							},
							{
								id: 'ed2',
								storageKey: 'employees/e1/b.pdf',
								category: 'OTHER',
								label: 'Other',
								fileName: 'b.pdf',
								mimeType: 'application/pdf',
								size: 20,
								uploadedAt,
								employee
							}
						]
					})
				},
				requestDocument: {
					findMany: vi.fn(async (a: unknown) => {
						args.requestDocument = a
						return [
							{
								id: 'rd1',
								requestId: 'req1',
								storageKey: 'requests/req1/x.jpg',
								label: 'Live doc',
								fileName: 'x.jpg',
								mimeType: 'image/jpeg',
								size: 30,
								uploadedAt,
								deletedAt: null,
								request: { employee }
							},
							{
								// Tombstoned but the BYTES ARE STILL THERE — must be backed up.
								id: 'rd2',
								requestId: 'req1',
								storageKey: 'requests/req1/y.jpg',
								label: 'Removed but not evicted',
								fileName: 'y.jpg',
								mimeType: 'image/jpeg',
								size: 40,
								uploadedAt,
								deletedAt: new Date('2026-01-04T05:00:00.000Z'),
								request: { employee }
							},
							{
								// Tombstoned AND evicted — nothing to copy, but the row must be recorded.
								id: 'rd3',
								requestId: 'req1',
								storageKey: null,
								label: 'Medical certificate',
								fileName: 'med-cert.jpg',
								mimeType: 'image/jpeg',
								size: 50,
								uploadedAt,
								deletedAt: new Date('2026-01-04T05:00:00.000Z'),
								request: { employee }
							}
						]
					})
				}
			}
		}
	}

	it('backs up four files: both employee docs and both request docs that still have bytes', async () => {
		const { db } = fakeDb()
		const out = await collectDocuments(db as never, 'org_veent')
		expect(out.files.map((f) => f.id)).toEqual(['ed1', 'ed2', 'rd1', 'rd2'])
	})

	it('records the evicted row as skipped rather than dropping it', async () => {
		const { db } = fakeDb()
		const out = await collectDocuments(db as never, 'org_veent')
		expect(out.skipped).toHaveLength(1)
		expect(out.skipped[0]).toMatchObject({
			source: 'requestDocument',
			id: 'rd3',
			reason: 'bytes-evicted',
			requestId: 'req1',
			fileName: 'med-cert.jpg'
		})
	})

	it('does NOT filter request documents by deletedAt — the eighth includer (#299)', async () => {
		const { db, args } = fakeDb()
		await collectDocuments(db as never, 'org_veent')
		// The WHERE clause only. `deletedAt` is legitimately SELECTED — the manifest records
		// when an evicted row was tombstoned.
		const where = (args.requestDocument as { where: unknown }).where
		expect(JSON.stringify(where)).not.toContain('deletedAt')
	})

	it('scopes both queries to the organization through the relation (S6)', async () => {
		const { db, args } = fakeDb()
		await collectDocuments(db as never, 'org_veent')
		expect(args.employeeDocument).toMatchObject({
			where: { employee: { user: { organizationId: 'org_veent' } } }
		})
		expect(args.requestDocument).toMatchObject({
			where: { request: { employee: { user: { organizationId: 'org_veent' } } } }
		})
	})

	it('carries the employee identity a restorer needs into every entry', async () => {
		const { db } = fakeDb()
		const out = await collectDocuments(db as never, 'org_veent')
		expect(out.files[0]).toMatchObject({
			employeeNumber: 'EMP-015',
			employeeName: 'Dela Cruz, Juan',
			category: 'CONTRACT'
		})
		// requestDocument entries have no category and do carry the request id.
		expect(out.files[2]).toMatchObject({ category: null, requestId: 'req1' })
	})
})
