import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

// Quickstart Scenarios 2 + 3: employee submits a timesheet, manager approves it.
// Kept in one test so the submit→approve lifecycle is deterministic (no cross-file races).
test.describe.configure({ mode: 'serial' })

test('employee submits a timesheet and the manager approves it', async ({ browser }) => {
	// --- Employee submits the current week's timesheet (auto-submitted) ---
	const empCtx = await browser.newContext()
	const empPage = await empCtx.newPage()
	await login(empPage, USERS.employee)
	await empPage.goto('/timesheets/new')

	// Wait for hydration: the hidden entries field is populated client-side once mounted.
	await expect(empPage.locator('input[name="entries"]')).toHaveValue(/hoursWorked/)

	// Log 8 hours on the first weekday. The grid commits on the `change` event, so
	// blur the input after filling; then confirm the reactive total before submitting.
	const firstDay = empPage.getByRole('spinbutton').first()
	await firstDay.fill('8')
	await firstDay.blur()
	await expect(empPage.getByText('8.0h')).toBeVisible()
	await empPage.getByRole('button', { name: 'Submit Timesheet' }).click()
	await empPage.waitForURL('**/timesheets')
	await expect(empPage.getByText('SUBMITTED').first()).toBeVisible()
	await empCtx.close()

	// --- Manager approves it from the approvals queue ---
	const mgrCtx = await browser.newContext()
	const mgrPage = await mgrCtx.newPage()
	await login(mgrPage, USERS.manager)
	// Timesheet approvals live on their own page under the Requests/Approvals dropdown.
	await mgrPage.goto('/requests/timesheets')

	// The direct report's submitted timesheet is waiting here. Clicking the card opens the
	// read-only review modal; Approve lives inside it now.
	const card = mgrPage.locator('[role="button"]', { hasText: 'Employee, Elena' }).first()
	await expect(card).toBeVisible()
	await card.click()
	const dialog = mgrPage.getByRole('dialog')
	await expect(dialog).toBeVisible()
	await dialog.getByRole('button', { name: 'Approve' }).click()

	// Once approved it leaves the pending queue.
	await expect(mgrPage.getByText('No pending timesheets to review.')).toBeVisible()
	await mgrCtx.close()

	// --- Employee sees the timesheet as APPROVED ---
	const verifyCtx = await browser.newContext()
	const verifyPage = await verifyCtx.newPage()
	await login(verifyPage, USERS.employee)
	await verifyPage.goto('/timesheets')
	await expect(verifyPage.getByText('APPROVED').first()).toBeVisible()
	await verifyCtx.close()
})
