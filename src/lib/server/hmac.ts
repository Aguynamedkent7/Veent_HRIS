import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Shared-secret HMAC signing for server-to-server requests (the Discord bot →
 * the /api/v1/timesheets/log endpoint). The signature covers `${timestamp}.${rawBody}`
 * so both tampering and replay (via a stale timestamp) are rejected.
 *
 * This module imports only `node:crypto`, so it is safe to import from the
 * standalone bot script (`scripts/discord-bot.ts`) as well as SvelteKit server code.
 */

export const REPLAY_WINDOW_SECONDS = 300

/** Hex SHA-256 HMAC over `${timestamp}.${rawBody}`. */
export function signPayload(rawBody: string, timestamp: string, secret: string): string {
	return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

export interface HmacVerifyResult {
	valid: boolean
	reason?: string
}

/**
 * Verify an incoming signature. `nowSeconds` is injectable for testing.
 * Returns `{ valid: false, reason }` rather than throwing, so callers control the response.
 */
export function verifyHmac(params: {
	rawBody: string
	signature: string | null | undefined
	timestamp: string | null | undefined
	secret: string | undefined
	nowSeconds?: number
}): HmacVerifyResult {
	const { rawBody, signature, timestamp, secret } = params

	if (!secret) return { valid: false, reason: 'server secret not configured' }
	if (!signature || !timestamp) return { valid: false, reason: 'missing signature or timestamp' }

	const ts = Number(timestamp)
	if (!Number.isFinite(ts)) return { valid: false, reason: 'invalid timestamp' }

	const now = params.nowSeconds ?? Math.floor(Date.now() / 1000)
	if (Math.abs(now - ts) > REPLAY_WINDOW_SECONDS) {
		return { valid: false, reason: 'timestamp outside replay window' }
	}

	const expected = signPayload(rawBody, timestamp, secret)

	// Hex strings of unequal length cannot match; guard before timingSafeEqual (which throws on length mismatch).
	if (expected.length !== signature.length) return { valid: false, reason: 'signature mismatch' }

	const a = Buffer.from(expected, 'hex')
	const b = Buffer.from(signature, 'hex')
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		return { valid: false, reason: 'signature mismatch' }
	}

	return { valid: true }
}
