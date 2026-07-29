import { error, fail } from '@sveltejs/kit'
import { canAny } from '$lib/server/rbac'
import { db } from '$lib/server/db'
import { DEFAULT_STATUTORY_RATE_CONFIG } from '$lib/server/services/payroll/ph-statutory'
import {
	getStatutoryRateConfig,
	updateStatutoryRateConfig,
	proposeStatutoryRates,
	confirmProposal,
	rejectProposal,
	listPendingProposals,
	statutoryRateInputSchema,
	type StatutoryRateInput
} from '$lib/server/services/payroll/statutory-rates'
import type { StatutoryRateConfigRow } from '$lib/server/services/payroll/statutory-rates'
import type { Actions, PageServerLoad } from './$types'

// Live config (authoritative + seeded) mapped to the editor's wire shape. Each field falls back to
// the legal default so a missing/partial row still prefills sensible values (#220).
function toWireConfig(row: StatutoryRateConfigRow | null) {
	const d = DEFAULT_STATUTORY_RATE_CONFIG
	if (!row) return d
	const n = (v: unknown, fallback: number) => (v == null ? fallback : Number(v))
	return {
		philhealthRate: n(row.philhealthRate, d.philhealthRate),
		philhealthFloor: n(row.philhealthFloor, d.philhealthFloor),
		philhealthCeiling: n(row.philhealthCeiling, d.philhealthCeiling),
		pagibigRate: n(row.pagibigRate, d.pagibigRate),
		pagibigCap: n(row.pagibigCap, d.pagibigCap),
		sssBrackets: (row.sssBrackets as unknown) ?? d.sssBrackets,
		taxBrackets: (row.taxBrackets as unknown) ?? d.taxBrackets
	}
}

type WireConfig = ReturnType<typeof toWireConfig>

// Human-readable diff of a proposed payload against the live config, for the review panel.
function summarizeChanges(payload: StatutoryRateInput, live: WireConfig): string[] {
	const out: string[] = []
	const pct = (v: number) => `${(v * 100).toFixed(2).replace(/\.?0+$/, '')}%`
	const peso = (v: number) => `₱${v.toLocaleString('en-PH')}`
	const scalar = (label: string, pv: number | null, lv: number, fmt: (v: number) => string) => {
		if (pv != null && pv !== lv) out.push(`${label}: ${fmt(lv)} → ${fmt(pv)}`)
	}
	scalar('PhilHealth rate', payload.philhealthRate, live.philhealthRate, pct)
	scalar('PhilHealth floor', payload.philhealthFloor, live.philhealthFloor, peso)
	scalar('PhilHealth ceiling', payload.philhealthCeiling, live.philhealthCeiling, peso)
	scalar('Pag-IBIG rate', payload.pagibigRate, live.pagibigRate, pct)
	scalar('Pag-IBIG cap', payload.pagibigCap, live.pagibigCap, peso)
	if (
		payload.sssBrackets &&
		JSON.stringify(payload.sssBrackets) !== JSON.stringify(live.sssBrackets)
	)
		out.push('SSS contribution table changed')
	if (
		payload.taxBrackets &&
		JSON.stringify(payload.taxBrackets) !== JSON.stringify(live.taxBrackets)
	)
		out.push('BIR withholding-tax table changed')
	return out.length ? out : ['No effective change vs the live rates.']
}

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!
	const canManage = canAny(user.roles, 'MANAGE_STATUTORY_RATES')
	const canPropose = canAny(user.roles, 'PROPOSE_STATUTORY_RATES')
	if (!canManage && !canPropose) error(403, 'Insufficient permissions')

	const config = await getStatutoryRateConfig(user.organizationId)
	const live = toWireConfig(config)

	// Confirmers see the pending queue with proposer email + a readable change summary.
	let pending: Array<{
		id: string
		proposer: string
		createdAt: Date
		changes: string[]
	}> = []
	if (canManage) {
		const rows = await listPendingProposals(user.organizationId)
		const proposers = await db.user.findMany({
			where: { id: { in: [...new Set(rows.map((r) => r.proposedById))] } },
			select: { id: true, email: true }
		})
		const emailById = new Map(proposers.map((p) => [p.id, p.email]))
		pending = rows.map((r) => ({
			id: r.id,
			proposer: emailById.get(r.proposedById) ?? r.proposedById,
			createdAt: r.createdAt,
			changes: summarizeChanges(statutoryRateInputSchema.parse(r.payload), live)
		}))
	}

	return { live, canManage, canPropose, pending }
}

// Form → StatutoryRateInput. Scalars arrive as strings; the two bracket tables as JSON strings from
// the structured editor. Rate inputs are percentages (5 → 0.05). Everything is Zod-validated (the
// trust boundary — this is tax math) before it reaches the config or a proposal.
function parseRates(fd: FormData) {
	const str = (k: string) => {
		const v = fd.get(k)
		return v == null || String(v).trim() === '' ? null : String(v)
	}
	const num = (k: string) => {
		const v = str(k)
		return v == null ? null : Number(v)
	}
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
			return Symbol('invalid') // fails the schema rather than throwing here
		}
	}
	return statutoryRateInputSchema.safeParse({
		philhealthRate: pct('philhealthRate'),
		philhealthFloor: num('philhealthFloor'),
		philhealthCeiling: num('philhealthCeiling'),
		pagibigRate: pct('pagibigRate'),
		pagibigCap: num('pagibigCap'),
		sssBrackets: jsonArr('sssBrackets'),
		taxBrackets: jsonArr('taxBrackets')
	})
}

const ctxOf = (user: App.Locals['user'], getClientAddress: () => string) => ({
	organizationId: user!.organizationId,
	actorId: user!.id,
	actorRole: user!.role,
	ipAddress: getClientAddress()
})

export const actions: Actions = {
	// CEO / Super Admin edit directly — applies immediately (client confirms first).
	saveStatutoryRates: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		if (!canAny(user.roles, 'MANAGE_STATUTORY_RATES')) error(403, 'Insufficient permissions')

		const parsed = parseRates(await request.formData())
		if (!parsed.success)
			return fail(400, {
				error: `Invalid statutory rates: ${parsed.error.issues[0]?.message ?? 'validation failed'}`
			})

		await updateStatutoryRateConfig(user.organizationId, parsed.data, ctxOf(user, getClientAddress))
		return { success: 'Statutory rates saved.' }
	},

	// HR_ADMIN proposes — live rates unchanged until a CEO/Super Admin confirms.
	proposeStatutoryRates: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		if (!canAny(user.roles, 'PROPOSE_STATUTORY_RATES')) error(403, 'Insufficient permissions')

		const parsed = parseRates(await request.formData())
		if (!parsed.success)
			return fail(400, {
				error: `Invalid statutory rates: ${parsed.error.issues[0]?.message ?? 'validation failed'}`
			})

		await proposeStatutoryRates(user.organizationId, parsed.data, ctxOf(user, getClientAddress))
		return { success: 'Change submitted for CEO approval.' }
	},

	confirmProposal: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		if (!canAny(user.roles, 'MANAGE_STATUTORY_RATES')) error(403, 'Insufficient permissions')

		const id = String((await request.formData()).get('proposalId') ?? '')
		if (!id) return fail(400, { error: 'Missing proposal id.' })

		await confirmProposal(user.organizationId, id, ctxOf(user, getClientAddress))
		return { success: 'Proposal applied to the live rates.' }
	},

	rejectProposal: async ({ request, locals, getClientAddress }) => {
		const user = locals.user!
		if (!canAny(user.roles, 'MANAGE_STATUTORY_RATES')) error(403, 'Insufficient permissions')

		const id = String((await request.formData()).get('proposalId') ?? '')
		if (!id) return fail(400, { error: 'Missing proposal id.' })

		await rejectProposal(user.organizationId, id, ctxOf(user, getClientAddress))
		return { success: 'Proposal rejected.' }
	}
}
