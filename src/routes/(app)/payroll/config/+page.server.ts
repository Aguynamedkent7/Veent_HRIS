import { fail } from '@sveltejs/kit'
import { z } from 'zod'
import { requireRole } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import type { Actions, PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ locals }) => {
	requireRole(locals.user!.role, 'SUPER_ADMIN')

	const config = await db.payrollConfig.findUnique({
		where: { organizationId: locals.user!.organizationId }
	})

	return { config }
}

const configSchema = z.object({
	payFrequency: z.enum(['SEMI_MONTHLY', 'MONTHLY']),
	philhealthRate: z.coerce.number().min(0).max(100),
	pagibigRate: z.coerce.number().min(0).max(100),
	cutoffDay1: z.coerce.number().int().min(1).max(28).optional(),
	cutoffDay2: z.coerce.number().int().min(1).max(31).optional()
})

export const actions: Actions = {
	update: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireRole(user.role, 'SUPER_ADMIN')

		const raw = Object.fromEntries(await request.formData())
		const parsed = configSchema.safeParse(raw)
		if (!parsed.success) {
			return fail(400, { error: 'Invalid configuration values', details: parsed.error.flatten() })
		}

		const { payFrequency, philhealthRate, pagibigRate, cutoffDay1, cutoffDay2 } = parsed.data

		// Convert percentage inputs to decimal rates
		const philhealthRateDecimal = philhealthRate / 100
		const pagibigRateDecimal = pagibigRate / 100

		const existing = await db.payrollConfig.findUnique({
			where: { organizationId: user.organizationId }
		})

		const config = await db.payrollConfig.upsert({
			where: { organizationId: user.organizationId },
			create: {
				organizationId: user.organizationId,
				payFrequency,
				philhealthRate: philhealthRateDecimal,
				philhealthFloor: 10000,
				philhealthCeiling: 100000,
				pagibigRate: pagibigRateDecimal,
				pagibigCeiling: 5000,
				firstCutoff: cutoffDay1 ?? null,
				secondCutoff: cutoffDay2 ?? null,
				sssTable: {},
				birTaxTable: {}
			},
			update: {
				payFrequency,
				philhealthRate: philhealthRateDecimal,
				pagibigRate: pagibigRateDecimal,
				firstCutoff: cutoffDay1 ?? null,
				secondCutoff: cutoffDay2 ?? null
			}
		})

		await writeAuditLog(
			{
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			},
			{
				action: 'UPDATE',
				entityType: 'PayrollConfig',
				entityId: config.id,
				oldValue: existing
					? {
							payFrequency: existing.payFrequency,
							philhealthRate: Number(existing.philhealthRate),
							pagibigRate: Number(existing.pagibigRate)
						}
					: undefined,
				newValue: {
					payFrequency,
					philhealthRate: philhealthRateDecimal,
					pagibigRate: pagibigRateDecimal
				}
			}
		)

		return { success: true }
	}
}
