import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { login, USERS } from './helpers'

// #54: disbursement numbers are masked server-side; the reveal is privileged and
// audited. Serial — all three tests share the seeded employee's temporary bank
// details, which beforeAll installs and afterAll removes (distinctive digits so
// stray state is recognisable).
test.describe.configure({ mode: 'serial' })

const FULL_BANK_NO = '00123456784321' // masked display: •••• 4321
const FULL_GCASH_NO = '09170000009999' // masked display: •••• 9999

let employeeId: string

test.beforeAll(async () => {
	const db = new PrismaClient()
	try {
		const employee = await db.employee.findFirstOrThrow({
			where: { user: { email: 'employee@veent.ph' } },
			select: { id: true }
		})
		employeeId = employee.id
		await db.employee.update({
			where: { id: employeeId },
			data: { bankAccountNumber: FULL_BANK_NO, gcashNumber: FULL_GCASH_NO }
		})
	} finally {
		await db.$disconnect()
	}
})

test.afterAll(async () => {
	// Clean up the driver-created PII (seed leaves these null).
	const db = new PrismaClient()
	try {
		await db.employee.update({
			where: { id: employeeId },
			data: { bankAccountNumber: null, gcashNumber: null }
		})
	} finally {
		await db.$disconnect()
	}
})

test('manager (promoted to HR, #133) sees masked disbursement and the reveal button', async ({
	page
}) => {
	await login(page, USERS.manager)
	await page.goto(`/employees/${employeeId}`, { waitUntil: 'domcontentloaded' })
	await expect(page.getByRole('heading', { name: 'Employee, Elena' })).toBeVisible()

	// #133 promoted Manager to on-branch HR (MANAGE_HR), so the disbursement card is now
	// visible to managers. Masking still happens server-side: masked values show and the
	// full numbers are absent from the DOM until the audited reveal.
	await expect(page.getByText('•••• 4321')).toBeVisible()
	await expect(page.getByText('•••• 9999')).toBeVisible()
	const html = await page.content()
	expect(html).not.toContain(FULL_BANK_NO)
	expect(html).not.toContain(FULL_GCASH_NO)
	await expect(page.getByRole('button', { name: 'Reveal full numbers' })).toBeVisible()
})

test('admin sees masked numbers, reveals full values, and the reveal is audited', async ({
	page
}) => {
	await login(page, USERS.admin)
	await page.goto(`/employees/${employeeId}`, { waitUntil: 'domcontentloaded' })

	// Masked on load — and the full numbers are absent from the DOM entirely
	// (masking happens server-side, not display-side).
	await expect(page.getByText('•••• 4321')).toBeVisible()
	await expect(page.getByText('•••• 9999')).toBeVisible()
	const html = await page.content()
	expect(html).not.toContain(FULL_BANK_NO)
	expect(html).not.toContain(FULL_GCASH_NO)

	// Reveal. The button is a plain form action submit, so it works with or
	// without hydration having finished.
	await page.getByRole('button', { name: 'Reveal full numbers' }).click()
	await expect(page.getByText(FULL_BANK_NO)).toBeVisible()
	await expect(page.getByText(FULL_GCASH_NO)).toBeVisible()

	// The reveal wrote a VIEW audit entry on the Employee entity.
	await page.goto('/reports/audit-log', { waitUntil: 'domcontentloaded' })
	const viewRow = page.locator('tbody tr', { hasText: 'VIEW' }).first()
	await expect(viewRow).toBeVisible()
	await expect(viewRow.getByText('Employee', { exact: true })).toBeVisible()
})

// #95: the per-record masking above is only half the boundary — the roster list
// is reachable at MANAGER, and a bare Prisma `include` there returned every
// scalar for the whole org. Assert on the field names, not just the values: a
// regression would leak all employees' data, not only this driver-seeded row.
test('manager listing employees via the API receives no compensation, gov IDs, or bank details', async ({
	page
}) => {
	await login(page, USERS.manager)
	const response = await page.request.get('/api/v1/employees')
	expect(response.status()).toBe(200)

	const body = await response.json()
	expect(Array.isArray(body.data)).toBe(true)
	expect(body.data.length).toBeGreaterThan(0)

	for (const employee of body.data) {
		for (const field of [
			'basicMonthlySalary',
			'rateType',
			'sssNumber',
			'philhealthNumber',
			'pagibigNumber',
			'tinNumber',
			'bankName',
			'bankAccountName',
			'bankAccountNumber',
			'gcashNumber'
		]) {
			// Absent, not null — the fix drops them from the query rather than blanking
			// them after the fact, so `in` is the assertion that actually pins it.
			expect(field in employee, `${field} must not be selected`).toBe(false)
		}
	}

	// The display fields the roster genuinely needs are still there.
	expect(body.data[0]).toHaveProperty('employeeNumber')
	expect(body.data[0]).toHaveProperty('department')

	// Belt and braces: the seeded disbursement numbers appear nowhere in the payload.
	const raw = JSON.stringify(body)
	expect(raw).not.toContain(FULL_BANK_NO)
	expect(raw).not.toContain(FULL_GCASH_NO)
})

test('forged reveal POST by a non-HR employee is rejected with 403', async ({ page }) => {
	// Manager is HR-level now (#133), so the reveal boundary is asserted against a plain
	// employee — a role that still holds no MANAGE_HR and must never obtain full numbers.
	await login(page, USERS.employee)
	// Same-origin header so this exercises the action's RBAC check rather than
	// SvelteKit's CSRF rejection (both are 403, but we want the role gate).
	const response = await page.request.post(`/employees/${employeeId}?/revealDisbursement`, {
		form: { attempt: '1' },
		headers: { origin: new URL(page.url()).origin }
	})
	expect(response.status()).toBe(403)
	const body = await response.text()
	expect(body).not.toContain('Cross-site')
	expect(body).not.toContain(FULL_BANK_NO)
	expect(body).not.toContain(FULL_GCASH_NO)
})
