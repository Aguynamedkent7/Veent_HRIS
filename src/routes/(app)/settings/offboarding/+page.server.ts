import { fail, isHttpError } from '@sveltejs/kit'
import { z } from 'zod'
import { requireCapability } from '$lib/server/rbac'
import {
	listOffboardingItems,
	ensureSeeded,
	addItem,
	updateItem,
	toggleItem,
	deleteItem,
	moveItem
} from '$lib/server/services/offboarding'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	requireCapability(locals.user!.role, 'MANAGE_HR')
	// Materialize the default clearance steps on first visit so HR has them to edit/reorder.
	await ensureSeeded(locals.user!.organizationId)
	return { items: await listOffboardingItems(locals.user!.organizationId) }
}

const itemSchema = z.object({
	label: z.string().min(1).max(120),
	department: z.string().min(1).max(80)
})

function ctxOf(locals: App.Locals, ip: string) {
	return {
		organizationId: locals.user!.organizationId,
		actorId: locals.user!.id,
		actorRole: locals.user!.role,
		ipAddress: ip
	}
}

async function run(fn: () => Promise<unknown>) {
	try {
		await fn()
		return { success: true }
	} catch (e: unknown) {
		if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
		throw e
	}
}

export const actions: Actions = {
	add: async ({ request, locals, getClientAddress }) => {
		requireCapability(locals.user!.role, 'MANAGE_HR')
		const parsed = itemSchema.safeParse(Object.fromEntries(await request.formData()))
		if (!parsed.success) return fail(422, { error: 'A label and department are required.' })
		return run(() =>
			addItem(locals.user!.organizationId, parsed.data, ctxOf(locals, getClientAddress()))
		)
	},

	update: async ({ request, locals, getClientAddress }) => {
		requireCapability(locals.user!.role, 'MANAGE_HR')
		const data = Object.fromEntries(await request.formData())
		const id = data.id as string
		if (!id) return fail(400, { error: 'Missing id' })
		const parsed = itemSchema.safeParse(data)
		if (!parsed.success) return fail(422, { error: 'A label and department are required.' })
		return run(() =>
			updateItem(locals.user!.organizationId, id, parsed.data, ctxOf(locals, getClientAddress()))
		)
	},

	toggle: async ({ request, locals, getClientAddress }) => {
		requireCapability(locals.user!.role, 'MANAGE_HR')
		const id = (await request.formData()).get('id') as string
		if (!id) return fail(400, { error: 'Missing id' })
		return run(() => toggleItem(locals.user!.organizationId, id, ctxOf(locals, getClientAddress())))
	},

	remove: async ({ request, locals, getClientAddress }) => {
		requireCapability(locals.user!.role, 'MANAGE_HR')
		const id = (await request.formData()).get('id') as string
		if (!id) return fail(400, { error: 'Missing id' })
		return run(() => deleteItem(locals.user!.organizationId, id, ctxOf(locals, getClientAddress())))
	},

	move: async ({ request, locals, getClientAddress }) => {
		requireCapability(locals.user!.role, 'MANAGE_HR')
		const data = await request.formData()
		const id = data.get('id') as string
		const direction = data.get('direction') === 'up' ? 'up' : 'down'
		if (!id) return fail(400, { error: 'Missing id' })
		return run(() =>
			moveItem(locals.user!.organizationId, id, direction, ctxOf(locals, getClientAddress()))
		)
	}
}
