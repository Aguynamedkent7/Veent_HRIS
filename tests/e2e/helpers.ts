import { expect, type Page } from '@playwright/test'

export const USERS = {
	admin: { email: 'admin@veent.ph', password: 'Admin@1234' },
	manager: { email: 'manager@veent.ph', password: 'Manager@1234' },
	employee: { email: 'employee@veent.ph', password: 'Employee@1234' }
}

// Deterministic Discord link for the punch → aggregate → approve E2E. `global-setup`
// pins this onto employee@veent.ph so the signed-punch test doesn't depend on the
// seed's Discord id and stays isolated from real Discord accounts.
export const E2E_DISCORD_ID = 'e2e-punch-elena'

/** Log in through the real login form and wait for the dashboard. */
export async function login(page: Page, user: { email: string; password: string }) {
	// domcontentloaded (not the default 'load') so we don't block on external font/webfont
	// requests that may never settle in sandboxed/offline runners.
	await page.goto('/login', { waitUntil: 'domcontentloaded' })
	await page.getByLabel('Email').fill(user.email)
	await page.getByLabel('Password').fill(user.password)
	await page.getByRole('button', { name: 'Sign In' }).click()
	// domcontentloaded here too — waitForURL's default 'load' hangs the same way.
	await page.waitForURL('**/dashboard', { waitUntil: 'domcontentloaded' })
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

/** A near-future weekday (YYYY-MM-DD) so leave requests count ≥ 1 working day. */
export function nextWeekdayISO(): string {
	const d = new Date()
	d.setDate(d.getDate() + 3)
	const day = d.getDay()
	if (day === 6)
		d.setDate(d.getDate() + 2) // Sat → Mon
	else if (day === 0) d.setDate(d.getDate() + 1) // Sun → Mon
	return d.toISOString().slice(0, 10)
}
