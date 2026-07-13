import { describe, it, expect } from 'vitest'
import { signPayload, verifyHmac, REPLAY_WINDOW_SECONDS } from '$lib/server/hmac'

const SECRET = 'test-secret-please-change'
const BODY = JSON.stringify({ discordId: '123', punchType: 'IN', timestamp: '2026-07-10T01:00:00.000Z' })

describe('signPayload', () => {
	it('is deterministic for the same inputs', () => {
		expect(signPayload(BODY, '1000', SECRET)).toBe(signPayload(BODY, '1000', SECRET))
	})

	it('changes when the body, timestamp, or secret changes', () => {
		const base = signPayload(BODY, '1000', SECRET)
		expect(signPayload(BODY + ' ', '1000', SECRET)).not.toBe(base)
		expect(signPayload(BODY, '1001', SECRET)).not.toBe(base)
		expect(signPayload(BODY, '1000', 'other-secret')).not.toBe(base)
	})
})

describe('verifyHmac', () => {
	const now = 2000
	const timestamp = String(now)
	const signature = signPayload(BODY, timestamp, SECRET)

	it('accepts a valid, fresh signature', () => {
		expect(verifyHmac({ rawBody: BODY, signature, timestamp, secret: SECRET, nowSeconds: now })).toEqual({
			valid: true
		})
	})

	it('rejects a tampered body', () => {
		const res = verifyHmac({ rawBody: BODY + 'x', signature, timestamp, secret: SECRET, nowSeconds: now })
		expect(res.valid).toBe(false)
		expect(res.reason).toBe('signature mismatch')
	})

	it('rejects a wrong secret', () => {
		const res = verifyHmac({ rawBody: BODY, signature, timestamp, secret: 'nope', nowSeconds: now })
		expect(res.valid).toBe(false)
	})

	it('rejects a timestamp outside the replay window', () => {
		const stale = now + REPLAY_WINDOW_SECONDS + 1
		const res = verifyHmac({ rawBody: BODY, signature, timestamp, secret: SECRET, nowSeconds: stale })
		expect(res.valid).toBe(false)
		expect(res.reason).toBe('timestamp outside replay window')
	})

	it('accepts a timestamp at the edge of the replay window', () => {
		const edge = now + REPLAY_WINDOW_SECONDS
		expect(verifyHmac({ rawBody: BODY, signature, timestamp, secret: SECRET, nowSeconds: edge }).valid).toBe(true)
	})

	it('rejects missing signature / timestamp / secret', () => {
		expect(verifyHmac({ rawBody: BODY, signature: null, timestamp, secret: SECRET, nowSeconds: now }).valid).toBe(false)
		expect(verifyHmac({ rawBody: BODY, signature, timestamp: null, secret: SECRET, nowSeconds: now }).valid).toBe(false)
		expect(verifyHmac({ rawBody: BODY, signature, timestamp, secret: undefined, nowSeconds: now }).valid).toBe(false)
	})

	it('does not throw on a malformed hex signature', () => {
		const res = verifyHmac({ rawBody: BODY, signature: 'zzzz', timestamp, secret: SECRET, nowSeconds: now })
		expect(res.valid).toBe(false)
	})
})
