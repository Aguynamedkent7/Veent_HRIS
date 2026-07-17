# Plan — UI Consistency Batch (back navigation, action buttons, logo transparency)

**Spec**: `specs/001-hris-platform/spec.md` (cross-cutting UI polish; no FR changes)
**Issues**: [#67](https://github.com/Aguynamedkent7/Veent_HRIS/issues/67) · [#68](https://github.com/Aguynamedkent7/Veent_HRIS/issues/68) · [#69](https://github.com/Aguynamedkent7/Veent_HRIS/issues/69)
**Base branch**: `staging`

## Goal

Make navigation and action affordances consistent app-wide: a shared, origin-aware back-button
component replacing ad-hoc text links and covering pages that have none (#67); bordered buttons
for all row/table actions currently styled as colored text links (#68); and a transparent logo
asset that stops showing a black box in light mode (#69).

## Current state (verified against `staging`)

- **#67 — text back links (13)**: `employees/[id]:45`, `payroll/[id]:18`,
  `payroll/calculator:40`, `payroll/periods:26`, `recruitment/applicant/[applicantId]:56`,
  `performance/reviews/[id]:22`, `requests/[id]:83`, `separations/[id]:27`, and settings
  subpages `salary-grades:15`, `pay-codes:14`, `schedules:30`, `leave-types:17`, `company:14`.
  All are bare muted anchors (`← Settings` style).
- **#67 — no back affordance at all**: `/reports/[type]`, `/settings/org`,
  `/settings/org-chart` (per issue), **plus `/settings/holidays` and `/settings/roles`**
  (found in sweep — same gap, added to scope).
- **#67 — origin handling**: only `requests/[id]` is origin-aware (commit `615bf19`:
  `afterNavigate` → `?from` hint → static fallback). `employees/[id]` hard-codes
  `canManage ? '/employees' : '/team'`, sending HR users who arrived from `/team` back to
  `/employees` (the reported bug).
- **#68 — action `<button>`s styled as text links** (colored `hover:underline`), confirmed by
  sweep: `performance:244,250,258` (Activate / Open reviews / Close),
  `settings/pay-codes:59,131` (Activate/Deactivate ×2 tables),
  `settings/salary-grades:61` (Activate/Deactivate),
  `payroll/periods:137,143,156,162,172` (Import Attendance / Generate / Lock / Release / Void),
  `payroll:123,131`, `payroll/[id]:97,103` (Override), `dashboard:128` (Post/Cancel toggle),
  `employees/[id]:464,785` (destructive; 785 via `ConfirmButton` `triggerClass`),
  `settings/holidays:224,232` (232 via `triggerClass`), `requests/[id]:172,180`
  (Approve / Remove).
  Navigation anchors with the same classes (review names, doc links, "View detail →") stay links.
- **#68 — reference convention** (requests table `Resubmit`/`Cancel`,
  `requests/+page.svelte:397,407`): `rounded-md border border-primary/40 px-3 py-1 text-xs
font-medium text-primary hover:bg-primary/10` and the red analogue
  (`border-red-200 … text-red-600 hover:bg-red-50`).
- **#69**: `static/veent-logo.png` is **RGB, no alpha channel**, uniform near-black background
  (~`rgb(1,1,1)`) behind a red ticket mark with white lettering. Rendered at
  `(app)/+layout.svelte:242,265` and `(auth)/login/+page.svelte:16`. The mark itself is legible
  on both themes; only the baked-in background is the problem.

## Locked decisions (from discussion)

1. **#67 — back button style**: bordered ghost button with an inline-Heroicons **arrow-left
   icon + destination label** (e.g. `← Payroll`), placed where the text links sit today.
2. **#67 — origin-aware everywhere**: the shared component itself implements the `615bf19`
   pattern — `afterNavigate` origin capture → `?from` path hint → required static `fallback`
   prop. One behavior on every page, which also fixes the `employees/[id]` wrong-origin bug.
3. **#69 — transparent re-export**: strip the uniform black background from the existing PNG
   programmatically (alpha-keyed, smooth edges). Ticket notches and the perforation dashes
   become transparent so the page background shows through. No new source asset needed.
4. **Delivery — three PRs off `staging`**, one per issue:
   - PR 1: #67 — `fix/back-navigation`
   - PR 2: #68 — `feat/action-buttons`
   - PR 3: #69 — `fix/logo-transparency`

Planner calls (veto at task review if disagreed):

- **`?from` generalization**: the component reads `?from` as an **app-relative path** (must
  start with a single `/`; anything else ignored). The one existing producer
  (`requests/approvals` linking with `?from=approvals`) migrates to `?from=/requests/approvals`.
- **Label vs. actual target**: the button shows the provided `label` only when the resolved
  back target's pathname equals the `fallback` pathname; otherwise it shows generic **"Back"**
  (so `← Employees` never points at `/team`).
- **Muted "Clear" filter buttons** (`leave:96`, `timesheets:89`, `requests/timesheets:98`,
  `requests/approvals:116`) are **exempt** from #68: they are low-emphasis form resets sitting
  inside filter bars, not row actions that read as navigation.

## Constitution check

| Gate            | Status                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 Data privacy | ✅ No PII surfaces touched; asset + styling changes only.                                                                                                                   |
| P2 RBAC         | ✅ No authorization changes. Back targets are client-side conveniences; every destination route keeps its own server-side guard. `?from` is validated as an internal path.  |
| P3 Spec-driven  | ✅ This plan + `/speckit-tasks` before implementation; no FR changes (cross-cutting polish).                                                                                |
| P4 Audit trail  | ✅ No data mutations introduced or altered.                                                                                                                                 |
| P5 Test-first   | ✅ Unit tests for the `?from`/fallback resolution helper; e2e for origin-aware back and the wrong-origin fix; visual verification for #68/#69 (see per-slice verification). |

No deviations — Complexity Tracking table not needed.

---

## Slice 1 — Shared BackButton + rollout (#67) — PR `fix/back-navigation`

1. **Component** `src/lib/components/ui/BackButton.svelte`:
   - Props: `fallback: string` (required), `label: string` (destination name).
   - Resolution order: `afterNavigate` captured origin (pathname+search, ignoring
     same-path navigations) → valid `?from` path → `fallback`.
   - Extract the resolution into a pure helper (`resolveBackTarget(cameFrom, fromParam,
fallback)`) in `$lib/utils` so it's unit-testable without mounting.
   - Markup: `<a>` styled as a bordered ghost button — inline-Heroicons `arrow-left`
     (outline, `size-4`) + label, `text-muted-foreground hover:text-foreground` base with the
     app's `rounded-md border` button treatment.
2. **Replace the 13 text back links** with `<BackButton>` (per-page `fallback`/`label` from the
   current targets). `requests/[id]` drops its local `afterNavigate` logic in favor of the
   component; `requests/approvals` link updates to `?from=/requests/approvals`.
3. **Fix wrong origin on `employees/[id]`**: fallback stays role-based
   (`canManage ? '/employees' : '/team'`), origin capture handles the from-`/team` case.
4. **Add missing back buttons**: `/reports/[type]` → `/reports` ("Reports");
   `/settings/org`, `/settings/org-chart`, `/settings/holidays`, `/settings/roles` →
   `/settings` ("Settings"). Header placement mirrors the existing detail pages
   (button above/beside the page title).

Verification: unit (`resolveBackTarget` — origin wins, malformed `?from` ignored, fallback
default); e2e (open employee from `/team` → back returns to `/team`; hard-load a detail URL →
back goes to fallback; report tab → back to `/reports`).

## Slice 2 — Action links → bordered buttons (#68) — PR `feat/action-buttons`

1. **Convert every confirmed instance** (list in Current state) to the requests-table button
   convention, keeping each action's semantic color:
   - primary (`border-primary/40 text-primary hover:bg-primary/10`) — Open reviews, Override,
     Import Attendance, Post, Approve, edit-style actions;
   - red (`border-red-200 text-red-600 hover:bg-red-50`) — Close, Void, Deactivate, Remove,
     destructive deletes;
   - green/yellow analogues (`border-green-200 text-green-600 hover:bg-green-50`, etc.) —
     Activate, Release, Lock.
2. **`ConfirmButton` call sites** (`employees/[id]:785`, `settings/holidays:232`) get the same
   classes via the existing `triggerClass` prop — no component change.
3. **Leave navigation anchors as links** (review/cycle names, document links, "View detail →",
   dashboard "Attendance"). Muted filter "Clear" buttons exempt per locked decision.
4. Final sweep at implementation time: `grep 'hover:underline'` over `src/routes` +
   `src/lib/components`, classify any stragglers nav-vs-action.

Verification: visual pass over each touched table (verify skill, both themes — note the
`red-50`/`green-50` hover tints in dark mode); e2e smoke that converted forms still submit
(one per page is enough — markup-only change).

## Slice 3 — Transparent logo (#69) — PR `fix/logo-transparency`

1. **Re-export**: one-off script (scratchpad, not committed) using PIL — load
   `static/veent-logo.png`, add alpha keyed on near-black luminance with a soft ramp
   (anti-aliased edges keep partial alpha), write back as RGBA PNG. Trim/inspect result at
   both small (h-8) and large (h-14) render sizes.
2. **No markup changes expected**: all three render sites (`(app)/+layout.svelte:242,265`,
   `(auth)/login/+page.svelte:16`) reference `/veent-logo.png` and inherit the fix.
3. **Check siblings**: `static/favicon.png` and `static/apple-touch-icon.png` — if they share
   the baked black background, fix the favicon the same way; apple-touch-icon may keep a solid
   background (iOS composites its own).

Verification: verify skill — screenshot sidebar + login in light and dark themes; no black box,
mark legible on both.

---

## Artifacts

- `data-model.md` — no entity changes.
- `contracts/` — no API changes. New URL contract: `?from=<app-relative path>` back-hint,
  documented here (component validates leading `/`).
- `quickstart.md` — unchanged; per-slice verification above covers validation.
- `research.md` — unchanged; all unknowns resolved by code inspection + discussion
  (logo asset inspected: RGB/no-alpha confirmed).

## Suggested sequencing

PR 3 (#69) any time — asset-only, conflicts with nothing. PR 1 (#67) before PR 2 (#68): both
touch `requests/[id]`, `payroll/[id]`, `employees/[id]`, and the settings subpages, so land the
back-button rollout first and rebase the button conversion on top. `/speckit-tasks` next to
expand slices into tasks.
