import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { login, USERS } from './helpers'

/**
 * #278 — no payslip is readable while its payroll run is a draft, at any door.
 *
 * Two of the four doors (the PDF service and the /payslips/[id] page) let any
 * VIEW_PAYROLL_REPORTS holder read a payslip out of a DRAFT or COMPUTED run; the JSON door never
 * did. This spec pins all three single-payslip doors against one seeded DRAFT entry, plus the list
 * door, plus the anti-lockout half against an APPROVED control.
 *
 * The DRAFT entry carries a deliberately distinctive figure (133713) so every 403 body can be
 * grepped for a leak: a 403 that still ships the payload is not a fix.
 *
 * Serial — beforeAll runs once per worker under fullyParallel, so without this the file's tests
 * land on different workers and race to create the same period (PayrollRun is unique on
 * organizationId + periodStart + periodEnd). Same reason payslip-tenancy is serial.
 */
test.describe.configure({ mode: 'serial' })

// Periods chosen because nothing else in tests/, prisma/ or src/ uses 2025-04.
const DRAFT_PERIOD = { start: new Date('2025-04-01'), end: new Date('2025-04-15') }
const APPROVED_PERIOD = { start: new Date('2025-04-16'), end: new Date('2025-04-30') }
const SECRET = '133713'
/** The page formats with separators, so the raw figure alone is not a sufficient grep. */
const SECRET_FORMATTED = '133,713'

let draftEntryId: string
let approvedEntryId: string

const MONEY = {
	sssEe: 0,
	sssEr: 0,
	philhealthEe: 0,
	philhealthEr: 0,
	pagibigEe: 0,
	pagibigEr: 0,
	withholdingTax: 0,
	totalDeductions: 0
}

test.beforeAll(async () => {
	const db = new PrismaClient()
	try {
		const own = await db.employee.findFirstOrThrow({
			where: { user: { email: 'employee@veent.ph' } },
			select: { id: true, organizationId: true }
		})

		// No PayrollPeriod attached: `period` is optional, and a run with no period exercises the
		// `run.period?.status` arm of isPayslipVisible against null.
		const draftRun = await db.payrollRun.create({
			data: {
				organizationId: own.organizationId,
				periodStart: DRAFT_PERIOD.start,
				periodEnd: DRAFT_PERIOD.end,
				status: 'DRAFT'
			}
		})
		const draftEntry = await db.payrollEntry.create({
			data: {
				payrollRunId: draftRun.id,
				employeeId: own.id,
				hoursWorked: 80,
				basicPay: Number(SECRET),
				grossPay: Number(SECRET),
				netPay: Number(SECRET),
				...MONEY
			}
		})
		draftEntryId = draftEntry.id

		const approvedRun = await db.payrollRun.create({
			data: {
				organizationId: own.organizationId,
				periodStart: APPROVED_PERIOD.start,
				periodEnd: APPROVED_PERIOD.end,
				status: 'APPROVED'
			}
		})
		const approvedEntry = await db.payrollEntry.create({
			data: {
				payrollRunId: approvedRun.id,
				employeeId: own.id,
				hoursWorked: 80,
				basicPay: 30000,
				grossPay: 30000,
				netPay: 30000,
				...MONEY
			}
		})
		approvedEntryId = approvedEntry.id
	} finally {
		await db.$disconnect()
	}
})

test.afterAll(async () => {
	const db = new PrismaClient()
	try {
		// Children first — the relation is RESTRICT on delete.
		for (const period of [DRAFT_PERIOD, APPROVED_PERIOD]) {
			await db.payrollEntry.deleteMany({
				where: { payrollRun: { periodStart: period.start, periodEnd: period.end } }
			})
			await db.payrollRun.deleteMany({
				where: { periodStart: period.start, periodEnd: period.end }
			})
		}
	} finally {
		await db.$disconnect()
	}
})

/** No 403 body may carry the payslip's figures, in either formatting. */
function expectNoLeak(body: string) {
	expect(body).not.toContain(SECRET)
	expect(body).not.toContain(SECRET_FORMATTED)
}

// ─── Door A: the PDF ──────────────────────────────────────────────────────────
// Both roles hold VIEW_PAYROLL_REPORTS and both used to get real PDF bytes here.
for (const role of ['ceo', 'admin'] as const) {
	test(`E1/E2 ${role} cannot pull a DRAFT payslip PDF (#278)`, async ({ page }) => {
		await login(page, USERS[role])
		const response = await page.request.get(`/api/v1/payroll/payslips/${draftEntryId}/pdf`)
		expect(response.status()).toBe(403)
		expect((await response.json()).error).toBe('Payslip not yet available')
		expectNoLeak(await response.text())
	})
}

// ─── Door B: the /payslips/[id] page ──────────────────────────────────────────
// Status-only, deliberately: src/routes/+error.svelte renders a fixed 403 body and never prints
// $page.error.message, so neither of this door's two guards is distinguishable from the response.
// Requesting with `accept: application/json` was tried first and returns the same HTML page.
// Doors A and C pin gate order by message (U8 in the unit file, E6 below); this door cannot.
test('E3 a CEO cannot open a DRAFT payslip page (#278)', async ({ page }) => {
	await login(page, USERS.ceo)
	const response = await page.request.get(`/payslips/${draftEntryId}`)
	expect(response.status()).toBe(403)
	expectNoLeak(await response.text())
})

test('E4 the owner cannot open their own DRAFT payslip page — fail-CLOSED sentinel', async ({
	page
}) => {
	await login(page, USERS.employee)
	const response = await page.request.get(`/payslips/${draftEntryId}`)
	expect(response.status()).toBe(403)
	expectNoLeak(await response.text())
})

// ─── Door C: the JSON endpoint (already strict — pinned so it stays that way) ──
test('E5 a CEO cannot read a DRAFT payslip as JSON', async ({ page }) => {
	await login(page, USERS.ceo)
	const response = await page.request.get(`/api/v1/payroll/payslips/${draftEntryId}`)
	expect(response.status()).toBe(403)
	expect((await response.json()).error).toBe('Payslip not yet available')
	expectNoLeak(await response.text())
})

test('E6 a manager reading their OWN REPORT is stopped by the draft gate, not the access gate', async ({
	page
}) => {
	// employee@veent.ph reports to manager@veent.ph, so the access gate passes and the message
	// proves which of the two 403s answered.
	await login(page, USERS.manager)
	const response = await page.request.get(`/api/v1/payroll/payslips/${draftEntryId}`)
	expect(response.status()).toBe(403)
	expect((await response.json()).error).toBe('Payslip not yet available')
	expectNoLeak(await response.text())
})

// ─── Anti-lockout: an APPROVED run is still readable at every door ────────────
test('E7 a CEO still pulls an APPROVED payslip PDF', async ({ page }) => {
	await login(page, USERS.ceo)
	const response = await page.request.get(`/api/v1/payroll/payslips/${approvedEntryId}/pdf`)
	expect(response.status()).toBe(200)
	expect(response.headers()['content-type']).toContain('application/pdf')
})

test('E8 the owner still opens their APPROVED payslip page', async ({ page }) => {
	await login(page, USERS.employee)
	const response = await page.request.get(`/payslips/${approvedEntryId}`)
	expect(response.status()).toBe(200)
})

test('E9 a CEO still reads an APPROVED payslip as JSON', async ({ page }) => {
	await login(page, USERS.ceo)
	const response = await page.request.get(`/api/v1/payroll/payslips/${approvedEntryId}`)
	expect(response.status()).toBe(200)
})

// ─── Door D: the list ─────────────────────────────────────────────────────────
test('E10 the payslip list shows the APPROVED run and not the DRAFT one', async ({ page }) => {
	await login(page, USERS.employee)
	await page.goto('/payslips', { waitUntil: 'domcontentloaded' })
	// `.first()`: the Table component renders each row twice (wide table + narrow card), so a count
	// of 1 is wrong in the direction that matters least. Presence is the anti-lockout half; absence
	// below is exact.
	await expect(page.locator(`a[href="/payslips/${approvedEntryId}"]`).first()).toBeVisible()
	await expect(page.locator(`a[href="/payslips/${draftEntryId}"]`)).toHaveCount(0)
	expectNoLeak(await page.content())
})
