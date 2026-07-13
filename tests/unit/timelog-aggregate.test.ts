import { describe, it, expect } from 'vitest'
import { pairPunchesToDailyHours, type PunchLite } from '$lib/server/services/timelog'
import { manilaDayKey, manilaWeekStart } from '$lib/utils/dates'

// Helper: build a punch from a UTC ISO string.
const p = (punchType: 'IN' | 'OUT', iso: string): PunchLite => ({ punchType, timestamp: new Date(iso) })

describe('manila timezone helpers (UTC+8)', () => {
	it('buckets a UTC instant into the correct PHT calendar day across midnight', () => {
		// 23:30 PHT Jul 6  == 15:30 UTC Jul 6
		expect(manilaDayKey(new Date('2026-07-06T15:30:00Z'))).toBe('2026-07-06')
		// 00:30 PHT Jul 7  == 16:30 UTC Jul 6
		expect(manilaDayKey(new Date('2026-07-06T16:30:00Z'))).toBe('2026-07-07')
	})

	it('computes the PHT week start (Mon 00:00 PHT) as a UTC instant', () => {
		// Wed Jul 8 2026, 13:00 PHT -> week Monday is Jul 6, 00:00 PHT == Jul 5 16:00 UTC
		expect(manilaWeekStart(new Date('2026-07-08T05:00:00Z')).toISOString()).toBe('2026-07-05T16:00:00.000Z')
	})
})

describe('pairPunchesToDailyHours', () => {
	it('pairs a simple IN/OUT into that PHT day', () => {
		const { hoursByDay, warnings } = pairPunchesToDailyHours([
			p('IN', '2026-07-06T01:00:00Z'), // 09:00 PHT
			p('OUT', '2026-07-06T09:00:00Z') // 17:00 PHT
		])
		expect(hoursByDay).toEqual({ '2026-07-06': 8 })
		expect(warnings).toHaveLength(0)
	})

	it('sums multiple pairs within the same day', () => {
		const { hoursByDay } = pairPunchesToDailyHours([
			p('IN', '2026-07-06T01:00:00Z'), // 09:00 PHT
			p('OUT', '2026-07-06T05:00:00Z'), // 13:00 PHT (4h)
			p('IN', '2026-07-06T06:00:00Z'), // 14:00 PHT
			p('OUT', '2026-07-06T09:30:00Z') // 17:30 PHT (3.5h)
		])
		expect(hoursByDay).toEqual({ '2026-07-06': 7.5 })
	})

	it('attributes an overnight shift to the PHT day it started on', () => {
		const { hoursByDay, warnings } = pairPunchesToDailyHours([
			p('IN', '2026-07-06T15:00:00Z'), // 23:00 PHT Jul 6
			p('OUT', '2026-07-06T19:00:00Z') // 03:00 PHT Jul 7 (4h)
		])
		expect(hoursByDay).toEqual({ '2026-07-06': 4 })
		expect(warnings).toHaveLength(0)
	})

	it('sorts out-of-order punches before pairing', () => {
		const { hoursByDay } = pairPunchesToDailyHours([
			p('OUT', '2026-07-06T09:00:00Z'),
			p('IN', '2026-07-06T01:00:00Z')
		])
		expect(hoursByDay).toEqual({ '2026-07-06': 8 })
	})

	it('warns on a missing OUT and does not count it', () => {
		const { hoursByDay, warnings } = pairPunchesToDailyHours([
			p('IN', '2026-07-06T01:00:00Z'), // dangling IN
			p('IN', '2026-07-06T02:00:00Z'), // 10:00 PHT
			p('OUT', '2026-07-06T10:00:00Z') // 18:00 PHT (8h)
		])
		expect(hoursByDay).toEqual({ '2026-07-06': 8 })
		expect(warnings.some((w) => w.includes('Missing OUT'))).toBe(true)
	})

	it('warns on a stray OUT with no matching IN', () => {
		const { hoursByDay, warnings } = pairPunchesToDailyHours([p('OUT', '2026-07-06T09:00:00Z')])
		expect(hoursByDay).toEqual({})
		expect(warnings.some((w) => w.includes('without a matching IN'))).toBe(true)
	})

	it('returns empty result for no punches', () => {
		expect(pairPunchesToDailyHours([])).toEqual({ hoursByDay: {}, warnings: [] })
	})
})
