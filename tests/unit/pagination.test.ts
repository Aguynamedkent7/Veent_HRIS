import { describe, it, expect } from 'vitest'
import { paginate } from '$lib/server/pagination'

const url = (qs = '') => new URL(`http://localhost/list${qs}`)

describe('paginate', () => {
	it('defaults to page 1 with pageSize 10', () => {
		const p = paginate(url(), 137)
		expect(p).toMatchObject({ page: 1, pageSize: 10, skip: 0, take: 10, totalPages: 14 })
		expect(p.label).toBe('1–10 of 137')
	})

	it('computes skip/take and the range label for a middle page', () => {
		const p = paginate(url('?page=2'), 137)
		expect(p.skip).toBe(10)
		expect(p.take).toBe(10)
		expect(p.label).toBe('11–20 of 137')
	})

	it('clamps page < 1 and non-numeric input to 1', () => {
		expect(paginate(url('?page=0'), 50).page).toBe(1)
		expect(paginate(url('?page=-3'), 50).page).toBe(1)
		expect(paginate(url('?page=banana'), 50).page).toBe(1)
		expect(paginate(url('?page=1.9'), 50).page).toBe(1)
	})

	it('clamps beyond the last page so the last page is served', () => {
		const p = paginate(url('?page=99'), 137)
		expect(p.page).toBe(14)
		expect(p.skip).toBe(130)
		expect(p.label).toBe('131–137 of 137')
	})

	it('reads a custom param name and ignores the default one', () => {
		const p = paginate(url('?myPage=3&page=9'), 100, { param: 'myPage' })
		expect(p.page).toBe(3)
		expect(p.param).toBe('myPage')
		expect(p.skip).toBe(20)
	})

	it('honours a custom page size', () => {
		const p = paginate(url('?page=2'), 137, { pageSize: 50 })
		expect(p).toMatchObject({ page: 2, skip: 50, take: 50, totalPages: 3 })
		expect(p.label).toBe('51–100 of 137')
	})

	it('handles an empty result set without a phantom page', () => {
		const p = paginate(url('?page=5'), 0)
		expect(p).toMatchObject({ page: 1, skip: 0, start: 0, end: 0, total: 0, totalPages: 1 })
		expect(p.label).toBe('0–0 of 0')
	})
})
