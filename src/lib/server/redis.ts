import Redis from 'ioredis'

const globalForRedis = globalThis as unknown as { redis: Redis }

export const redis =
	globalForRedis.redis ??
	new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
		lazyConnect: true,
		enableOfflineQueue: false
	})

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis

export const CACHE_TTL = {
	DASHBOARD_METRICS: 300 // 5 minutes per FR-025
} as const
