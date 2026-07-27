import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { login, USERS } from './helpers'

/**
 * #165 /timesheets and #166 /attendance must be view-only for the Employee role, and must
 * show that employee's own records only.
 *
 * Both halves are asserted twice: the controls are absent from the page, and a forged
 * same-origin POST straight at the action still returns 403 — a hidden button is a UX
 * decision, the role gate is the boundary.
 *
 * The timesheet fixture is a DRAFT in a long-past period (2020 first half) so it can't
 * collide with the current-week rows the punch/approval specs build, and it never reaches
 * the SUBMITTED review queue those specs read.
 */

const PERIOD_START = new Date('2020-01-01T00:00:00.000Z')
const PERIOD_END = new Date('2020-01-15T00:00:00.000Z')

let employeeId: string
let timesheetId: string

test.beforeAll(async () => {
	const db = new PrismaClient()
	try {
		const employee = await db.employee.findFirstOrThrow({
			where: { user: { email: USERS.employee.email } },
			select: { id: true }
		})
		employeeId = employee.id
		const ts = await db.timesheet.create({
			data: {
				employeeId,
				periodStart: PERIOD_START,
				periodEnd: PERIOD_END,
				status: 'DRAFT',
				totalHours: 8,
				entries: {
					create: [
						{
							date: PERIOD_START,
							hoursWorked: 8,
							otHours: 0,
							notes: 'e2e view-only fixture'
						}
					]
				}
			},
			select: { id: true }
		})
		timesheetId = ts.id
	} finally {
		await db.$disconnect()
	}
})

test.afterAll(async () => {
	const db = new PrismaClient()
	try {
		await db.timesheet.delete({ where: { id: timesheetId } })
	} finally {
		await db.$disconnect()
	}
})

// ─── #165 /timesheets ────────────────────────────────────────────────────────

test('employee sees their own timesheets but no create or bulk controls', async ({ page }) => {
	await login(page, USERS.employee)
	await page.goto('/timesheets', { waitUntil: 'domcontentloaded' })

	await expect(page.getByRole('heading', { name: 'My Timesheets' })).toBeVisible()
	// Their own row is readable…
	await expect(page.getByRole('cell', { name: /Jan 1, 2020/ })).toBeVisible()
	// …while every mutation affordance is gone.
	await expect(page.getByRole('button', { name: 'New Timesheet' })).toHaveCount(0)
	await expect(page.getByLabel('Select all')).toHaveCount(0)
	await expect(page.getByLabel('Select timesheet')).toHaveCount(0)
	// Team Timesheets is manager-only — an employee must not see anyone else's.
	await expect(page.getByRole('heading', { name: 'Team Timesheets' })).toHaveCount(0)
})

test('employee timesheet modal is read-only', async ({ page }) => {
	await login(page, USERS.employee)
	await page.goto('/timesheets', { waitUntil: 'domcontentloaded' })

	const row = page.getByRole('row', { name: /Jan 1, 2020/ })
	const dialog = page.getByRole('dialog', { name: 'Timesheet review' })
	// Retry the click until the dialog opens — a pre-hydration click is silently dropped.
	await expect(async () => {
		await row.click()
		await expect(dialog).toBeVisible({ timeout: 1000 })
	}).toPass({ timeout: 15000 })

	await expect(dialog.getByText('e2e view-only fixture')).toBeVisible()
	for (const name of ['Save entries', 'Submit for review', 'Sync from attendance', 'Delete']) {
		await expect(dialog.getByRole('button', { name })).toHaveCount(0)
	}
	await expect(dialog.getByRole('button', { name: '+ Add row' })).toHaveCount(0)
})

test('forged timesheet mutations by an employee are rejected with 403', async ({ page }) => {
	await login(page, USERS.employee)
	const origin = new URL(page.url()).origin

	// Same-origin header so this exercises the role gate, not SvelteKit's CSRF rejection.
	const posts = {
		'?/create': { periodStart: '2020-02-01', periodEnd: '2020-02-15' },
		'?/submit': { id: timesheetId },
		'?/delete': { id: timesheetId },
		'?/syncAttendance': { id: timesheetId },
		'?/submitMany': { ids: timesheetId },
		'?/deleteMany': { ids: timesheetId }
	}
	for (const [action, form] of Object.entries(posts)) {
		const res = await page.request.post(`/timesheets${action}`, {
			form,
			headers: { origin }
		})
		expect(res.status(), `POST /timesheets${action}`).toBe(403)
	}

	// The fixture must have survived every one of them.
	const db = new PrismaClient()
	try {
		const ts = await db.timesheet.findUnique({ where: { id: timesheetId } })
		expect(ts?.status).toBe('DRAFT')
	} finally {
		await db.$disconnect()
	}
})

// ─── #166 /attendance ────────────────────────────────────────────────────────

test('employee sees only their own attendance, with no correction controls', async ({ page }) => {
	await login(page, USERS.employee)
	await page.goto('/attendance', { waitUntil: 'domcontentloaded' })

	await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible()
	// Reading their own range stays available, export included.
	await expect(page.getByRole('link', { name: /Export CSV/ })).toBeVisible()

	// No way to reach another employee's records: no picker, no team view, no matrix link.
	await expect(page.getByLabel('Employee')).toHaveCount(0)
	await expect(page.getByRole('link', { name: 'Whole team (day)' })).toHaveCount(0)
	await expect(page.getByRole('link', { name: 'By employee' })).toHaveCount(0)
	await expect(page.getByRole('link', { name: /Multi-day matrix/ })).toHaveCount(0)

	// No HR write affordances anywhere on the page.
	for (const name of ['Refresh', 'Lock range', 'Unlock range', 'Save as timesheet', 'Save']) {
		await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
	}
})

test('an employee forcing the team view still only gets their own scope', async ({ page }) => {
	await login(page, USERS.employee)
	// view=team is manager-only; the load must fall back to the employee view rather than
	// listing the org's day.
	await page.goto('/attendance?view=team', { waitUntil: 'domcontentloaded' })
	await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible()
	await expect(page.getByRole('columnheader', { name: 'Employee' })).toHaveCount(0)
	await expect(page.getByRole('columnheader', { name: 'Department' })).toHaveCount(0)
})

test('forged attendance mutations by an employee are rejected with 403', async ({ page }) => {
	await login(page, USERS.employee)
	const origin = new URL(page.url()).origin
	const today = new Date().toISOString().slice(0, 10)

	const posts: Record<string, Record<string, string>> = {
		'?/derive': { employeeId, from: today, to: today },
		'?/correct': { id: 'any', date: today, status: 'PRESENT' },
		'?/resetDay': { id: 'any' },
		'?/lock': { employeeId, from: today, to: today },
		'?/unlock': { employeeId, from: today, to: today },
		'?/saveTimesheet': { employeeId, from: today, to: today },
		'?/deriveTeam': { date: today },
		'?/lockTeam': { date: today },
		'?/unlockTeam': { date: today }
	}
	for (const [action, form] of Object.entries(posts)) {
		const res = await page.request.post(`/attendance${action}`, { form, headers: { origin } })
		expect(res.status(), `POST /attendance${action}`).toBe(403)
	}
})
