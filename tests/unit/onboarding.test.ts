import { describe, it, expect } from 'vitest'
import {
	buildOnboardingSteps,
	DERIVED_STEPS,
	type ChecklistItemLike,
	type OnboardingEmployee
} from '../../src/lib/server/services/onboarding'

// A fully-onboarded employee: every derived predicate is satisfied.
const complete: OnboardingEmployee = {
	positionId: 'pos1',
	workScheduleId: 'sch1',
	basicMonthlySalary: 25000,
	bankName: 'BDO',
	bankAccountName: 'Juan Dela Cruz',
	bankAccountNumber: '000123',
	gcashNumber: null,
	sssNumber: '34-1',
	philhealthNumber: 'PH-1',
	pagibigNumber: 'PG-1',
	tinNumber: 'TIN-1',
	user: { isActive: true }
}

// A brand-new hire with nothing filled in yet.
const empty: OnboardingEmployee = {
	positionId: null,
	workScheduleId: null,
	basicMonthlySalary: null,
	bankName: null,
	bankAccountName: null,
	bankAccountNumber: null,
	gcashNumber: null,
	sssNumber: null,
	philhealthNumber: null,
	pagibigNumber: null,
	tinNumber: null,
	user: { isActive: false }
}

describe('buildOnboardingSteps — fallback to derived defaults (#116)', () => {
	it('uses the built-in derived steps when the org has no config', () => {
		const r = buildOnboardingSteps([], new Set(), empty, [])
		expect(r.steps).toHaveLength(DERIVED_STEPS.length)
		expect(r.steps.every((s) => s.kind === 'DERIVED' && !s.manual)).toBe(true)
	})

	it('marks every derived step done for a fully-onboarded employee → complete', () => {
		const r = buildOnboardingSteps([], new Set(), complete, ['CONTRACT'])
		expect(r.doneCount).toBe(r.total)
		expect(r.complete).toBe(true)
	})

	it('only the always-on schedule step is done for a brand-new hire', () => {
		const r = buildOnboardingSteps([], new Set(), empty, [])
		// `schedule` is satisfied by the org default; nothing else is filled in.
		expect(r.steps.find((s) => s.label === 'Work schedule assigned')?.done).toBe(true)
		expect(r.doneCount).toBe(1)
		expect(r.complete).toBe(false)
	})

	it('needs a CONTRACT document category for the contract step', () => {
		const withDoc = buildOnboardingSteps([], new Set(), complete, ['CONTRACT'])
		const withoutDoc = buildOnboardingSteps([], new Set(), complete, ['PAYSLIP'])
		expect(withDoc.complete).toBe(true)
		expect(withoutDoc.complete).toBe(false)
	})

	it('accepts GCash as an alternative to a full bank triple for disbursement', () => {
		const gcashOnly: OnboardingEmployee = {
			...empty,
			user: { isActive: true },
			gcashNumber: '09171234567'
		}
		const disb = buildOnboardingSteps([], new Set(), gcashOnly, []).steps.find(
			(s) => s.label === 'Payroll disbursement registered'
		)
		expect(disb?.done).toBe(true)
	})
})

describe('buildOnboardingSteps — configured items + manual state', () => {
	const items: ChecklistItemLike[] = [
		{
			id: 'd-position',
			kind: 'DERIVED',
			derivedKey: 'position',
			label: 'Has a position',
			hint: ''
		},
		{ id: 'm-nda', kind: 'MANUAL', derivedKey: null, label: 'NDA signed', hint: 'Legal has it' },
		{ id: 'm-kit', kind: 'MANUAL', derivedKey: null, label: 'Equipment issued', hint: '' }
	]

	it('honors the configured order, labels, and kinds', () => {
		const r = buildOnboardingSteps(items, new Set(), empty, [])
		expect(r.steps.map((s) => s.label)).toEqual([
			'Has a position',
			'NDA signed',
			'Equipment issued'
		])
		expect(r.steps.map((s) => s.manual)).toEqual([false, true, true])
	})

	it('derives the configured DERIVED item from the record', () => {
		const off = buildOnboardingSteps(items, new Set(), empty, [])
		const on = buildOnboardingSteps(items, new Set(), complete, [])
		expect(off.steps[0].done).toBe(false)
		expect(on.steps[0].done).toBe(true)
	})

	it('reads MANUAL completion from the completed-id set', () => {
		const r = buildOnboardingSteps(items, new Set(['m-nda']), empty, [])
		expect(r.steps.find((s) => s.id === 'm-nda')?.done).toBe(true)
		expect(r.steps.find((s) => s.id === 'm-kit')?.done).toBe(false)
	})

	it('is complete only when derived predicates AND manual ticks all pass', () => {
		const partial = buildOnboardingSteps(items, new Set(['m-nda']), complete, [])
		expect(partial.complete).toBe(false) // m-kit still unticked
		const all = buildOnboardingSteps(items, new Set(['m-nda', 'm-kit']), complete, [])
		expect(all.complete).toBe(true)
	})

	it('treats an unknown derivedKey as not done rather than throwing', () => {
		const stale: ChecklistItemLike[] = [
			{ id: 'x', kind: 'DERIVED', derivedKey: 'no_such_key', label: 'Legacy', hint: '' }
		]
		const r = buildOnboardingSteps(stale, new Set(), complete, ['CONTRACT'])
		expect(r.steps[0].done).toBe(false)
	})
})
