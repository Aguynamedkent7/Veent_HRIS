import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { login, USERS } from './helpers'

// Quickstart Scenarios 1, 6, 8: HR admin onboarding, dashboard metrics,
// report generation, and audit-log access.
test.describe.configure({ mode: 'serial' })

// Emails of the accounts onboarded here, removed in afterAll. Without this the roster grew by
// one on every run, and the old count-based employee number eventually collided with a number
// already issued — the bug this spec now guards.
const created: string[] = []

test.afterAll(async () => {
	if (!created.length) return
	const db = new PrismaClient()
	const byEmail = { user: { email: { in: created } } }
	try {
		// Payroll compute in the other specs sweeps every ACTIVE employee in the org, so these
		// rows pick up payroll entries while the suite runs. That FK is RESTRICT, so the entries
		// have to go first — deleting the employee straight away fails outright.
		await db.payrollEntry.deleteMany({ where: { employee: byEmail } })
		// Employee has a required FK to User, so it goes before the user.
		await db.employee.deleteMany({ where: byEmail })
		await db.user.deleteMany({ where: { email: { in: created } } })
	} catch {
		// Best-effort. A payroll compute running concurrently can attach a new entry between the
		// deletes above; leaving a stray row behind is better than failing the suite in teardown,
		// and employee numbers no longer depend on the roster staying clean.
	} finally {
		await db.$disconnect()
	}
})

/** Fill and submit the onboarding form; returns the employee number it was assigned. */
async function onboard(page: import('@playwright/test').Page, stamp: number) {
	await page.goto('/employees/new', { waitUntil: 'domcontentloaded' })
	await page.waitForLoadState('networkidle') // let the form hydrate before submitting

	const email = `e2e_${stamp}@veent.ph`
	created.push(email)
	await page.getByLabel('First Name').fill('Testcase')
	await page.getByLabel('Last Name').fill(`User${stamp}`)
	await page.getByLabel('Email').fill(email)
	await page.getByLabel('Department').selectOption({ label: 'Human Resources' })
	await page.getByLabel('Job Title').fill('QA Engineer')
	await page.getByLabel('Start Date').fill('2026-03-02')
	await page.getByLabel('Basic Monthly Salary').fill('28000')
	await page.getByRole('button', { name: 'Create Employee' }).click()

	// On success the action redirects to the new employee's detail page (cuid id).
	await page.waitForURL(/\/employees\/c[a-z0-9]{10,}$/)
	await expect(page.getByRole('heading', { name: `User${stamp}, Testcase` })).toBeVisible()

	const db = new PrismaClient()
	try {
		const emp = await db.employee.findFirstOrThrow({
			where: { user: { email } },
			select: { employeeNumber: true }
		})
		return emp.employeeNumber
	} finally {
		await db.$disconnect()
	}
}

test.describe('HR Admin', () => {
	test('dashboard shows organisation metrics', async ({ page }) => {
		await login(page, USERS.admin)
		await expect(page.getByText('Active Employees')).toBeVisible()
		await expect(page.getByText('Pending Approvals')).toBeVisible()
	})

	test('onboards two employees, each getting the next free number', async ({ page }) => {
		test.slow() // two full onboarding round-trips, each with a bcrypt hash at cost 12
		await login(page, USERS.admin)

		const first = await onboard(page, Date.now())
		const second = await onboard(page, Date.now() + 1)

		// Veent's prefix, and the second lands one past the first. The number used to come from
		// a row count, which drifts from the numbers actually issued and eventually reissued one
		// that already existed — the unique index then rejected the insert outright.
		expect(first).toMatch(/^EMP-\d{3,}$/)
		expect(second).toMatch(/^EMP-\d{3,}$/)
		const suffix = (n: string) => Number(n.match(/(\d+)$/)![1])
		expect(suffix(second)).toBe(suffix(first) + 1)
	})

	test('generates a headcount report', async ({ page }) => {
		await login(page, USERS.admin)
		await page.goto('/reports/headcount?start=2025-01-01&end=2026-12-31', {
			waitUntil: 'domcontentloaded'
		})
		await expect(page.getByRole('heading', { name: /Headcount Report/i })).toBeVisible()
		// A results table or the empty-state message must render (no error page).
		await expect(page.getByRole('button', { name: 'Generate' })).toBeVisible()
	})

	test('audit log is accessible and lists entries', async ({ page }) => {
		await login(page, USERS.admin)
		await page.goto('/reports/audit-log', { waitUntil: 'domcontentloaded' })
		await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible()
		// Login events are always recorded, so at least one row exists.
		await expect(page.locator('tbody tr').first()).toBeVisible()
	})
})

// #191: statutory IDs and disbursement credentials are format-checked on entry and stored in
// one canonical shape, so the same ID cannot appear in three forms across records.
test.describe('Government ID validation', () => {
	test.describe.configure({ mode: 'serial' })

	test('a malformed SSS is rejected with the expected format', async ({ page }) => {
		await login(page, USERS.admin)
		await page.goto('/employees/new', { waitUntil: 'domcontentloaded' })
		await page.waitForLoadState('networkidle')

		const stamp = Date.now()
		await page.getByLabel('First Name').fill('Testcase')
		await page.getByLabel('Last Name').fill(`Bad${stamp}`)
		await page.getByLabel('Email').fill(`e2e_bad_${stamp}@veent.ph`)
		await page.getByLabel('Department').selectOption({ label: 'Human Resources' })
		await page.getByLabel('Job Title').fill('QA Engineer')
		await page.getByLabel('Start Date').fill('2026-03-02')
		await page.getByLabel('Basic Monthly Salary').fill('28000')
		await page.getByLabel('SSS Number').fill('1234') // 4 digits, not 10
		await page.getByRole('button', { name: 'Create Employee' }).click()

		await expect(page.getByText('SSS must be 10 digits (e.g. 34-1234567-8)')).toBeVisible()
		// The rejection must be total — no half-created account left behind.
		const db = new PrismaClient()
		try {
			expect(await db.user.count({ where: { email: `e2e_bad_${stamp}@veent.ph` } })).toBe(0)
		} finally {
			await db.$disconnect()
		}
	})

	test('separators are accepted and the stored value is canonical', async ({ page }) => {
		test.slow()
		await login(page, USERS.admin)
		await page.goto('/employees/new', { waitUntil: 'domcontentloaded' })
		await page.waitForLoadState('networkidle')

		const stamp = Date.now()
		const email = `e2e_ids_${stamp}@veent.ph`
		created.push(email)
		await page.getByLabel('First Name').fill('Testcase')
		await page.getByLabel('Last Name').fill(`Ids${stamp}`)
		await page.getByLabel('Email').fill(email)
		await page.getByLabel('Department').selectOption({ label: 'Human Resources' })
		await page.getByLabel('Job Title').fill('QA Engineer')
		await page.getByLabel('Start Date').fill('2026-03-02')
		await page.getByLabel('Basic Monthly Salary').fill('28000')
		// Typed three different ways; all three should land normalised.
		await page.getByLabel('SSS Number').fill('34 1234567 8')
		await page.getByLabel('PhilHealth Number').fill('123456789012')
		await page.getByLabel('TIN').fill('123-456-789')
		await page.getByRole('button', { name: 'Create Employee' }).click()
		await page.waitForURL(/\/employees\/c[a-z0-9]{10,}$/)

		const db = new PrismaClient()
		try {
			const emp = await db.employee.findFirstOrThrow({
				where: { user: { email } },
				select: { sssNumber: true, philhealthNumber: true, tinNumber: true, pagibigNumber: true }
			})
			expect(emp.sssNumber).toBe('34-1234567-8')
			expect(emp.philhealthNumber).toBe('12-345678901-2')
			expect(emp.tinNumber).toBe('123-456-789')
			// Left blank — stored as absent, not an empty string.
			expect(emp.pagibigNumber).toBeNull()
		} finally {
			await db.$disconnect()
		}
	})
})
