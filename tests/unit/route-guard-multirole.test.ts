import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Completeness invariant for the #256 guard sweep.
 *
 * The nav, the route guards and the service layer must all judge authority from the user's FULL
 * role set. #247 converted the services and the nav already read `roles`; the guards in between
 * still read the primary `locals.user.role`, so a user with a secondary role was shown a nav
 * entry, 403'd at the guard, and never reached the service that would have admitted them.
 *
 * Nothing else stops a future route from reintroducing that split — it compiles, and it is
 * unreachable until multi-role assignment ships, so no behavioural test would catch it either.
 * Hence a static scan.
 *
 * Scoped to the guard families converted so far, `requireCapability` included as of #256 PR 3.
 * The non-throwing `can(` display flags (#258 PR 4) are added to this pattern as that lands, so
 * the test is green at every step rather than red for three PRs. `requireRole` has no callers,
 * but it is still exported and still takes a singular `Role`, so it is covered pre-emptively —
 * an unscanned live export is exactly the door this test exists to shut.
 *
 * What this does NOT catch, all tracked in #272: named helpers such as
 * `canViewPayrollReports(x.role)`; hand-rolled `ROLE_HIERARCHY[x.role] >= …` comparisons; and a
 * role aliased into a local first (`const role = locals.user!.role`), since the scan is per line
 * and anchors on `.role` appearing in the call itself.
 *
 * `\.role\b` cannot match `.roles` — there is no word boundary before the `s` — so the check is
 * idempotent, and a comment mentioning `requireMinRole('HR_ADMIN')` is skipped for free.
 */
const SINGULAR_GUARD =
	/require(?:Role|Capability|MinRole|PayrollManage|PayrollReports)\([^,)]*\.role\b/

const ROUTES = join(import.meta.dirname, '../../src/routes')

describe('route guards judge the full role set (#256)', () => {
	it('has no guard reading the primary role alone', () => {
		const offenders: string[] = []

		for (const entry of readdirSync(ROUTES, { recursive: true, withFileTypes: true })) {
			if (!entry.isFile() || !/\.(ts|svelte)$/.test(entry.name)) continue
			const path = join(entry.parentPath, entry.name)
			readFileSync(path, 'utf8')
				.split('\n')
				.forEach((line, i) => {
					if (SINGULAR_GUARD.test(line)) offenders.push(`${path}:${i + 1}`)
				})
		}

		expect(
			offenders,
			`Pass the full role set (\`.roles\`) to these guards:\n${offenders.join('\n')}`
		).toEqual([])
	})
})
