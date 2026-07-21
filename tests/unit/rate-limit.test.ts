import { describe, it, expect, beforeEach } from 'vitest'
import {
	checkRateLimit,
	recordFailure,
	recordSuccess,
	_resetForTests
} from '../../src/lib/server/rate-limit'

const cfg = { windowMs: 60_000, maxFailures: 3, lockoutMs: 60_000 }

describe('login rate limiter', () => {
	beforeEach(() => _resetForTests())

	it('allows the first attempt', () => {
		expect(checkRateLimit('k', cfg)).toEqual({ allowed: true })
	})

	it('locks out after maxFailures', () => {
		for (let i = 0; i < cfg.maxFailures; i++) recordFailure('k', cfg)
		const gate = checkRateLimit('k', cfg)
		expect(gate.allowed).toBe(false)
		if (!gate.allowed) expect(gate.retryAfterMs).toBeGreaterThan(0)
	})

	it('recordSuccess clears the bucket', () => {
		for (let i = 0; i < cfg.maxFailures; i++) recordFailure('k', cfg)
		recordSuccess('k')
		expect(checkRateLimit('k', cfg)).toEqual({ allowed: true })
	})

	it('scopes buckets per key', () => {
		for (let i = 0; i < cfg.maxFailures; i++) recordFailure('a', cfg)
		expect(checkRateLimit('a', cfg).allowed).toBe(false)
		expect(checkRateLimit('b', cfg).allowed).toBe(true)
	})
})
