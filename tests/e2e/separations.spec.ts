import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

/**
 * #305 — "who may act needs a live check".
 *
 * Every other separation test in this repo mocks `$lib/server/db` and calls the handler
 * directly, which proves what the code DOES but never that the deployed page actually opens
 * or closes for a real logged-in user. This is the first e2e coverage of /separations at all;
 * future separation e2e work belongs in this file rather than a second spec.
 *
 * Both halves matter. E1 alone would still pass if the gate were deleted; E2 alone would
 * still pass if the page were broken for everyone.
 */
test.describe('Separations capability gate (#305)', () => {
	test('an HR admin reaches the separations list', async ({ page }) => {
		// hr@veent.ph is HR_ADMIN — MANAGE_HR without system administration.
		await login(page, USERS.hr)
		const res = await page.goto('/separations', { waitUntil: 'domcontentloaded' })

		expect(res?.status()).toBe(200)
		await expect(page.getByRole('heading', { name: 'Separations', level: 1 })).toBeVisible()
	})

	test('a plain employee is refused', async ({ page }) => {
		// employee@veent.ph holds only EMPLOYEE, which does not carry MANAGE_HR.
		await login(page, USERS.employee)
		const res = await page.goto('/separations', { waitUntil: 'domcontentloaded' })

		expect(res?.status()).toBe(403)
		// A 403 that still rendered the list would be worse than no gate at all.
		await expect(page.getByRole('heading', { name: 'Separations', level: 1 })).toHaveCount(0)
	})
})
