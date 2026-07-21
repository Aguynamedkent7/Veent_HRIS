import { describe, it, expect } from 'vitest'
import { resolveBranchManager, selectableBranches } from '../../src/lib/server/services/branches'

describe('resolveBranchManager — manager/roster invariant', () => {
	it('keeps the manager and does not reassign when they are already on this branch', () => {
		expect(resolveBranchManager('OPEN', 'emp1', 'br1', 'br1')).toEqual({
			managerId: 'emp1',
			reassignManager: false
		})
	})

	it('reassigns when the named manager currently sits on a different branch', () => {
		expect(resolveBranchManager('OPEN', 'emp1', 'br2', 'br1')).toEqual({
			managerId: 'emp1',
			reassignManager: true
		})
	})

	it('reassigns when the named manager has no branch yet', () => {
		expect(resolveBranchManager('OPEN', 'emp1', null, 'br1')).toEqual({
			managerId: 'emp1',
			reassignManager: true
		})
	})

	// The create path: the branch id passed in is the row just inserted, so the manager can
	// never already be on it. If this returned false, a new branch's manager would silently
	// be left off their own roster.
	it('reassigns on create, where the branch is brand new', () => {
		expect(resolveBranchManager('OPEN', 'emp1', null, 'br_new')).toEqual({
			managerId: 'emp1',
			reassignManager: true
		})
	})

	it('treats a blank or whitespace manager as none', () => {
		expect(resolveBranchManager('OPEN', null, null, 'br1')).toEqual({
			managerId: null,
			reassignManager: false
		})
		expect(resolveBranchManager('OPEN', '   ', null, 'br1')).toEqual({
			managerId: null,
			reassignManager: false
		})
	})

	it('clears the manager on a CLOSED branch — nobody is on duty at a closed store', () => {
		expect(resolveBranchManager('CLOSED', 'emp1', 'br1', 'br1')).toEqual({
			managerId: null,
			reassignManager: false
		})
	})
})

describe('selectableBranches — picker options', () => {
	const branches = [
		{ id: 'br1', status: 'OPEN' as const },
		{ id: 'br2', status: 'CLOSED' as const },
		{ id: 'br3', status: 'OPEN' as const }
	]

	it('offers only open branches when the employee has none', () => {
		expect(selectableBranches(branches, null).map((b) => b.id)).toEqual(['br1', 'br3'])
	})

	it("keeps a closed branch when it is the employee's current one", () => {
		expect(selectableBranches(branches, 'br2').map((b) => b.id)).toEqual(['br1', 'br2', 'br3'])
	})

	it('does not duplicate when the current branch is already open', () => {
		expect(selectableBranches(branches, 'br1').map((b) => b.id)).toEqual(['br1', 'br3'])
	})
})
