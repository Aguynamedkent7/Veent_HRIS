import { describe, it, expect } from 'vitest'
import { resolveAssignedTo } from '../../src/lib/server/services/inventory'

describe('resolveAssignedTo — status/assignee invariant (#114)', () => {
	it('keeps the assignee when the item is ASSIGNED', () => {
		expect(resolveAssignedTo('ASSIGNED', 'emp1')).toEqual({
			assignedToId: 'emp1',
			needsAssignee: false
		})
	})

	it('flags a missing assignee for an ASSIGNED item', () => {
		expect(resolveAssignedTo('ASSIGNED', null)).toEqual({ assignedToId: null, needsAssignee: true })
		expect(resolveAssignedTo('ASSIGNED', '  ')).toEqual({ assignedToId: null, needsAssignee: true })
	})

	it('clears any assignee when the item is not ASSIGNED', () => {
		expect(resolveAssignedTo('IN_STOCK', 'emp1')).toEqual({
			assignedToId: null,
			needsAssignee: false
		})
		expect(resolveAssignedTo('RETIRED', 'emp1')).toEqual({
			assignedToId: null,
			needsAssignee: false
		})
	})
})
