import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { notifyMany } from './notifications'
import type { AuditContext } from './types'

export async function listRecentAnnouncements(organizationId: string, limit = 5) {
	return db.announcement.findMany({
		where: { organizationId },
		orderBy: { createdAt: 'desc' },
		take: limit,
		select: {
			id: true,
			title: true,
			body: true,
			createdAt: true,
			author: { select: { email: true } }
		}
	})
}

// Post an announcement and fan out a notification to every user in the org so it
// pops as a toast on their next load.
export async function createAnnouncement(
	organizationId: string,
	input: { title: string; body: string },
	ctx: AuditContext
) {
	const created = await db.announcement.create({
		data: { organizationId, authorId: ctx.actorId, title: input.title.trim(), body: input.body.trim() }
	})

	const users = await db.user.findMany({ where: { organizationId, isActive: true }, select: { id: true } })
	await notifyMany(users.map((u) => u.id), `📢 ${created.title}`, '/dashboard')

	await writeAuditLog(ctx, { action: 'CREATE', entityType: 'Announcement', entityId: created.id, newValue: { title: created.title } })
	return created
}
