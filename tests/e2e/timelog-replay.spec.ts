import 'dotenv/config'
import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { E2E_DISCORD_ID } from './helpers'
import { signPayload } from '../../src/lib/server/hmac'

// #99: the HMAC ingest verifies signatures correctly, but its ±5-minute window left a
// captured request replayable — re-POSTing it injected duplicate punches (attendance
// and therefore payroll manipulation). `messageId` is the idempotency key.
//
// Deliberately NOT in timesheet-punch.spec.ts: that suite aggregates a specific week
// and asserts an exact hour total, so a stray punch there would break it. These punches
// land three weeks back, a period no other spec aggregates, and are removed afterwards.

const SECRET = process.env.TIMELOG_API_SECRET
const MESSAGE_ID = 'e2e-replay-99'

function threeWeeksAgoPht(): string {
	const d = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000)
	return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

/** Byte-identical replay: same body, same timestamp, same signature — a captured request. */
function sign(rawBody: string) {
	const ts = Math.floor(Date.now() / 1000).toString()
	return { ts, signature: signPayload(rawBody, ts, SECRET as string) }
}

test.afterAll(async () => {
	// Remove every punch these tests created — the keyed one and the two unkeyed ones —
	// so repeat local runs against a persistent dev DB stay clean.
	const day = threeWeeksAgoPht()
	const db = new PrismaClient()
	try {
		await db.timeLog.deleteMany({
			where: {
				employee: { discordId: E2E_DISCORD_ID },
				timestamp: {
					gte: new Date(`${day}T00:00:00+08:00`),
					lt: new Date(`${day}T23:59:59+08:00`)
				}
			}
		})
	} finally {
		await db.$disconnect()
	}
})

test('a replayed punch is rejected and writes no duplicate row', async ({ request }) => {
	expect(SECRET, 'TIMELOG_API_SECRET must be set (see .env) to sign punches').toBeTruthy()

	const rawBody = JSON.stringify({
		discordId: E2E_DISCORD_ID,
		punchType: 'IN',
		timestamp: new Date(`${threeWeeksAgoPht()}T09:00:00+08:00`).toISOString(),
		messageId: MESSAGE_ID
	})
	const { ts, signature } = sign(rawBody)
	const headers = {
		'content-type': 'application/json',
		'x-hris-signature': signature,
		'x-hris-timestamp': ts
	}

	// First delivery is accepted.
	const first = await request.post('/api/v1/timesheets/log', { headers, data: rawBody })
	expect(first.status(), await first.text()).toBe(201)

	// The replay carries a still-valid signature inside the ±300s window, so it clears
	// every HMAC check — only the idempotency key can stop it.
	const replay = await request.post('/api/v1/timesheets/log', { headers, data: rawBody })
	expect(replay.status(), await replay.text()).toBe(409)

	// The assertion that actually matters: rejected, and nothing extra persisted.
	const db = new PrismaClient()
	try {
		const rows = await db.timeLog.count({ where: { discordMessageId: MESSAGE_ID } })
		expect(rows).toBe(1)
	} finally {
		await db.$disconnect()
	}
})

test('punches without a messageId are unaffected by the dedupe', async ({ request }) => {
	// NULL messageIds stay distinct under the unique constraint — the manual/web punch
	// path must not be collaterally deduped by this fix.
	const day = threeWeeksAgoPht()
	const bodies = ['IN', 'OUT'].map((punchType, i) =>
		JSON.stringify({
			discordId: E2E_DISCORD_ID,
			punchType,
			timestamp: new Date(`${day}T1${i}:00:00+08:00`).toISOString()
		})
	)

	for (const rawBody of bodies) {
		const { ts, signature } = sign(rawBody)
		const res = await request.post('/api/v1/timesheets/log', {
			headers: {
				'content-type': 'application/json',
				'x-hris-signature': signature,
				'x-hris-timestamp': ts
			},
			data: rawBody
		})
		expect(res.status(), await res.text()).toBe(201)
	}
})
