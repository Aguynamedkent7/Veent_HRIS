import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

// #53: each dashboard metric card is a one-click drill-down to its module page.
test.describe('Dashboard metric cards navigate', () => {
	const cards = [
		{ label: 'Active Employees', target: '/employees' },
		{ label: 'On Leave Today', target: '/leave' },
		// The unified approvals inbox lives at /requests (/approvals 308-redirects there).
		{ label: 'Pending Approvals', target: '/requests' },
		{ label: 'Last Payroll', target: '/payroll' }
	]

	for (const { label, target } of cards) {
		test(`"${label}" card links to ${target}`, async ({ page }) => {
			await login(page, USERS.admin)
			// The whole card is the anchor, so its accessible name includes the metric
			// value and subtitle — match on the card label substring.
			await page.getByRole('link', { name: new RegExp(label, 'i') }).click()
			await page.waitForURL(`**${target}`, { waitUntil: 'domcontentloaded' })
			await expect(page).toHaveURL(new RegExp(`${target}$`))
		})
	}
})
