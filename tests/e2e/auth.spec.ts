import { test, expect } from '@playwright/test'
import { login, selectTenant, USERS } from './helpers'

// Quickstart: RBAC / auth — "employee cannot access another employee's data",
// login works, protected routes require a session.
// goto uses domcontentloaded (like helpers.login) — the default 'load' can hang on
// external font/webfont requests in sandboxed/offline runners.
test.describe('Authentication & access control', () => {
	test('unauthenticated user is redirected to the login page', async ({ page }) => {
		await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
		await expect(page).toHaveURL(/\/login/)
	})

	test('invalid credentials are rejected', async ({ page }) => {
		await page.goto('/login', { waitUntil: 'domcontentloaded' })
		// #135: pick the tenant first, then submit a bad password.
		await selectTenant(page, 'Veent')
		await page.getByLabel('Email').fill(USERS.admin.email)
		await page.getByLabel('Password').fill('definitely-wrong')
		await page.getByRole('button', { name: 'Sign In' }).click()
		await expect(page.getByText('Invalid email or password')).toBeVisible()
		await expect(page).toHaveURL(/\/login/)
	})

	// #135: a correct credential paired with the wrong tenant must fail identically to
	// a bad password — login never reveals which org an account belongs to.
	test('valid credentials against the wrong tenant are rejected', async ({ page }) => {
		await page.goto('/login', { waitUntil: 'domcontentloaded' })
		await selectTenant(page, 'JoJo Potato')
		await page.getByLabel('Email').fill(USERS.admin.email)
		await page.getByLabel('Password').fill(USERS.admin.password)
		await page.getByRole('button', { name: 'Sign In' }).click()
		await expect(page.getByText('Invalid email or password')).toBeVisible()
		await expect(page).toHaveURL(/\/login/)
	})

	test('valid credentials sign in and reach the dashboard', async ({ page }) => {
		await login(page, USERS.admin)
	})

	test('an employee cannot open the admin-only employees list', async ({ page }) => {
		await login(page, USERS.employee)
		await page.goto('/employees', { waitUntil: 'domcontentloaded' })
		// requireMinRole(MANAGER) throws 403 for a plain employee → Access Denied page.
		await expect(page.getByRole('heading', { name: 'Access Denied' })).toBeVisible()
	})
})
