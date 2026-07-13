import { describe, it, expect } from 'vitest'
import { requestSchema, deriveRequestColumns } from '$lib/server/schemas/requests'
import { resolveChain, DEFAULT_ROUTING } from '$lib/server/services/requests/routing'

describe('request validation (discriminated union)', () => {
	it('accepts a valid OVERTIME request', () => {
		const r = requestSchema.parse({ type: 'OVERTIME', date: '2026-07-20', hours: 2.5, reason: 'deadline' })
		expect(r.type).toBe('OVERTIME')
	})

	it('accepts a valid LEAVE request', () => {
		const r = requestSchema.parse({ type: 'LEAVE', leaveTypeId: 'lt1', startDate: '2026-07-20', endDate: '2026-07-22' })
		expect(r.type).toBe('LEAVE')
	})

	it('accepts a valid INFO_UPDATE request', () => {
		const r = requestSchema.parse({ type: 'INFO_UPDATE', field: 'contactAddress', requestedValue: '123 New St' })
		expect(r.type).toBe('INFO_UPDATE')
	})

	it('rejects an unknown type', () => {
		expect(() => requestSchema.parse({ type: 'BONUS', amount: 1 })).toThrow()
	})

	it('rejects OVERTIME without hours', () => {
		expect(() => requestSchema.parse({ type: 'OVERTIME', date: '2026-07-20' })).toThrow()
	})

	it('rejects non-positive / absurd OT hours', () => {
		expect(() => requestSchema.parse({ type: 'OVERTIME', date: '2026-07-20', hours: 0 })).toThrow()
		expect(() => requestSchema.parse({ type: 'OVERTIME', date: '2026-07-20', hours: 25 })).toThrow()
	})

	it('rejects INFO_UPDATE without requestedValue', () => {
		expect(() => requestSchema.parse({ type: 'INFO_UPDATE', field: 'x' })).toThrow()
	})
})

describe('deriveRequestColumns', () => {
	it('projects OT day/hours onto both dateFrom and dateTo', () => {
		const input = requestSchema.parse({ type: 'OVERTIME', date: '2026-07-20', hours: 3 })
		const c = deriveRequestColumns(input)
		expect(c.dateFrom?.toISOString().slice(0, 10)).toBe('2026-07-20')
		expect(c.dateTo?.toISOString().slice(0, 10)).toBe('2026-07-20')
		expect(c.hours).toBe(3)
	})

	it('projects LEAVE span with null hours', () => {
		const input = requestSchema.parse({ type: 'LEAVE', leaveTypeId: 'lt1', startDate: '2026-07-20', endDate: '2026-07-22' })
		const c = deriveRequestColumns(input)
		expect(c.dateFrom?.toISOString().slice(0, 10)).toBe('2026-07-20')
		expect(c.dateTo?.toISOString().slice(0, 10)).toBe('2026-07-22')
		expect(c.hours).toBeNull()
	})

	it('uses purpose as reason for OFFICIAL_BUSINESS', () => {
		const input = requestSchema.parse({ type: 'OFFICIAL_BUSINESS', startDate: '2026-07-20', endDate: '2026-07-20', location: 'Client HQ', purpose: 'kickoff' })
		expect(deriveRequestColumns(input).reason).toBe('kickoff')
	})

	it('leaves dates/hours null for INFO_UPDATE', () => {
		const input = requestSchema.parse({ type: 'INFO_UPDATE', field: 'contactPhone', requestedValue: '0917' })
		const c = deriveRequestColumns(input)
		expect(c.dateFrom).toBeNull()
		expect(c.dateTo).toBeNull()
		expect(c.hours).toBeNull()
	})
})

describe('routing / resolveChain', () => {
	it('routes OVERTIME through Supervisor → HR → Payroll', () => {
		const chain = resolveChain('OVERTIME', { hasSupervisor: true })
		expect(chain.map((s) => (s.stageKind === 'SUPERVISOR' ? 'SUP' : s.role))).toEqual(['SUP', 'HR_ADMIN', 'PAYROLL_OFFICER'])
		expect(chain.map((s) => s.stageIndex)).toEqual([0, 1, 2])
	})

	it('drops the supervisor stage and re-indexes when there is no supervisor', () => {
		const chain = resolveChain('OVERTIME', { hasSupervisor: false })
		expect(chain.map((s) => s.role)).toEqual(['HR_ADMIN', 'PAYROLL_OFFICER'])
		expect(chain.map((s) => s.stageIndex)).toEqual([0, 1])
	})

	it('routes INFO_UPDATE straight to HR (no supervisor stage)', () => {
		const chain = resolveChain('INFO_UPDATE', { hasSupervisor: true })
		expect(chain).toHaveLength(1)
		expect(chain[0]).toMatchObject({ stageIndex: 0, stageKind: 'ROLE', role: 'HR_ADMIN' })
	})

	it('has a chain defined for every request type', () => {
		for (const type of Object.keys(DEFAULT_ROUTING)) {
			expect(DEFAULT_ROUTING[type as keyof typeof DEFAULT_ROUTING].length).toBeGreaterThan(0)
		}
	})
})
