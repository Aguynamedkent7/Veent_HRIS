import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { login, USERS } from './helpers'

// #134: payroll runs adopt the maker → verifier → approver chain. The computing user is
// the maker (MAKE auto-completed, entering VERIFY); a Verifier then an Approver sign off,
// and only the final APPROVE commits the run to APPROVED. Any stage may return it to the
// maker with a reason. These tests drive the real chain through the form actions.
test.describe.configure({ mode: 'serial' })

const HAPPY_START = '2026-09-01'
const HAPPY_END = '2026-09-15'
const REJECT_START = '2026-10-01'
const REJECT_END = '2026-10-15'

test.afterAll(async () => {
	const db = new PrismaClient()
	try {
		const runs = await db.payrollRun.findMany({
			where: {
				organizationId: 'org_seed',
				periodStart: { in: [new Date(HAPPY_START), new Date(REJECT_START)] }
			},
			select: { id: true }
		})
		const ids = runs.map((r) => r.id)
		if (ids.length) {
			// Entries first (cascades to earning/deduction lines); the run delete then
			// cascades its approval steps.
			await db.payrollEntry.deleteMany({ where: { payrollRunId: { in: ids } } })
			await db.payrollRun.deleteMany({ where: { id: { in: ids } } })
		}
	} finally {
		await db.$disconnect()
	}
})

// Create + compute a run as the admin (maker), returning its id.
async function makeComputedRun(
	page: Page,
	periodStart: string,
	periodEnd: string
): Promise<string> {
	await login(page, USERS.admin)
	const origin = new URL(page.url()).origin

	const created = await page.request.post('/payroll?/create', {
		form: { periodStart, periodEnd },
		headers: { origin }
	})
	expect(created.status()).toBe(200)

	const db = new PrismaClient()
	let id: string
	try {
		const run = await db.payrollRun.findFirstOrThrow({
			where: { organizationId: 'org_seed', periodStart: new Date(periodStart) },
			select: { id: true }
		})
		id = run.id
	} finally {
		await db.$disconnect()
	}

	const computed = await page.request.post('/payroll?/compute', {
		form: { id },
		headers: { origin }
	})
	expect(computed.status()).toBe(200)
	return id
}

// Act on a run's live stage via the detail-page decide action.
async function decide(page: Page, id: string, action: 'approve' | 'return', note = '') {
	const res = await page.request.post(`/payroll/${id}?/decide`, {
		form: { action, note },
		headers: { origin: new URL(page.url()).origin }
	})
	return res.status()
}

test('happy path: compute (make) → verify → approve → APPROVED', async ({ browser }) => {
	// Heavy: three logins in separate contexts + a full payroll compute. Triple the
	// timeout so a cold dev-server compile doesn't flake the run.
	test.slow()
	const mkCtx = await browser.newContext()
	const id = await makeComputedRun(await mkCtx.newPage(), HAPPY_START, HAPPY_END)
	await mkCtx.close()

	// VERIFY — the Verifier signs off; run stays COMPUTED, advances to APPROVE.
	const vCtx = await browser.newContext()
	const vPage = await vCtx.newPage()
	await login(vPage, USERS.verifier)
	expect(await decide(vPage, id, 'approve')).toBe(200)
	await vCtx.close()

	// APPROVE — the Approver commits the run.
	const aCtx = await browser.newContext()
	const aPage = await aCtx.newPage()
	await login(aPage, USERS.approver)
	expect(await decide(aPage, id, 'approve')).toBe(200)

	await aPage.goto(`/payroll/${id}`, { waitUntil: 'domcontentloaded' })
	const text = await aPage.locator('body').innerText()
	expect(text).toMatch(/APPROVED/)
	expect(text).toMatch(/Prepared/) // MAKE stage
	expect(text).toMatch(/Verified/)
	expect(text).toMatch(/Approved/)
	await aCtx.close()
})

test('reject at verify returns the run to the maker', async ({ browser }) => {
	test.slow()
	const mkCtx = await browser.newContext()
	const id = await makeComputedRun(await mkCtx.newPage(), REJECT_START, REJECT_END)
	await mkCtx.close()

	// The Verifier returns it with a reason.
	const vCtx = await browser.newContext()
	const vPage = await vCtx.newPage()
	await login(vPage, USERS.verifier)
	expect(await decide(vPage, id, 'return', 'headcount looks off — recheck before refiling')).toBe(
		200
	)

	await vPage.goto(`/payroll/${id}`, { waitUntil: 'domcontentloaded' })
	const text = await vPage.locator('body').innerText()
	expect(text).toMatch(/Returned/)
	expect(text).toMatch(/headcount looks off/)
	await vCtx.close()

	// An Approver cannot then approve a returned run — the stage is closed until a
	// recompute reopens it. The service blocks this with a fail(), which SvelteKit
	// serialises as HTTP 200, so assert on the persisted state: the run is still
	// returned (not APPROVED) after the attempt.
	const aCtx = await browser.newContext()
	const aPage = await aCtx.newPage()
	await login(aPage, USERS.approver)
	await decide(aPage, id, 'approve')
	await aPage.goto(`/payroll/${id}`, { waitUntil: 'domcontentloaded' })
	const after = await aPage.locator('body').innerText()
	expect(after).toMatch(/recompute this run to refile/i)
	await aCtx.close()
})
