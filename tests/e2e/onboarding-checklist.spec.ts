import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

// #116 — customizable onboarding checklist. The seed materializes the derived steps plus
// one manual example ("Orientation completed") for Veent, so the editor is populated.
test.describe.configure({ mode: 'serial' })

// Rows carry data-label so they can be targeted after a client-side (enhance) update —
// Svelte patches the input value property, not the SSR value attribute.
const row = (page: import('@playwright/test').Page, label: string) =>
	page.locator(`li[data-label="${label}"]`)

test.describe('Onboarding checklist settings (#116)', () => {
	test('HR sees derived + manual steps and can add then remove a manual step', async ({ page }) => {
		await login(page, USERS.admin)
		await page.goto('/settings/onboarding', { waitUntil: 'domcontentloaded' })

		await expect(page.getByRole('heading', { name: 'Onboarding Checklist' })).toBeVisible()
		// Derived step (seeded) and the manual example are both present.
		await expect(row(page, 'Position assigned')).toBeVisible()
		await expect(row(page, 'Orientation completed')).toBeVisible()

		// Add a manual step.
		const label = 'E2E equipment issued'
		await page.getByPlaceholder('e.g. Orientation attended').fill(label)
		await page.getByRole('button', { name: 'Add step' }).click()
		await expect(row(page, label)).toBeVisible()

		// Remove it via the confirm dialog.
		await row(page, label).getByRole('button', { name: 'Delete' }).click()
		await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
		await expect(row(page, label)).toHaveCount(0)
	})

	test('a manual step appears with a toggle on the 201 file and can be ticked', async ({
		page
	}) => {
		await login(page, USERS.admin)
		await page.goto('/employees', { waitUntil: 'domcontentloaded' })
		// The list rows navigate via onclick, so wait for hydration before clicking.
		await page.waitForLoadState('networkidle')
		await page.locator('tbody tr').first().click()
		await page.waitForURL(/\/employees\/[a-z0-9]+$/i)

		// The Onboarding card lists the seeded manual step with a toggle button. Ticking it
		// posts the completion; the step then reads as done (aria-pressed flips true).
		const toggle = page.getByRole('button', { name: /Orientation completed/ })
		await expect(toggle).toBeVisible()
		if ((await toggle.getAttribute('aria-pressed')) === 'false') {
			await toggle.click()
			await expect(
				page.getByRole('button', { name: /Uncheck Orientation completed/ })
			).toBeVisible()
		}
	})
})
