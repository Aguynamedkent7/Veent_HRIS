import { fail } from '@sveltejs/kit'
import { z } from 'zod'
import { requireCapability } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { ratesFromRule } from '$lib/server/services/payroll/rates'
import {
	SSS_TABLE_2024,
	BIR_MONTHLY_TAX_TABLE,
	type SSSBracket,
	type TaxBracket
} from '$lib/server/services/payroll/ph-statutory'
import {
	getStatutoryRateConfig,
	updateStatutoryRateConfig,
	statutoryRateInputSchema
} from '$lib/server/services/payroll/statutory-rates'
import type { Actions, PageServerLoad } from './$types'

// The open-ended last bracket carries Infinity in code but null on the wire (JSON can't hold Infinity).
const sssToWire = (rows: SSSBracket[]) =>
	rows.map((b) => ({
		...b,
		salaryCeiling: Number.isFinite(b.salaryCeiling) ? b.salaryCeiling : null
	}))
const taxToWire = (rows: TaxBracket[]) =>
	rows.map((b) => ({ ...b, ceiling: Number.isFinite(b.ceiling) ? b.ceiling : null }))

export const load: PageServerLoad = async ({ locals }) => {
	requireCapability(locals.user!.role, 'ADMINISTER_SYSTEM')

	const [config, payRateRule, statConfig] = await Promise.all([
		db.payrollConfig.findUnique({ where: { organizationId: locals.user!.organizationId } }),
		db.payRateRule.findUnique({ where: { organizationId: locals.user!.organizationId } }),
		getStatutoryRateConfig(locals.user!.organizationId)
	])

	// Statutory overrides (#220): the org's row (null fields = default) plus the hardcoded defaults,
	// so the editor can prefill the current effective tables and label the unset ones as defaults.
	const statutory = {
		override: statConfig
			? {
					philhealthRate:
						statConfig.philhealthRate == null ? null : Number(statConfig.philhealthRate),
					philhealthFloor:
						statConfig.philhealthFloor == null ? null : Number(statConfig.philhealthFloor),
					philhealthCeiling:
						statConfig.philhealthCeiling == null ? null : Number(statConfig.philhealthCeiling),
					pagibigRate: statConfig.pagibigRate == null ? null : Number(statConfig.pagibigRate),
					pagibigCap: statConfig.pagibigCap == null ? null : Number(statConfig.pagibigCap),
					sssBrackets: (statConfig.sssBrackets as unknown) ?? null,
					taxBrackets: (statConfig.taxBrackets as unknown) ?? null
				}
			: null,
		defaults: {
			philhealthRate: 0.05,
			philhealthFloor: 10000,
			philhealthCeiling: 100000,
			pagibigRate: 0.02,
			pagibigCap: 100,
			sssBrackets: sssToWire(SSS_TABLE_2024),
			taxBrackets: taxToWire(BIR_MONTHLY_TAX_TABLE)
		}
	}

	// Resolved multipliers (DOLE defaults when the org has no PayRateRule row yet).
	return { config, rates: ratesFromRule(payRateRule), statutory }
}

// Premium-pay multipliers against the base hourly rate; nightDiff is an additive fraction.
const ratesSchema = z.object({
	overtime: z.coerce.number().min(0).max(10),
	overtimePremium: z.coerce.number().min(0).max(10),
	nightDiff: z.coerce.number().min(0).max(10),
	restDay: z.coerce.number().min(0).max(10),
	regularHoliday: z.coerce.number().min(0).max(10),
	specialHoliday: z.coerce.number().min(0).max(10)
})

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
		requireCapability(user.role, 'ADMINISTER_SYSTEM')

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
	},

	updateRates: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireCapability(user.role, 'ADMINISTER_SYSTEM')

		const parsed = ratesSchema.safeParse(Object.fromEntries(await request.formData()))
		if (!parsed.success) {
			return fail(400, { error: 'Invalid multiplier values (each must be between 0 and 10).' })
		}

		const existing = await db.payRateRule.findUnique({
			where: { organizationId: user.organizationId }
		})

		const rule = await db.payRateRule.upsert({
			where: { organizationId: user.organizationId },
			create: { organizationId: user.organizationId, ...parsed.data },
			update: parsed.data
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
				entityType: 'PayRateRule',
				entityId: rule.id,
				oldValue: existing
					? {
							overtime: Number(existing.overtime),
							overtimePremium: Number(existing.overtimePremium),
							nightDiff: Number(existing.nightDiff),
							restDay: Number(existing.restDay),
							regularHoliday: Number(existing.regularHoliday),
							specialHoliday: Number(existing.specialHoliday)
						}
					: undefined,
				newValue: parsed.data
			}
		)

		return { success: true }
	},

	// #220: statutory rate tables. Scalars arrive as strings (empty = clear the override); the two
	// bracket tables arrive as JSON strings from the structured editor. Everything is Zod-validated
	// (the trust boundary — HR is editing tax math) before the org-scoped upsert + audit.
	updateStatutoryRates: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		requireCapability(user.role, 'ADMINISTER_SYSTEM')

		const fd = await request.formData()
		const str = (k: string) => {
			const v = fd.get(k)
			return v == null || String(v).trim() === '' ? null : String(v)
		}
		const num = (k: string) => {
			const v = str(k)
			return v == null ? null : Number(v)
		}
		// Rate inputs are percentages (e.g. 5 → 0.05) to match the rest of this page.
		const pct = (k: string) => {
			const v = num(k)
			return v == null ? null : v / 100
		}
		const jsonArr = (k: string): unknown => {
			const v = str(k)
			if (v == null) return null
			try {
				return JSON.parse(v)
			} catch {
				return Symbol('invalid') // fails the schema below rather than throwing here
			}
		}

		const parsed = statutoryRateInputSchema.safeParse({
			philhealthRate: pct('philhealthRate'),
			philhealthFloor: num('philhealthFloor'),
			philhealthCeiling: num('philhealthCeiling'),
			pagibigRate: pct('pagibigRate'),
			pagibigCap: num('pagibigCap'),
			sssBrackets: jsonArr('sssBrackets'),
			taxBrackets: jsonArr('taxBrackets')
		})
		if (!parsed.success) {
			const first = parsed.error.issues[0]
			return fail(400, {
				error: `Invalid statutory rates: ${first?.message ?? 'validation failed'}`
			})
		}

		await updateStatutoryRateConfig(user.organizationId, parsed.data, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})

		return { success: true }
	}
}
