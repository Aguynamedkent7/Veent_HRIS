import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

// Quickstart: RBAC / auth — "employee cannot access another employee's data",
// login works, protected routes require a session.
test.describe('Authentication & access control', () => {
	test('unauthenticated user is redirected to the login page', async ({ page }) => {
		await page.goto('/dashboard')
		await expect(page).toHaveURL(/\/login/)
	})

	test('invalid credentials are rejected', async ({ page }) => {
		await page.goto('/login')
		await page.getByLabel('Email').fill(USERS.admin.email)
		await page.getByLabel('Password').fill('definitely-wrong')
		await page.getByRole('button', { name: 'Sign In' }).click()
		await expect(page.getByText('Invalid email or password')).toBeVisible()
		await expect(page).toHaveURL(/\/login/)
	})

	test('valid credentials sign in and reach the dashboard', async ({ page }) => {
		await login(page, USERS.admin)
	})

	test('an employee cannot open the admin-only employees list', async ({ page }) => {
		await login(page, USERS.employee)
		await page.goto('/employees')
		// requireMinRole(MANAGER) throws 403 for a plain employee → Access Denied page.
		await expect(page.getByRole('heading', { name: 'Access Denied' })).toBeVisible()
	})
})
