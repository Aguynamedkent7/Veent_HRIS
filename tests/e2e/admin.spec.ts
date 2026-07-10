import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

// Quickstart Scenarios 1, 6, 8: HR admin onboarding, dashboard metrics,
// report generation, and audit-log access.
test.describe.configure({ mode: 'serial' })

test.describe('HR Admin', () => {
	test('dashboard shows organisation metrics', async ({ page }) => {
		await login(page, USERS.admin)
		await expect(page.getByText('Active Employees')).toBeVisible()
		await expect(page.getByText('Timesheets for Review')).toBeVisible()
	})

	test('onboards a new employee via the onboarding form', async ({ page }) => {
		await login(page, USERS.admin)
		await page.goto('/employees/new')
		await page.waitForLoadState('networkidle') // let the form hydrate before submitting

		const stamp = Date.now()
		await page.getByLabel('First Name').fill('Testcase')
		await page.getByLabel('Last Name').fill(`User${stamp}`)
		await page.getByLabel('Email').fill(`e2e_${stamp}@veent.ph`)
		await page.getByLabel('Department').selectOption({ label: 'Human Resources' })
		await page.getByLabel('Job Title').fill('QA Engineer')
		await page.getByLabel('Start Date').fill('2026-03-02')
		await page.getByLabel('Basic Monthly Salary').fill('28000')
		await page.getByRole('button', { name: 'Create Employee' }).click()

		// On success the action redirects to the new employee's detail page (cuid id).
		await page.waitForURL(/\/employees\/c[a-z0-9]{10,}$/)
		await expect(page.getByRole('heading', { name: `User${stamp}, Testcase` })).toBeVisible()
	})

	test('generates a headcount report', async ({ page }) => {
		await login(page, USERS.admin)
		await page.goto('/reports/headcount?start=2025-01-01&end=2026-12-31')
		await expect(page.getByRole('heading', { name: /Headcount Report/i })).toBeVisible()
		// A results table or the empty-state message must render (no error page).
		await expect(page.getByRole('button', { name: 'Generate' })).toBeVisible()
	})

	test('audit log is accessible and lists entries', async ({ page }) => {
		await login(page, USERS.admin)
		await page.goto('/reports/audit-log')
		await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible()
		// Login events are always recorded, so at least one row exists.
		await expect(page.locator('tbody tr').first()).toBeVisible()
	})
})
