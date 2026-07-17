import { defineConfig, devices } from '@playwright/test'

// E2E_PORT lets parallel checkouts/worktrees run their own suite without
// colliding on (or silently reusing) another checkout's dev server. --strictPort
// makes vite fail loudly instead of drifting to a port the baseURL doesn't match.
const port = Number(process.env.E2E_PORT ?? 5173)

export default defineConfig({
	testDir: 'tests/e2e',
	globalSetup: './tests/e2e/global-setup.ts',
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
