import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

/**
 * #163 criterion 1 — adding a fourth `Custom range` segment must not move the default. The
 * every-15-days cutoff stays the path of least resistance: `First half (1–15)` is pre-selected,
 * `Custom range` is not, and its two date inputs do not exist in the DOM until it is chosen.
 *
 * Read-only: this spec never submits, so it writes nothing to the database.
 */
test('the create-run picker still opens on First half, with Custom range unselected', async ({
	page
}) => {
	await login(page, USERS.admin)
	await page.goto('/payroll', { waitUntil: 'domcontentloaded' })
	await page.getByRole('button', { name: 'New Payroll Run' }).click()

	const firstHalf = page.getByRole('button', { name: 'First half (1–15)' })
	const custom = page.getByRole('button', { name: 'Custom range' })
	await expect(firstHalf).toHaveAttribute('aria-pressed', 'true')
	await expect(custom).toHaveAttribute('aria-pressed', 'false')

	// The revealed inputs are absent, not merely hidden.
	await expect(page.locator('#pp-custom-start')).toHaveCount(0)
	await expect(page.locator('#pp-custom-end')).toHaveCount(0)

	// The default preview carries no proration suffix — a standard half is still half a month.
	const preview = page.locator('form[action="?/create"] p[aria-live="polite"]')
	await expect(preview).not.toContainText('prorated to')

	await custom.click()
	await expect(custom).toHaveAttribute('aria-pressed', 'true')
	await expect(firstHalf).toHaveAttribute('aria-pressed', 'false')
	await expect(page.getByLabel('Start date')).toBeVisible()
	await expect(page.getByLabel('End date')).toBeVisible()

	// Month/Year stay on screen in Custom mode — removing #pp-month would break two other specs.
	await expect(page.locator('#pp-month')).toBeVisible()
	await expect(preview).toHaveText('Pick a start and end date')

	// Inline validation uses the same copy the server returns.
	await page.getByLabel('Start date').fill('2026-06-20')
	await page.getByLabel('End date').fill('2026-06-05')
	await expect(page.locator('#pp-custom-error')).toHaveText(
		'End date must be on or after the start date.'
	)
	await page.getByLabel('End date').fill('2026-07-05')
	await expect(page.locator('#pp-custom-error')).toHaveText(
		'A custom period must start and end in the same month.'
	)

	// A valid range states the money consequence before commit: 7 of June's 30 days ≈ 23%.
	await page.getByLabel('Start date').fill('2026-06-03')
	await page.getByLabel('End date').fill('2026-06-09')
	await expect(page.locator('#pp-custom-error')).toHaveCount(0)
	await expect(preview).toHaveText(
		'Jun 3 – Jun 9, 2026 (7 days) · statutory and loans prorated to 23% of the month'
	)
})

/**
 * #163 follow-up — the browser's own calendar must refuse the impossible days rather than let a
 * user pick one and only then read an error. `min`/`max` express the two rules the inline message
 * and the server gate already enforce: the end is never before the start, and a custom period
 * never leaves the start's month.
 *
 * Read-only: never submits.
 */
test('the custom date inputs bound each other to one month', async ({ page }) => {
	await login(page, USERS.admin)
	await page.goto('/payroll', { waitUntil: 'domcontentloaded' })
	await page.getByRole('button', { name: 'New Payroll Run' }).click()
	await page.getByRole('button', { name: 'Custom range' }).click()

	const start = page.getByLabel('Start date')
	const end = page.getByLabel('End date')

	// With nothing picked yet, neither input constrains the other.
	await expect(start).not.toHaveAttribute('max', /./)
	await expect(end).not.toHaveAttribute('min', /./)

	// A start date pins the end to that day at the earliest and that month's last day at the latest.
	await start.fill('2026-06-03')
	await expect(end).toHaveAttribute('min', '2026-06-03')
	await expect(end).toHaveAttribute('max', '2026-06-30')

	// February's shorter month comes from daysInMonth, not a hard-coded 30.
	await start.fill('2026-02-10')
	await expect(end).toHaveAttribute('max', '2026-02-28')

	// The constraint runs both ways: an end date pins the start to the first of that month.
	await start.fill('')
	await end.fill('2026-06-09')
	await expect(start).toHaveAttribute('min', '2026-06-01')
	await expect(start).toHaveAttribute('max', '2026-06-09')
})
