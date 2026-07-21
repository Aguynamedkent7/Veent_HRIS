import { chromium } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { E2E_DISCORD_ID } from './helpers'

/**
 * Resets the seeded employee's transactional data before the E2E run so tests
 * that create a current-week timesheet / leave request are deterministic across
 * repeated runs. Relies on the seed having been applied (`pnpm db:seed`).
 */
/**
 * Compile the hot routes once, before any test's clock is running.
 *
 * The dev server compiles each route on its first request. That cost lands on whichever
 * test happens to reach the route first, and under a cold cache or a loaded runner it
 * blew the 30s per-test budget — `page.goto('/login')` timing out in a different spec on
 * every run. Paying it here makes the failure mode a slow setup instead of a random
 * red test. Best-effort: a warmup miss must never fail the suite.
 */
async function warmRoutes() {
	const port = Number(process.env.E2E_PORT ?? 5173)
	const base = `http://localhost:${port}`
	// /login first — every test goes through it. The rest redirect to /login when
	// unauthenticated, which still forces their server modules to compile.
	const routes = ['/login', '/dashboard', '/timesheets', '/employees', '/performance', '/benefits']

	for (const route of routes) {
		try {
			await fetch(`${base}${route}`, { signal: AbortSignal.timeout(60_000), redirect: 'manual' })
		} catch {
			// Server not up yet, or this route is slow — tests will surface it properly.
		}
	}

	// The fetch loop compiles server modules, but the two-step Avipa login (#135) reveals
	// its credential form client-side, so the first *browser* hit to /login pays the client
	// bundle + hydration cost. Prime it here in a real browser so the first test doesn't
	// flake waiting for the tenant button to become interactive. Best-effort.
	try {
		const browser = await chromium.launch()
		const page = await browser.newPage()
		await page.goto(`${base}/login`, { waitUntil: 'load', timeout: 60_000 })
		// Clicking the tenant button forces hydration; if it reveals the Email field the
		// bundle is warm. Swallow failures — this is a warmup, not an assertion.
		await page
			.getByRole('button', { name: 'Veent', exact: true })
			.click({ timeout: 30_000 })
			.catch(() => {})
		await page
			.getByLabel('Email')
			.waitFor({ state: 'visible', timeout: 10_000 })
			.catch(() => {})
		await browser.close()
	} catch {
		// Chromium not available or server slow — tests will surface any real problem.
	}
}

async function globalSetup() {
	await warmRoutes()
	const db = new PrismaClient()
	try {
		const employee = await db.employee.findFirst({
			where: { user: { email: 'employee@veent.ph' } },
			select: { id: true }
		})

		if (!employee) {
			throw new Error(
				'E2E seed missing: employee@veent.ph not found. Run `pnpm db:seed` before the E2E suite.'
			)
		}

		// Raw punches accumulate across runs and would otherwise mis-pair on re-aggregation,
		// so clear them and pin a known discordId for the signed-punch → aggregate E2E.
		await db.timeLog.deleteMany({ where: { employeeId: employee.id } })
		await db.employee.update({ where: { id: employee.id }, data: { discordId: E2E_DISCORD_ID } })

		await db.timesheetEntry.deleteMany({ where: { timesheet: { employeeId: employee.id } } })
		await db.timesheet.deleteMany({ where: { employeeId: employee.id } })
		await db.leaveRequest.deleteMany({ where: { employeeId: employee.id } })
		// Leave now flows through the unified Request model; reset it too (steps/documents
		// cascade) so leave-filing tests stay deterministic across repeated runs.
		await db.request.deleteMany({ where: { employeeId: employee.id } })

		// Restore full leave balances (approved requests in prior runs decrement them).
		const balances = await db.leaveBalance.findMany({ where: { employeeId: employee.id } })
		for (const b of balances) {
			await db.leaveBalance.update({
				where: { id: b.id },
				data: { used: 0, remaining: b.allocated }
			})
		}
	} finally {
		await db.$disconnect()
	}
}

export default globalSetup
