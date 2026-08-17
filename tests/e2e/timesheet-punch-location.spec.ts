import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { login } from './helpers'

/**
 * #177 — the web punch surface, end to end.
 *
 * The unit specs prove what the route DECIDES. This proves the two things they cannot: that a
 * browser actually reaches the page, hands over a real geolocation reading, and that the
 * employee then sees their own coordinates back with an accuracy qualifier — and that revoking
 * the permission costs them nothing but the coordinates.
 *
 * Runs as a JoJo Potato crew member: /punch is food-service only, and the crew account is the
 * plainest possible EMPLOYEE — no HR capability is involved in punching for oneself.
 *
 * Serial: both cases punch as the same employee, and the action debounces to one punch per
 * employee per type per PHT minute.
 */
test.describe.configure({ mode: 'serial' })

const CREW = { email: 'benjie@jojo.ph', password: 'Employee@1234' }
const TENANT = 'JoJo Potato'

// Cagayan de Oro — where the seeded JoJo stores are.
const FIX = { latitude: 8.4772, longitude: 124.6459 }

async function openPunchPage(context: BrowserContext): Promise<Page> {
	const page = await context.newPage()
	await login(page, CREW, TENANT)
	await page.goto('/punch', { waitUntil: 'domcontentloaded' })
	await expect(page.getByRole('heading', { name: 'Punch', exact: true })).toBeVisible()
	// Wait for hydration. A pre-hydration click submits the form natively and punches WITHOUT a
	// location — correct behaviour (the punch is never lost), but not what these specs assert on.
	// Same class of race the login helper documents: a pre-hydration click is silently dropped.
	await expect(page.locator('form[data-ready="true"]')).toBeVisible()
	return page
}

test('a granted location is captured and shown back with an accuracy qualifier', async ({
	browser
}) => {
	const context = await browser.newContext({
		permissions: ['geolocation'],
		geolocation: FIX
	})
	const page = await openPunchPage(context)

	// A real <button>, reached by its accessible name — not a div with a click handler.
	await page.getByRole('button', { name: 'Punch In' }).click()

	// The live region reports the granted state, with the accuracy figure the SPEC requires.
	const status = page.getByRole('status')
	await expect(status).toContainText(/Location captured/)
	await expect(status).toContainText(/Punched in with your location\./)

	// The employee sees their OWN reading back — coordinates AND an accuracy qualifier, never
	// bare coordinates presented as if they were exact.
	const row = page.getByRole('listitem').filter({ hasText: 'Clock in' }).first()
	await expect(row).toContainText('8.47720, 124.64590')
	await expect(row).toContainText(/\((?:±\d+ m|accuracy unknown)\)/)

	await context.close()
})

test('a denied permission still records the punch, driven by keyboard alone', async ({
	browser
}) => {
	// No geolocation permission granted at all: getCurrentPosition takes the error path, which
	// is the branch that must never cost the employee their punch.
	//
	// Keyboard-only activation rides along here rather than in a test of its own: the action
	// debounces to one punch per employee per TYPE per PHT minute, there are exactly two types,
	// and the granted-location case above already owns IN. A third punch inside the same minute
	// would collide with one of them and assert the debounce instead of the thing under test.
	const context = await browser.newContext()
	const page = await openPunchPage(context)

	const punchOut = page.getByRole('button', { name: 'Punch Out' })
	await punchOut.focus()
	await expect(punchOut).toBeFocused()
	await page.keyboard.press('Enter')

	const status = page.getByRole('status')
	// The punch is the assertion that matters. The location copy varies by browser (denied vs
	// no fix), so assert that it is one of the punch-anyway states rather than pinning one.
	await expect(status).toContainText(/Punched out without a location\./)
	await expect(status).toContainText(/punching without it\./)

	const row = page.getByRole('listitem').filter({ hasText: 'Clock out' }).first()
	await expect(row).toContainText('No location recorded')

	await context.close()
})

test('/punch does not exist for a non-food-service tenant', async ({ browser }) => {
	// The negative control (criterion 20). Veent's admin never sees this page, and a direct
	// navigation is refused by the load guard rather than the missing nav link.
	const context = await browser.newContext()
	const page = await context.newPage()
	await login(page, { email: 'admin@veent.ph', password: 'Admin@1234' })

	await expect(page.getByRole('link', { name: 'Punch' })).toHaveCount(0)

	const res = await page.goto('/punch', { waitUntil: 'domcontentloaded' })
	expect(res?.status()).toBe(404)

	await context.close()
})
