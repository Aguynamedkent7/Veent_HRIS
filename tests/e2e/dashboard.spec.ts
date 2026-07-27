import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

// #53: each dashboard metric card is a one-click drill-down to its module page.
// "On Leave Today" was removed from the metric row when Upcoming Events took the right column;
// the figure is still reachable from /leave itself.
test.describe('Dashboard metric cards navigate', () => {
	const cards = [
		{ label: 'Active Employees', target: '/employees' },
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

// #141: announcements carried no attribution — the tile rendered title, date and body only,
// even though Announcement.authorId was already recorded. The byline is a two-hop join
// (Announcement → User → Employee) resolved server-side.
test.describe('Announcement author', () => {
	test.describe.configure({ mode: 'serial' })

	const TITLE = `e2e byline ${Date.now()}`

	test.afterAll(async () => {
		const { PrismaClient } = await import('@prisma/client')
		const db = new PrismaClient()
		try {
			await db.announcement.deleteMany({ where: { title: TITLE } })
		} finally {
			await db.$disconnect()
		}
	})

	test('a posted announcement is attributed to the poster', async ({ page }) => {
		// hr@veent.ph is Hannah HR — an account that does have an employee record, so the
		// byline resolves to a real name rather than the email fallback.
		await login(page, { email: 'hr@veent.ph', password: 'Hr@1234' })

		// The composer is revealed client-side; retry until hydration lands.
		await expect(async () => {
			await page.getByRole('button', { name: 'Post', exact: true }).click()
			await expect(page.locator('input[name="title"]')).toBeVisible({ timeout: 1000 })
		}).toPass({ timeout: 15000 })

		await page.locator('input[name="title"]').fill(TITLE)
		await page.locator('textarea[name="body"]').fill('Byline check.')
		await page.getByRole('button', { name: 'Post announcement' }).click()

		// Scoped by the body as well as the title: staging's notification feed renders the same
		// announcement title in its own <li>, so filtering on the title alone matches two.
		const item = page.locator('li', { hasText: TITLE }).filter({ hasText: 'Byline check.' })
		await expect(item).toBeVisible()
		await expect(item).toContainText('— Hannah HR')
	})

	test('the byline survives a reload — it is read back, not just echoed', async ({ page }) => {
		await login(page, USERS.employee) // any role can read the dashboard
		const item = page.locator('li', { hasText: TITLE }).filter({ hasText: 'Byline check.' })
		await expect(item).toContainText('— Hannah HR')
	})
})
