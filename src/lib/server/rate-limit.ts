/**
 * In-memory rate limiter for login attempts.
 * Single-instance only; swap for a shared store (Redis/DB) if the app scales horizontally.
 */

interface Bucket {
	failures: number[]
	lockedUntil: number
}

const buckets = new Map<string, Bucket>()

export interface RateLimitConfig {
	windowMs: number
	maxFailures: number
	lockoutMs: number
}

const DEFAULTS: RateLimitConfig = {
	windowMs: 15 * 60 * 1000,
	maxFailures: 5,
	lockoutMs: 15 * 60 * 1000
}

function prune(bucket: Bucket, now: number, windowMs: number) {
	bucket.failures = bucket.failures.filter((t) => now - t < windowMs)
}

export function checkRateLimit(
	key: string,
	config: RateLimitConfig = DEFAULTS
): { allowed: true } | { allowed: false; retryAfterMs: number } {
	const now = Date.now()
	const bucket = buckets.get(key)
	if (!bucket) return { allowed: true }

	if (bucket.lockedUntil > now) {
		return { allowed: false, retryAfterMs: bucket.lockedUntil - now }
	}

	prune(bucket, now, config.windowMs)
	if (bucket.failures.length >= config.maxFailures) {
		bucket.lockedUntil = now + config.lockoutMs
		return { allowed: false, retryAfterMs: config.lockoutMs }
	}

	return { allowed: true }
}

export function recordFailure(key: string, config: RateLimitConfig = DEFAULTS): void {
	const now = Date.now()
	const bucket = buckets.get(key) ?? { failures: [], lockedUntil: 0 }
	prune(bucket, now, config.windowMs)
	bucket.failures.push(now)
	if (bucket.failures.length >= config.maxFailures) {
		bucket.lockedUntil = now + config.lockoutMs
	}
	buckets.set(key, bucket)
}

export function recordSuccess(key: string): void {
	buckets.delete(key)
}

export function _resetForTests(): void {
	buckets.clear()
}
