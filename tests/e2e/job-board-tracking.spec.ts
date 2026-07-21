import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

// #117 — manual job-board tracking. The seed provides the common boards and one demo
// posting (jp_seed_demo) so the checklist has something to act on.
test.describe.configure({ mode: 'serial' })

test.describe('Job-board tracking (#117)', () => {
	test('HR can manage the board catalog in Settings', async ({ page }) => {
		await login(page, USERS.admin)
		await page.goto('/settings/job-boards', { waitUntil: 'domcontentloaded' })

		await expect(page.getByRole('heading', { name: 'Job Boards' })).toBeVisible()
		// Seeded boards materialize on load. Rows carry data-name so they survive the
		// client-side (enhance) re-render after adding — input[value] would go stale.
		await expect(page.locator('li[data-name="JobStreet"]')).toBeVisible()

		// Add a board (tolerant of a prior run — boards can't be deleted, only toggled).
		await page.getByPlaceholder('e.g. Kalibrr').fill('Kalibrr E2E')
		await page.getByRole('button', { name: 'Add board' }).click()
		const row = page.locator('li[data-name="Kalibrr E2E"]')
		await expect(row).toBeVisible()

		// Toggle active and assert the label flips — works from either starting state.
		const toggle = row.getByRole('button', { name: /Deactivate|Activate/ })
		const before = (await toggle.textContent())?.trim()
		await toggle.click()
		await expect(async () => {
			const after = (
				await row.getByRole('button', { name: /Deactivate|Activate/ }).textContent()
			)?.trim()
			expect(after).not.toBe(before)
		}).toPass()
	})

	test('HR ticks a board with a URL, then closing surfaces the takedown', async ({ page }) => {
		await login(page, USERS.admin)
		await page.goto('/recruitment/jp_seed_demo', { waitUntil: 'domcontentloaded' })
		// Wait for hydration before touching the checkbox — otherwise hydration reconciles it
		// back to its server (unchecked) state after Playwright checks it, and the save posts
		// posted=false.
		await page.waitForLoadState('networkidle')

		// Keep the run rerun-safe: make sure the posting starts OPEN.
		const reopen = page.getByRole('button', { name: 'Reopen' })
		if (await reopen.count()) {
			await reopen.click()
			await expect(page.getByRole('button', { name: 'Close Posting' })).toBeVisible()
		}

		await expect(page.getByRole('heading', { name: 'Posted on' })).toBeVisible()

		// Tick JobStreet, paste a URL, save.
		const jobStreet = page.locator('li', { hasText: 'JobStreet' })
		await jobStreet.getByRole('checkbox').check()
		await jobStreet.locator('input[name="url"]').fill('https://jobstreet.com/jobs/123')
		await jobStreet.getByRole('button', { name: 'Save' }).click()
		await expect(page.getByText(/Posted on 1 of/)).toBeVisible()

		// A bad URL is rejected with a field-level error.
		await jobStreet.locator('input[name="url"]').fill('not-a-url')
		await jobStreet.getByRole('button', { name: 'Save' }).click()
		await expect(jobStreet.getByText(/valid URL/)).toBeVisible()

		// Close the posting → the still-live board is surfaced for takedown.
		await page.getByRole('button', { name: 'Close Posting' }).click()
		await expect(page.getByText(/still live on/)).toContainText('JobStreet')

		// Untick (record a takedown) → the warning clears.
		await jobStreet.getByRole('checkbox').uncheck()
		await jobStreet.getByRole('button', { name: 'Save' }).click()
		await expect(page.getByText(/still live on/)).toHaveCount(0)
	})
})
