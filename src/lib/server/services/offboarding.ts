import { db } from '$lib/server/db'
import { error } from '@sveltejs/kit'
import { writeAuditLog } from '$lib/server/audit'
import type { AuditContext } from './types'

// ─── Offboarding checklist (#192) ─────────────────────────────────────────────
//
// The mirror of the onboarding checklist: an org-scoped, ordered template HR edits in
// Settings. Opening a separation copies the active items into that case's ClearanceItem
// rows, and the transition-notice email (#185) lists them. An org that has never
// configured a checklist falls back to these built-in defaults, so separations behave
// exactly as they did before the template existed.
export const DEFAULT_OFFBOARDING_ITEMS: { label: string; department: string }[] = [
	{ label: 'Return company equipment (laptop, phone, peripherals)', department: 'IT' },
	{ label: 'Revoke systems & email access', department: 'IT' },
	{ label: 'Settle outstanding loans & cash advances', department: 'Finance' },
	{ label: 'Return ID, access cards & keys', department: 'Admin' },
	{ label: 'Knowledge transfer & handover complete', department: 'Immediate Supervisor' },
	{ label: '201 file & exit documents complete', department: 'HR' }
]

export async function listOffboardingItems(organizationId: string) {
	return db.offboardingChecklistItem.findMany({
		where: { organizationId },
		orderBy: [{ order: 'asc' }, { createdAt: 'asc' }]
	})
}

/**
 * The clearance tasks a new separation seeds and the transition notice lists: the org's
 * active items in order, or the built-in defaults when none are configured. Returned as
 * plain {label, department} so both the separation seed and the email reuse one source.
 */
export async function clearanceTemplateForOrg(
	organizationId: string
): Promise<{ label: string; department: string }[]> {
	const items = await db.offboardingChecklistItem.findMany({
		where: { organizationId, isActive: true },
		orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
		select: { label: true, department: true }
	})
	return items.length ? items : DEFAULT_OFFBOARDING_ITEMS
}

/**
 * Materialize the default items the first time HR opens the editor, so they have the
 * familiar clearance steps to reorder/edit. Idempotent — a no-op once any row exists.
 */
export async function ensureSeeded(organizationId: string) {
	const count = await db.offboardingChecklistItem.count({ where: { organizationId } })
	if (count > 0) return
	await db.offboardingChecklistItem.createMany({
		data: DEFAULT_OFFBOARDING_ITEMS.map((it, i) => ({
			organizationId,
			label: it.label,
			department: it.department,
			order: i,
			isActive: true
		}))
	})
}

export interface OffboardingItemInput {
	label: string
	department: string
}

export async function addItem(
	organizationId: string,
	input: OffboardingItemInput,
	ctx: AuditContext
) {
	const label = input.label.trim()
	const department = input.department.trim()
	if (!label) error(400, 'Label is required')
	if (!department) error(400, 'Department is required')
	const max = await db.offboardingChecklistItem.aggregate({
		where: { organizationId },
		_max: { order: true }
	})
	const order = (max._max.order ?? -1) + 1
	return db.$transaction(async (tx) => {
		const created = await tx.offboardingChecklistItem.create({
			data: { organizationId, label, department, order }
		})
		await writeAuditLog(
			ctx,
			{
				action: 'CREATE',
				entityType: 'OffboardingChecklistItem',
				entityId: created.id,
				newValue: { label, department }
			},
			tx
		)
		return created
	})
}

export async function updateItem(
	organizationId: string,
	id: string,
	input: OffboardingItemInput,
	ctx: AuditContext
) {
	const existing = await db.offboardingChecklistItem.findFirst({
		where: { id, organizationId },
		select: { id: true }
	})
	if (!existing) error(404, 'Checklist item not found')
	const label = input.label.trim()
	const department = input.department.trim()
	if (!label) error(400, 'Label is required')
	if (!department) error(400, 'Department is required')
	return db.$transaction(async (tx) => {
		const updated = await tx.offboardingChecklistItem.update({
			where: { id },
			data: { label, department }
		})
		await writeAuditLog(
			ctx,
			{
				action: 'UPDATE',
				entityType: 'OffboardingChecklistItem',
				entityId: id,
				newValue: { label, department }
			},
			tx
		)
		return updated
	})
}

export async function toggleItem(organizationId: string, id: string, ctx: AuditContext) {
	const existing = await db.offboardingChecklistItem.findFirst({
		where: { id, organizationId },
		select: { id: true, isActive: true }
	})
	if (!existing) error(404, 'Checklist item not found')
	return db.$transaction(async (tx) => {
		const updated = await tx.offboardingChecklistItem.update({
			where: { id },
			data: { isActive: !existing.isActive }
		})
		await writeAuditLog(
			ctx,
			{
				action: 'UPDATE',
				entityType: 'OffboardingChecklistItem',
				entityId: id,
				newValue: { isActive: updated.isActive }
			},
			tx
		)
		return updated
	})
}

export async function deleteItem(organizationId: string, id: string, ctx: AuditContext) {
	const existing = await db.offboardingChecklistItem.findFirst({
		where: { id, organizationId },
		select: { id: true }
	})
	if (!existing) error(404, 'Checklist item not found')
	return db.$transaction(async (tx) => {
		await tx.offboardingChecklistItem.delete({ where: { id } })
		await writeAuditLog(
			ctx,
			{ action: 'DELETE', entityType: 'OffboardingChecklistItem', entityId: id },
			tx
		)
	})
}

/** Persist a new ordering. `orderedIds` must be exactly the org's items, once each. */
export async function reorderItems(
	organizationId: string,
	orderedIds: string[],
	ctx: AuditContext
) {
	const items = await db.offboardingChecklistItem.findMany({
		where: { organizationId },
		select: { id: true }
	})
	const owned = new Set(items.map((i) => i.id))
	if (orderedIds.length !== owned.size || !orderedIds.every((id) => owned.has(id)))
		error(400, 'Invalid reorder payload')
	await db.$transaction(
		orderedIds.map((id, i) =>
			db.offboardingChecklistItem.update({ where: { id }, data: { order: i } })
		)
	)
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'OffboardingChecklistItem',
		entityId: 'reorder',
		newValue: { order: orderedIds }
	})
}

/** Move one item up or down one slot. A no-op at the list edge. */
export async function moveItem(
	organizationId: string,
	id: string,
	direction: 'up' | 'down',
	ctx: AuditContext
) {
	const items = await db.offboardingChecklistItem.findMany({
		where: { organizationId },
		orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
		select: { id: true }
	})
	const idx = items.findIndex((i) => i.id === id)
	if (idx === -1) error(404, 'Checklist item not found')
	const swapWith = direction === 'up' ? idx - 1 : idx + 1
	if (swapWith < 0 || swapWith >= items.length) return // already at the edge
	const ordered = items.map((i) => i.id)
	;[ordered[idx], ordered[swapWith]] = [ordered[swapWith], ordered[idx]]
	await reorderItems(organizationId, ordered, ctx)
}
