import { test, expect } from '@playwright/test'
import { login, USERS } from './helpers'

// #283 / AC-3: the role picker assigns a SET. The seeded two-hat account
// (verifier.approver@veent.ph = VERIFIER + APPROVER) is the only multi-role row in the
// seed, so it is the one row that can catch a picker that silently keeps a single role.
//
// Both branches of the row are asserted, because they are two renderings of the same
// fact and drifting them is the failure mode: the editable <select multiple> must have
// BOTH options `selected`, and the read-only span (shown to a caller without
// MANAGE_USER_ROLES) must list the same two roles comma-joined.

const TWO_HAT = USERS.twoHat.email

test('the picker prefills every held role, and the read-only span lists the same set', async ({
	browser
}) => {
	// Two logins in separate contexts (CEO for the editable branch, Super Admin for the
	// read-only one) — the same cost the payroll chain spec pays.
	test.slow()

	// --- Editable branch: the CEO holds MANAGE_USER_ROLES, so the row renders the role pills.
	const ceoCtx = await browser.newContext()
	const ceoPage = await ceoCtx.newPage()
	await login(ceoPage, USERS.ceo)
	await ceoPage.goto('/settings/roles', { waitUntil: 'domcontentloaded' })

	const twoHatEditable = ceoPage.locator('tr', { hasText: TWO_HAT })
	const picker = twoHatEditable.locator('fieldset')
	await expect(picker).toBeVisible()
	// Both, not one: a picker that collapsed the set would still render one checked box. Reading
	// the inputs rather than the pill styling — the checkbox IS what gets posted.
	await expect(picker.locator('input[name="roles"]:checked')).toHaveCount(2)
	await expect(picker.locator('input[name="roles"][value="VERIFIER"]')).toBeChecked()
	await expect(picker.locator('input[name="roles"][value="APPROVER"]')).toBeChecked()
	// The summary states the count, so a user reading the row does not have to count pills.
	await expect(picker.locator('p')).toHaveText('2 roles')

	// The CEO's own row is the read-only branch in this session (no self-role-change), so
	// the comma-joined form is rendered here too.
	const ownRow = ceoPage.locator('tr', { hasText: USERS.ceo.email })
	await expect(ownRow.locator('span').last()).toHaveText('CEO')
	await expect(ownRow.locator('fieldset')).toHaveCount(0)
	await ceoCtx.close()

	// --- Read-only branch for the SAME user: the Super Admin manages account status but not
	// roles, so every row renders as a span. This is where the two renderings must agree.
	const adminCtx = await browser.newContext()
	const adminPage = await adminCtx.newPage()
	await login(adminPage, USERS.admin)
	await adminPage.goto('/settings/roles', { waitUntil: 'domcontentloaded' })

	const twoHatRow = adminPage.locator('tr', { hasText: TWO_HAT })
	await expect(twoHatRow.locator('fieldset')).toHaveCount(0)
	// Same two roles, same labels as the editable branch — a row must not appear to hold
	// different roles depending on who is looking at it.
	await expect(twoHatRow.locator('span').nth(-2)).toHaveText('Verifier')
	await expect(twoHatRow.locator('span').last()).toHaveText('Approver')
	await adminCtx.close()
})
