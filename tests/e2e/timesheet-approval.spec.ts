import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

// Quickstart Scenarios 2 + 3: an employee creates a timesheet, submits it, and the
// manager approves it. Kept in one test so the create→submit→approve lifecycle is
// deterministic (no cross-file races).
//
// The create flow is now the shared New Timesheet popup (#86): pick a period, and
// entries are seeded from the employee's punches — no manual hour entry. This spec
// uses a future period with no punches, so the sheet totals 0.00 hrs, which also
// disambiguates it from the punch spec's 7.00-hr row in the shared review queue.
test.describe.configure({ mode: 'serial' })

// ~30 days out: no punches exist there (the punch spec seeds last week), so the
// derived timesheet is empty, and the period never collides with the other specs.
function futurePeriod(): { start: string; end: string } {
	const startD = new Date()
	startD.setDate(startD.getDate() + 30)
	const endD = new Date(startD)
	endD.setDate(endD.getDate() + 4)
	return { start: startD.toISOString().slice(0, 10), end: endD.toISOString().slice(0, 10) }
}

test('employee creates a timesheet, submits it, and the manager approves it', async ({
	browser
}) => {
	const { start, end } = futurePeriod()

	// --- Employee creates a draft from the New Timesheet popup, then submits it ---
	const empCtx = await browser.newContext()
	const empPage = await empCtx.newPage()
	await login(empPage, USERS.employee)
	await empPage.goto('/timesheets')

	// The header button opens the shared dialog client-side; retry until it hydrates.
	const dialog = empPage.getByRole('dialog', { name: 'New timesheet' })
	await expect(async () => {
		await empPage.getByRole('button', { name: 'New Timesheet' }).click()
		await expect(dialog).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15000 })

	await dialog.locator('input[name="periodStart"]').fill(start)
	await dialog.locator('input[name="periodEnd"]').fill(end)
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
	await mgrPage.goto('/requests/timesheets')

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

	// Once approved, this timesheet leaves the pending queue.
	await expect(card).toHaveCount(0)
	await mgrCtx.close()

	// --- Employee sees the timesheet as APPROVED ---
	const verifyCtx = await browser.newContext()
	const verifyPage = await verifyCtx.newPage()
	await login(verifyPage, USERS.employee)
	await verifyPage.goto('/timesheets')
	const approvedRow = verifyPage
		.locator('tr')
		.filter({ hasText: 'APPROVED' })
		.filter({ hasText: '0.00 hrs' })
	await expect(approvedRow).toBeVisible()
	await verifyCtx.close()
})
