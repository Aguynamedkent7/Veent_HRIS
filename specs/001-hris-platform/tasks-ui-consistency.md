# Tasks (Addendum): UI Consistency Batch

**Input**: [plan-ui-consistency.md](./plan-ui-consistency.md) · issues [#67](https://github.com/Aguynamedkent7/Veent_HRIS/issues/67), [#68](https://github.com/Aguynamedkent7/Veent_HRIS/issues/68), [#69](https://github.com/Aguynamedkent7/Veent_HRIS/issues/69)
**Parent**: addendum to `tasks.md` — scoped so the main file is not regenerated. IDs use the `UIC-###` prefix.

**Story map** (priority = delivery order; each story independently shippable):

| Story | Issue                                                | PR / branch (off `staging`)    |
| ----- | ---------------------------------------------------- | ------------------------------ |
| US1   | #67 back navigation (component, rollout, origin fix) | PR 1 — `fix/back-navigation`   |
| US2   | #68 action links → bordered buttons                  | PR 2 — `feat/action-buttons`   |
| US3   | #69 logo transparency                                | PR 3 — `fix/logo-transparency` |

**Conventions**: tests written before implementation where a testable unit exists (Constitution
§V); authorization stays server-side (no authz changes in this batch); `[P]` = parallel-safe
(different files, no incomplete deps). Svelte 5 runes; `{@const}` only as immediate child of a
block tag; e2e follows `.claude/skills/verify/SKILL.md` (hydration retry, seeded logins).
Button conventions from `requests/+page.svelte:397,407`:
primary `rounded-md border border-primary/40 px-3 py-1 text-xs font-medium text-primary
hover:bg-primary/10`; red `border-red-200 text-red-600 hover:bg-red-50`; green/yellow analogues.

No Setup/Foundational phases: nothing is shared across stories — US1's helper/component tasks
live inside US1 and block only its rollout tasks. **US1 merges before US2 starts** (shared
files: `requests/[id]`, `payroll/[id]`, `employees/[id]`, settings subpages); US3 is
independent of both.

---

## Phase 1 — US1: Shared origin-aware BackButton (#67)

**Goal**: every detail/subpage has a bordered icon+label back button that returns to the page
actually navigated from.
**Independent test**: open an employee from `/team` as HR → back button returns to `/team`;
hard-load the same URL → back goes to the fallback; every report tab reaches `/reports`.

### Mechanism (blocks the rollout tasks)

- [x] UIC-001 [US1] **Test-first** unit `tests/unit/back-target.test.ts` for `src/lib/utils/back.ts`: `resolveBackTarget(cameFrom, fromParam, fallback)` — captured origin wins; `?from` used when no origin and only if it starts with a single `/` (reject `//host`, `http://…`, empty, missing); fallback otherwise. `backLabel(target, fallback, label)` — returns `label` when target pathname === fallback pathname, else `'Back'`. MUST fail (module absent).
- [x] UIC-002 [US1] Implement `resolveBackTarget` + `backLabel` in `src/lib/utils/back.ts` → UIC-001 green.
- [x] UIC-003 [US1] Create `src/lib/components/ui/BackButton.svelte`: props `fallback: string` (required), `label: string`; `afterNavigate` captures origin pathname+search (ignore same-pathname navigations); renders `<a href={resolved}>` styled as bordered ghost button — inline-Heroicons `arrow-left` (outline, `size-4`) + resolved label, `text-muted-foreground hover:text-foreground` with `rounded-md border` treatment, `aria-label="Back to {label}"`.

### Rollout (all [P] after UIC-003 — different files)

- [x] UIC-004 [P] [US1] Payroll pages: replace text back links with `<BackButton fallback="/payroll" label="Payroll" />` in `src/routes/(app)/payroll/[id]/+page.svelte:18`, `src/routes/(app)/payroll/calculator/+page.svelte:40`, `src/routes/(app)/payroll/periods/+page.svelte:26`.
- [x] UIC-005 [P] [US1] Settings subpages with existing links: `<BackButton fallback="/settings" label="Settings" />` in `src/routes/(app)/settings/{salary-grades,pay-codes,schedules,leave-types,company}/+page.svelte` (lines 15/14/30/17/14).
- [x] UIC-006 [P] [US1] Detail pages: `src/routes/(app)/separations/[id]/+page.svelte:27` (`fallback="/separations"`), `src/routes/(app)/performance/reviews/[id]/+page.svelte:22` (`fallback="/performance"`), `src/routes/(app)/recruitment/applicant/[applicantId]/+page.svelte:56` (`fallback="/recruitment"`, label from posting title or "Recruitment" — keep current title text as label).
- [x] UIC-007 [P] [US1] `src/routes/(app)/requests/[id]/+page.svelte`: drop the local `afterNavigate`/`backHref` logic (lines ~9–25, 83) in favor of `<BackButton fallback="/requests" label="Requests" />`; update the producer link in `src/routes/(app)/requests/approvals/+page.svelte:189` from `?from=approvals` to `?from=/requests/approvals`.
- [x] UIC-008 [P] [US1] `src/routes/(app)/employees/[id]/+page.svelte:45`: `<BackButton fallback={canManage ? '/employees' : '/team'} label={canManage ? 'Employees' : 'Team'} />` — origin capture now returns from-`/team` visitors to `/team` (the #67 wrong-origin bug).
- [x] UIC-009 [P] [US1] Add missing back buttons: `src/routes/(app)/reports/[type]/+page.svelte` (`fallback="/reports"` label "Reports") and `src/routes/(app)/settings/{org,org-chart,holidays,roles}/+page.svelte` (`fallback="/settings"` label "Settings") — place above/beside the page title, mirroring existing detail pages.
- [x] UIC-010 [US1] e2e `tests/e2e/back-navigation.spec.ts`: (a) HR user navigates `/team` → employee detail → back button → lands on `/team`; (b) hard-load `/employees/[id]` as HR → back button targets `/employees`; (c) `/reports` → any report tab → back → `/reports`; (d) approvals → request detail (hard-load with `?from=/requests/approvals`) → back → approvals.

**Checkpoint**: PR 1 (`fix/back-navigation`) — `pnpm check && pnpm test && pnpm test:e2e` green; closes #67. Merge before starting US2.

## Phase 2 — US2: Action links → bordered buttons (#68)

**Goal**: no action reads as a hyperlink; row/table actions use the bordered convention with
semantic colors; navigation stays links.
**Independent test**: visual pass of each touched table in light + dark; converted forms still
submit.

- [x] UIC-011 [P] [US2] `src/routes/(app)/performance/+page.svelte:244,250,258`: Activate → green bordered, Open reviews → primary bordered, Close → red bordered. Review/cycle name anchors (294, 374) stay links.
- [x] UIC-012 [P] [US2] `src/routes/(app)/settings/pay-codes/+page.svelte:59,131` and `src/routes/(app)/settings/salary-grades/+page.svelte:61`: Activate/Deactivate toggles → green/red bordered (conditional classes swap border+text+hover together). "Org Structure" anchor (salary-grades:169) stays a link.
- [x] UIC-013 [P] [US2] `src/routes/(app)/payroll/periods/+page.svelte:137,143,156,162,172`: Import Attendance + Generate → primary, Lock → yellow (`border-yellow-200 text-yellow-600 hover:bg-yellow-50`), Release → green, Void → red.
- [x] UIC-014 [P] [US2] `src/routes/(app)/payroll/+page.svelte:123,131` (primary / green) and `src/routes/(app)/payroll/[id]/+page.svelte:97,103` (Override + companion → primary).
- [x] UIC-015 [P] [US2] `src/routes/(app)/dashboard/+page.svelte:128`: Post/Cancel toggle → primary bordered. "Attendance" anchor (112) stays a link.
- [x] UIC-016 [P] [US2] Destructive + ConfirmButton call sites: `src/routes/(app)/employees/[id]/+page.svelte:464` (red bordered) and `:785` (`triggerClass` → red bordered); `src/routes/(app)/settings/holidays/+page.svelte:224` (primary bordered) and `:232` (`triggerClass` → red bordered). No `ConfirmButton.svelte` changes.
- [x] UIC-017 [P] [US2] `src/routes/(app)/requests/[id]/+page.svelte:172,180`: Approve-style action → primary bordered, Remove → red bordered. Attachment anchor (146) stays a link.
- [x] UIC-018 [US2] Final sweep: `grep -rn 'hover:underline' src/routes src/lib/components --include='*.svelte'` — classify stragglers nav-vs-action, convert remaining action `<button>`s; confirm exemptions (muted filter "Clear" buttons in `leave:96`, `timesheets:89`, `requests/timesheets:98`, `requests/approvals:116`) and that all remaining `hover:underline` sit on true navigation anchors.
- [x] UIC-019 [US2] Verification: visual pass per touched table in **both themes** (verify skill — check red/green/yellow `-50` hover tints in dark mode; adjust with `dark:` variants if illegible); e2e smoke that one converted form per page still submits (extend nearest existing spec, e.g. pay-codes toggle in the settings spec; add minimal cases where none exists).

**Checkpoint**: PR 2 (`feat/action-buttons`) — suite green; closes #68. Rebased on merged PR 1.

## Phase 3 — US3: Transparent logo (#69)

**Goal**: no black box behind the logo in light mode; mark legible on both themes.
**Independent test**: sidebar + login screenshots in light and dark show the ticket mark with
the page background showing through.

- [x] UIC-020 [US3] Re-export `static/veent-logo.png`: one-off PIL script in the scratchpad (not committed) — load PNG, convert to RGBA, alpha keyed on near-black luminance with a soft ramp so anti-aliased edges keep partial alpha (ticket notches + perforation dashes become transparent); overwrite the asset. Assert programmatically: mode RGBA, corner pixels alpha 0, red/white mark pixels alpha 255.
- [x] UIC-021 [US3] Check `static/favicon.png` and `static/apple-touch-icon.png` for the same baked background: fix favicon the same way if affected; apple-touch-icon may keep a solid background (iOS composites its own) — document the call in the PR description.
- [x] UIC-022 [US3] Visual verification (verify skill): screenshot `(app)` sidebar (`+layout.svelte:242,265` — h-8/h-9) and `/login` (h-14) in light **and** dark theme; confirm no black box and mark legibility at both sizes. No markup changes expected — all three sites reference `/veent-logo.png`.

**Checkpoint**: PR 3 (`fix/logo-transparency`) — `pnpm check` green (no code paths touched); closes #69.

## Phase 4 — Polish & cross-cutting

- [x] UIC-023 Per-PR validation gate: `pnpm check && pnpm test && pnpm test:e2e` on each of the three branches before requesting review.
- [x] UIC-024 PR descriptions: reference the plan (`specs/001-hris-platform/plan-ui-consistency.md`) and close their issues (`Closes #67` / `Closes #68` / `Closes #69`).

---

## Dependencies

- **US3**: fully independent — can start/merge any time.
- **US1 → US2**: US2 restyles buttons in files US1 also edits (`requests/[id]`, `payroll/[id]`, `employees/[id]`, `settings/pay-codes`, `settings/salary-grades`, `settings/holidays`) — merge PR 1 first, branch PR 2 from updated `staging`.
- **US1 internal**: UIC-001 → UIC-002 → UIC-003 → rollout UIC-004…009 (all parallel) → UIC-010.
- **US2 internal**: UIC-011…017 all parallel (different files) → UIC-018 (sweep needs conversions done) → UIC-019.
- **US3 internal**: UIC-020 → UIC-021 → UIC-022.

## Parallel opportunities

- PR 3 (US3) proceeds concurrently with everything.
- Within US1: six rollout tasks UIC-004…009 are `[P]` once UIC-003 lands.
- Within US2: seven conversion tasks UIC-011…017 are `[P]` immediately (PR 2 branch).

## Implementation strategy

**MVP = US1** (PR 1): highest-impact bug fix (wrong-origin + missing back buttons) and the
mechanism the batch is named for. Then US2 rebased on it; US3 whenever convenient (smallest
diff — asset only). Suggested solo order: PR 1 → PR 3 (while PR 1 is in review) → PR 2.
