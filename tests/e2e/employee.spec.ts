import { test, expect } from '@playwright/test'
import { login, USERS, nextWeekdayISO } from './helpers'

// Quickstart Scenario 4 (leave) + profile self-service (US1).
test.describe.configure({ mode: 'serial' })

test.describe('Employee self-service', () => {
	test('files a leave request that appears as PENDING', async ({ page }) => {
		await login(page, USERS.employee)
		await page.goto('/leave/new')
		// Wait for hydration before touching the bound <select>; otherwise Svelte's
		// bind:value re-initialises it to empty after our selection.
		await page.waitForLoadState('networkidle')

		const leaveType = page.getByLabel('Leave Type')
		await leaveType.selectOption({ label: 'Vacation Leave' })
		await expect(leaveType).not.toHaveValue('')
		const day = nextWeekdayISO()
		await page.getByLabel('Start Date').fill(day)
		await page.getByLabel('End Date').fill(day)
		await page.getByRole('button', { name: 'Submit Request' }).click()

		// On success the action redirects back to /leave.
		await page.waitForURL('**/leave')
		const row = page.locator('tbody tr', { hasText: 'Vacation Leave' }).first()
		await expect(row).toBeVisible()
		await expect(row.getByText('PENDING')).toBeVisible()
	})

	test('updates profile contact details', async ({ page }) => {
		await login(page, USERS.employee)
		await page.goto('/profile')

		await page.getByLabel('Phone').fill('+63 917 555 0101')
		await page.getByRole('button', { name: 'Save Changes' }).click()

		await expect(page.getByText('Profile updated successfully.')).toBeVisible()
	})
})
