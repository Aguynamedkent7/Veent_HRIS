import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

// #106: both pages returned fail(..., { error }) from their actions, but neither
// rendered it — benefits never destructured `form` at all, and performance nested the
// banner inside the collapsible create-goal form. Every validation failure was silent:
// the user saw the form do nothing.
//
// Each test clears a required field (removing the attribute so the browser lets the
// submit through) and asserts the server's complaint reaches the screen.

test('benefits surfaces a failed plan creation instead of silently doing nothing', async ({
	page
}) => {
	await login(page, USERS.admin)
	await page.goto('/benefits', { waitUntil: 'domcontentloaded' })

	const form = page.locator('form[action*="createPlan"]')
	await expect(async () => {
		await page.getByRole('button', { name: 'Add Plan' }).click()
		await expect(form).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15000 })

	await form.locator('input[name="name"]').evaluate((el: HTMLInputElement) => {
		el.removeAttribute('required')
		el.value = ''
	})
	await form.getByRole('button', { name: 'Create', exact: true }).click()

	// The banner must appear at all — before the fix nothing rendered.
	await expect(page.getByRole('alert')).toBeVisible()
	// ...and it must be readable: createPlan returned the raw zod fieldErrors object,
	// which renders as "[object Object]".
	await expect(page.getByRole('alert')).not.toContainText('[object Object]')
})

test('performance surfaces cycle errors without the goal form being open', async ({ page }) => {
	await login(page, USERS.admin)
	await page.goto('/performance', { waitUntil: 'domcontentloaded' })

	// Deliberately do NOT open Create Goal — that is the point. The banner used to live
	// inside it, so a cycle error was invisible unless that form happened to be open.
	const form = page.locator('form[action*="createCycle"]')
	await expect(form).toBeVisible()

	// Retried as a whole: the date inputs use `bind:value`, so filling them before
	// hydration lands gets undone when Svelte syncs state back, leaving them empty and
	// `required` — the browser then blocks submission and the server is never reached.
	// The dates must be valid; only `name` is left blank, which is what the action rejects.
	await expect(async () => {
		await form.locator('input[name="startDate"]').fill('2026-09-01')
		await form.locator('input[name="endDate"]').fill('2026-09-30')
		await form.locator('input[name="name"]').evaluate((el: HTMLInputElement) => {
			el.removeAttribute('required')
			el.value = ''
		})
		await form.getByRole('button', { name: 'Create cycle' }).click()
		await expect(page.getByRole('alert')).toBeVisible({ timeout: 2000 })
	}).toPass({ timeout: 20000 })
})
