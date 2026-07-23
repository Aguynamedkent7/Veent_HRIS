import { db } from '$lib/server/db'

// In-app notifications (distinct from the email stubs in $lib/server/notifications).
// Created on domain events (e.g. request decisions); surfaced to the user as a toast
// on their next page load, then marked read.

export async function notify(userId: string, message: string, link?: string) {
	return db.notification.create({ data: { userId, message, link: link ?? null } })
}

export async function notifyMany(userIds: string[], message: string, link?: string) {
	if (userIds.length === 0) return
	await db.notification.createMany({
		data: userIds.map((userId) => ({ userId, message, link: link ?? null }))
	})
}

export async function listUnread(userId: string, limit = 10) {
	return db.notification.findMany({
		where: { userId, readAt: null },
		orderBy: { createdAt: 'desc' },
		take: limit,
		select: { id: true, message: true, link: true, createdAt: true }
	})
}

// Recent notifications regardless of read state (#169) — the dashboard "Recent activity"
// panel persists them after the toast has been dismissed and marked read.
export async function listRecent(userId: string, limit = 8) {
	return db.notification.findMany({
		where: { userId },
		orderBy: { createdAt: 'desc' },
		take: limit,
		select: { id: true, message: true, link: true, createdAt: true, readAt: true }
	})
}

export async function markRead(userId: string, ids: string[]) {
	if (ids.length === 0) return
	await db.notification.updateMany({
		where: { id: { in: ids }, userId },
		data: { readAt: new Date() }
	})
}

export async function markAllRead(userId: string) {
	await db.notification.updateMany({
		where: { userId, readAt: null },
		data: { readAt: new Date() }
	})
}
