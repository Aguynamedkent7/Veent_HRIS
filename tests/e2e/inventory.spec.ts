import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

// #114 — Inventory registry. The seed provides three demo items (MacBook, Office Chair,
// retired Projector). Rows carry data-name so they can be targeted after a client-side
// nav (Svelte updates the value property, not the SSR value attribute).
test.describe.configure({ mode: 'serial' })

const row = (page: import('@playwright/test').Page, name: string) =>
	page.locator(`tr[data-name="${name}"]`)

test.describe('Inventory (#114)', () => {
	test('lists items and filters by status', async ({ page }) => {
		await login(page, USERS.admin)
		await page.goto('/inventory', { waitUntil: 'domcontentloaded' })

		await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible()
		await expect(row(page, 'Office Chair')).toBeVisible()
		await expect(row(page, 'Projector (old)')).toBeVisible()

		// Filter to RETIRED → only the retired projector remains.
		await page.locator('#f-status').selectOption('RETIRED')
		await page.getByRole('button', { name: 'Filter' }).click()
		await expect(page).toHaveURL(/status=RETIRED/)
		await expect(row(page, 'Projector (old)')).toBeVisible()
		await expect(row(page, 'Office Chair')).toHaveCount(0)

		await page.getByRole('link', { name: 'Clear' }).click()
		await expect(row(page, 'Office Chair')).toBeVisible()
	})

	test('adds an item, enforces the assign invariant, then deletes it', async ({ page }) => {
		await login(page, USERS.admin)
		await page.goto('/inventory', { waitUntil: 'domcontentloaded' })

		// Add a new item via the collapsible form.
		await page.getByText('Add an item').click()
		await page.locator('#a-name').fill('E2E Monitor')
		await page.getByRole('button', { name: 'Add item' }).click()
		await expect(row(page, 'E2E Monitor')).toBeVisible()

		// Setting status ASSIGNED without an employee is rejected.
		await row(page, 'E2E Monitor').locator('select[name="status"]').selectOption('ASSIGNED')
		await row(page, 'E2E Monitor').getByRole('button', { name: 'Save' }).click()
		await expect(page.getByText(/Select an employee/)).toBeVisible()

		// Choosing an employee lets it save.
		await row(page, 'E2E Monitor').locator('select[name="assignedToId"]').selectOption({ index: 1 })
		await row(page, 'E2E Monitor').getByRole('button', { name: 'Save' }).click()
		await expect(page.getByText(/Select an employee/)).toHaveCount(0)

		// Delete it.
		await row(page, 'E2E Monitor').getByRole('button', { name: 'Delete' }).click()
		await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
		await expect(row(page, 'E2E Monitor')).toHaveCount(0)
	})
})
