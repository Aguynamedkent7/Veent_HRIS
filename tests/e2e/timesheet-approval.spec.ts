import { test, expect } from '@playwright/test'
import { login, USERS, verifyAndApproveTimesheet } from './helpers'

// Quickstart Scenarios 2 + 3: an employee creates a timesheet, submits it, and the
// manager approves it. Kept in one test so the create→submit→approve lifecycle is
// deterministic (no cross-file races).
//
// The create flow is now the shared New Timesheet popup (#86): pick a period, and
// entries are seeded from the employee's punches — no manual hour entry. This spec
// uses a future period with no punches, so the sheet totals 0.00 hrs, which also
// disambiguates it from the punch spec's 7.00-hr row in the shared review queue.
test.describe.configure({ mode: 'serial' })

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
]

// The New Timesheet dialog now locks to a standard pay period (#129) via a month/year +
// First-half/Second-half/Whole-month picker. Pick a whole month a few months out: no punches
// exist there (the punch spec seeds last week), so the derived timesheet is empty (0.00 hrs).
//
// Offset by the retry index: this test mutates state (it approves the sheet), and a timeout
// near the end used to leave an APPROVED row behind, so every retry then failed looking for a
// DRAFT in the same period — retries could never recover. Each attempt now works in its own month.
function futurePeriod(retry: number): { monthName: string; year: number } {
	const d = new Date()
	d.setDate(1)
	d.setMonth(d.getMonth() + 3 + retry)
	return { monthName: MONTHS[d.getMonth()], year: d.getFullYear() }
}

test('employee creates a timesheet, submits it, and the manager approves it', async ({
	browser
}, testInfo) => {
	// Three sequential logins in three browser contexts, each with a hydration retry
	// loop — this is legitimately the longest test in the suite and has no headroom in
	// the 30s default when the runner is busy. slow() triples the budget for this test
	// only; it is not covering for a hang (see the waitUntil fix in this file's history).
	test.slow()

	const { monthName, year } = futurePeriod(testInfo.retry)

	// --- Employee creates a draft from the New Timesheet popup, then submits it ---
	const empCtx = await browser.newContext()
	const empPage = await empCtx.newPage()
	await login(empPage, USERS.employee)
	await empPage.goto('/timesheets', { waitUntil: 'domcontentloaded' })

	// The header button opens the shared dialog client-side; retry until it hydrates.
	const dialog = empPage.getByRole('dialog', { name: 'New timesheet' })
	await expect(async () => {
		await empPage.getByRole('button', { name: 'New Timesheet' }).click()
		await expect(dialog).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15000 })

	// Standard-period picker: choose the target month/year, then the Whole-month segment.
	await dialog.locator('#pp-month').selectOption({ label: monthName })
	await dialog.locator('#pp-year').selectOption({ label: String(year) })
	await dialog.getByRole('button', { name: 'Whole month' }).click()
	await dialog.getByRole('button', { name: 'Create timesheet' }).click()

	// Redirects back to /timesheets with the new DRAFT (0.00 hrs — no punches seeded).
	await empPage.waitForURL('**/timesheets')
	const draftRow = empPage
		.locator('tr')
		.filter({ hasText: 'DRAFT' })
		.filter({ hasText: '0.00 hrs' })
	await expect(draftRow).toBeVisible()

	// Open the row modal (client-side) and submit for review.
	const empDialog = empPage.getByRole('dialog', { name: 'Timesheet review' })
	await expect(async () => {
		await draftRow.click()
		await expect(empDialog).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15000 })
	await empDialog.getByRole('button', { name: 'Submit for review' }).click()
	await expect(empPage.getByText('SUBMITTED').first()).toBeVisible()
	await empCtx.close()

	// --- Manager approves it from the approvals queue ---
	const mgrCtx = await browser.newContext()
	const mgrPage = await mgrCtx.newPage()
	await login(mgrPage, USERS.manager)
	await mgrPage.goto('/requests/timesheets', { waitUntil: 'domcontentloaded' })

	// Pin this spec's 0.0-hr card — the punch spec routes its own 7.00-hr submission
	// through this same queue, so an unqualified "Elena's card" would race with it.
	const card = mgrPage
		.locator('[role="button"]', { hasText: 'Employee, Elena' })
		.filter({ hasText: '0.0 hrs' })
	await expect(card).toBeVisible()
	const revDialog = mgrPage.getByRole('dialog', { name: 'Timesheet review' })
	await expect(async () => {
		await card.click()
		await expect(revDialog).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15000 })
	await revDialog.getByRole('button', { name: 'Approve' }).click()

	// The manager holds the MAKE stage (#134); approving advances it, so the card leaves
	// the manager's queue.
	await expect(card).toHaveCount(0)
	await mgrCtx.close()

	// --- Verifier then Approver sign off the rest of the chain ---
	await verifyAndApproveTimesheet(browser, '0.0 hrs')

	// --- Employee sees the timesheet as APPROVED ---
	const verifyCtx = await browser.newContext()
	const verifyPage = await verifyCtx.newPage()
	await login(verifyPage, USERS.employee)
	await verifyPage.goto('/timesheets', { waitUntil: 'domcontentloaded' })
	const approvedRow = verifyPage
		.locator('tr')
		.filter({ hasText: 'APPROVED' })
		.filter({ hasText: '0.00 hrs' })
	await expect(approvedRow).toBeVisible()
	await verifyCtx.close()
})
