import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

// #131: a cross-org CEO logs in, switches tenants via the header dropdown, and sees
// only the selected org's data. "Head of Operations" is JoJo Potato's on-branch
// Manager (#140) and does not exist in Veent — so it cleanly proves the org switched.
test.describe('Cross-org tenancy switch', () => {
	test('CEO switches from Veent to JoJo Potato and sees that org’s roster', async ({ page }) => {
		// Land in Veent (the CEO picks a tenant on the Avipa login).
		await login(page, USERS.ceo, 'Veent')

		// The switcher shows the current org and is only rendered for multi-org members.
		const switcher = page.getByRole('button', { name: 'Veent', exact: true })
		await expect(switcher).toBeVisible()

		// Veent has no "Head of Operations".
		await page.goto('/employees', { waitUntil: 'domcontentloaded' })
		await expect(page.getByText('Head of Operations')).toHaveCount(0)

		// Switch to JoJo Potato. Opening the dropdown is client-side, so retry the
		// switcher click until the menu item appears (guards against a pre-hydration click).
		const jojoItem = page.getByRole('button', { name: 'JoJo Potato', exact: true })
		await expect(async () => {
			await switcher.click()
			await expect(jojoItem).toBeVisible({ timeout: 1000 })
		}).toPass({ timeout: 15000 })

		// Click the menu item and wait for the server to persist the switch (the endpoint
		// writes session.currentOrgId) BEFORE navigating — otherwise a hard nav can race
		// the async switch and read the old org.
		await Promise.all([
			page.waitForResponse(
				(r) => r.url().includes('/api/v1/session/switch-org') && r.request().method() === 'POST'
			),
			jojoItem.click()
		])

		// Now the roster is JoJo Potato's — the branch Manager's job title shows up, and it
		// never existed under Veent.
		await page.goto('/employees', { waitUntil: 'domcontentloaded' })
		await expect(page.getByText('Head of Operations').first()).toBeVisible()
	})
})
