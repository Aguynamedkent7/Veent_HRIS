import { defineConfig, devices } from '@playwright/test'

// E2E_PORT lets parallel checkouts/worktrees run their own suite without
// colliding on (or silently reusing) another checkout's dev server. --strictPort
// makes vite fail loudly instead of drifting to a port the baseURL doesn't match.
const port = Number(process.env.E2E_PORT ?? 5173)

export default defineConfig({
	testDir: 'tests/e2e',
	globalSetup: './tests/e2e/global-setup.ts',
	// Playwright's 30s default is not enough here: these specs log in through the real
	// two-step form, and a cold login costs ~60s on a loaded machine or a CI runner. That
	// is the whole budget gone before the assertion under test runs, which is why
	// payslip-tenancy already flaked locally. Suite-wide rather than per-spec — the cost is
	// the login, and every spec pays it.
	timeout: 120_000,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'html',
	use: {
		baseURL: `http://localhost:${port}`,
		trace: 'on-first-retry'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	],
	webServer: {
		command: `pnpm dev --port ${port} --strictPort`,
		url: `http://localhost:${port}`,
		reuseExistingServer: !process.env.CI
	}
})
