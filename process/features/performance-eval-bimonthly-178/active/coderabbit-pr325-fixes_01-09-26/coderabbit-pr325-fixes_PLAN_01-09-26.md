---
name: plan:coderabbit-pr325-fixes
description: "Answer the CodeRabbit review on PR #325 — six committable sections, eleven items, shortest working diff"
date: 01-09-26
feature: performance-eval-bimonthly-178
---

# CodeRabbit PR #325 — review response

**TL;DR** — Eleven review items, six commits. Two are real user-facing defects (the opening
email never sends; the review read-back renders a stale local draft). One is a data-loss trap
(a deactivated template silently clears an employee's assignment). The rest are one-liners,
a log-masking change, and three doc corrections. Nothing here is a refactor.

Classification: **SIMPLE** (one session, 6 sections, ~11 atomic steps).

**Date**: 01-09-26
**Status**: ACTIVE — planned, not executed
**Complexity**: SIMPLE
**Feature**: performance-eval-bimonthly-178
**Branch**: feat/performance-eval-bimonthly-178

## Overview

CodeRabbit reviewed PR #325 (the #178 performance-evaluation feature, 51+ commits against
`staging`). This plan answers that review. Every finding was re-verified against the branch
before planning, and three were rejected or corrected: F7 (no advisory lock) is a documented
decision and stays; F1's suggested patch is wrong; F4's stated trigger is wrong. What remains is
eleven items in six small, independently committable sections. This is a review-response pass —
not a refactor, and not an opportunity to widen #178.

## Acceptance Criteria

1. A newly generated review cycle sends the employee an "opened" email; the pre-stamp and the
   existing in-app notices are unchanged and nobody is notified twice.
2. `remindersDue` plans `opened` (not `due-soon`) on the open day when `dueDays <= 3`, proven by
   a new unit case that goes red if the fix is reverted.
3. The review read-back renders the stored server answers; the editable branch still renders the
   local draft.
4. An employee holding a deactivated template still sees it selected on the picker, labelled
   inactive, so pressing Save cannot clear the assignment.
5. `[NOTIFY]` log lines mask the recipient local part and keep the domain and subject;
   `scripts/README.md` and `.env.dev.example` show the masked form.
6. New rating rows seed at `scale.min`; `package.json` declares `node >=20.12`.
7. The stale handoff block, the phase5g TL;DR, and the `send-review-reminders` comment state the
   truth; no reader is told to re-run `db push`.
8. `pnpm check`, `pnpm lint`, `pnpm test` are green, plus the explicit `tsc` gate for
   `scripts/generate-review-cycles.ts`, which `pnpm check` does not cover.

## Phase Completion Rules

- A section is `CODE DONE` when its edits are made and its Fully-Automated gates are green.
- A section is `VERIFIED` only when its Hybrid / Manual-GUI rows in Verification Evidence have
  also been run and recorded. Code-only completion is never `VERIFIED`.
- Each section is committed on its own before the next begins.
- No section may be marked done on a Known-Gap alone; every acceptance criterion above names a
  proving gate in the Verification Evidence table.

## Implementation Checklist

1. `scripts/generate-review-cycles.ts:148-155` — widen the `employee` select to include
   `firstName`, `lastName`, `user: { select: { email: true } }`.
2. `scripts/generate-review-cycles.ts:157-162` — after the employee `notify(...)`, call
   `sendReviewNoticeEmail(...)` with `'opened'`; add the import.
3. `src/lib/server/performance/reminder-plan.ts:99-101` — wrap the nudge window in
   `Math.max(1, cfg.dueDays - DUE_SOON_DAYS)`.
4. `tests/unit/performance-reminders.test.ts` — add one `remindersDue` case at `{ dueDays: 2 }`
   asserting `opened` with `['in-app','email']`; mutation-check it.
5. Commit S1. Run the S1 gates including the scoped `tsc`.
6. `src/routes/(app)/performance/reviews/[id]/+page.svelte:234` — `answers={answerDraft(data.structure, r.answers)}`;
   fix the comment at `:233`. Commit S2.
7. `src/routes/(app)/employees/[id]/+page.server.ts:191-197` — keep the assigned template when
   inactive and suffix its name with ` (inactive)`.
8. `tests/unit/performance-template-assignment.test.ts` — add the inactive-assigned `load` case.
   Commit S3.
9. `src/lib/server/mailer.ts` — add the 2-line `mask()`, apply at `:53` and `:61`; change `??` to
   `||` at `:37`; update `scripts/README.md:443-446` and `.env.dev.example:31-32`. Commit S4.
10. `RatingScaleEditor.svelte:19-24` — `value: scale.min`; `package.json` — add
    `"engines": { "node": ">=20.12" }`. Commit S5.
11. Correct the F9 handoff block, the F13 phase5g TL;DR, and the F6 comment at
    `scripts/send-review-reminders.ts:172-173`. Commit S6.

---

## Scope

In scope: the eleven items listed as ACT in the research brief.
Out of scope: everything in DO NOT ACT and CONSTRAINTS below.

### DO NOT ACT (verbatim from the brief — binding)

> - F7 no advisory lock on the reminder cron. `scripts/send-review-reminders.ts:25-29` documents the
>   decision explicitly (plan item 168): overlap needs two runs alive at once, the de-dup columns cap
>   the damage at one duplicate notice, and a session lock pins a pooled connection
>   (the `src/lib/server/backup/plan.ts` trap). Cron is every 6h (`scripts/README.md:387`), runtime
>   is seconds. Leave it.

### CONSTRAINTS (verbatim from the brief — binding)

> - Do NOT touch, stage, or format `CODERABBIT_REVIEW_PR325.md` — untracked, owned by another session.
>   It is why local `pnpm format:check` is red; CI is unaffected (CI sees committed files only).
> - Do NOT touch prisma/schema.prisma, .github/workflows/ci.yml, scripts/prestart.sh,
>   scripts/migrate-*.ts. Out of scope.
> - Do NOT "fix" the pre-existing a11y warning at CalculatorWindow.svelte:82.
> - No Co-Authored-By trailers, no AI attribution, ever.
> - The user starts servers. Never run ./start.sh, vite, or veent-db-5434.

### Shortest-working-diff rule (applies to every item)

No new modules. No new abstractions. No config for a value that never changes. If an item can
be one line, it is one line. The only new function permitted anywhere in this plan is the
2-line local `mask()` in S4, and only because two call sites in the same file need the identical
expression.

---

## Touchpoints

| File | Section | Kind |
|---|---|---|
| `scripts/generate-review-cycles.ts` | S1 | source (untypechecked by `pnpm check`) |
| `src/lib/server/performance/reminder-plan.ts` | S1 | source |
| `tests/unit/performance-reminders.test.ts` | S1 | test |
| `src/routes/(app)/performance/reviews/[id]/+page.svelte` | S2 | source |
| `src/routes/(app)/employees/[id]/+page.server.ts` | S3 | source |
| `src/routes/(app)/employees/[id]/+page.svelte` | S3 | source (label only, if needed) |
| `tests/unit/performance-template-assignment.test.ts` | S3 | test |
| `src/lib/server/mailer.ts` | S4 | source |
| `scripts/README.md`, `.env.dev.example` | S4 | docs |
| `src/lib/components/performance/RatingScaleEditor.svelte` | S5 | source |
| `package.json` | S5 | config |
| `.../performance-eval-bimonthly-178_PLAN_25-08-26.md` | S6 | docs |
| `.../performance-eval-bimonthly-178-phase5g_REPORT_27-08-26.md` | S6 | docs |
| `scripts/send-review-reminders.ts` | S6 | comment only |

## Public Contracts

- `sendReviewNoticeEmail(recipient, kind, details)` (`src/lib/server/notifications.ts:240`) —
  **called from a new site (the cycle generator). Signature unchanged.**
- `remindersDue(reviews, cfg, now)` (`reminder-plan.ts`) — behaviour changes only for
  `cfg.dueDays <= 3`. Signature unchanged.
- `load` of `/employees/[id]` — `performanceTemplates` may now contain one inactive row.
  Shape `{ id, name }` unchanged; consumers unaffected.
- No schema change. No API-route change. No new env var.

## Blast Radius

- 13 files. 1 route load, 2 Svelte components, 1 pure module, 1 mailer, 2 scripts, 2 tests,
  4 docs/config.
- Risk class: **notification delivery** (S1, S4) and **data loss on a form save** (S3). No
  auth, no money, no schema, no migration.
- S3 is the only item that can destroy stored data if left unfixed; it changes read-side
  filtering only, so the fix itself cannot write.

---

# Section 1 — reminder/email correctness

Commit: `fix(performance): actually email the employee when a review opens (#178)`

### Item A — the opening email is never sent

- **Where:** `scripts/generate-review-cycles.ts:148-168` (the `reviews` select and the notify
  loop).
- **Why:** `reviewRows()` pre-stamps `lastReminderKind: 'opened'`
  (`src/lib/server/services/performance.ts:415`). `remindersDue` skips a kind it already
  stamped (`reminder-plan.ts:116`), so `opened` never fires — and `REMINDER_CHANNELS.opened`
  is `['in-app','email']` (`reminder-plan.ts:30`), so the email dies with it. No employee
  has ever received "your review is open" by email.
- **Change (two edits, same block):**
  1. Widen the existing select at `:148-155` so the employee carries a name and an address:
     `employee: { select: { userId: true, firstName: true, lastName: true, user: { select: { email: true } } } }`.
     Leave `reviewer` selecting `userId` only.
  2. Immediately after the existing employee `notify(...)` call (`:157-162`), add one call:
     ```
     sendReviewNoticeEmail(review.employee.user.email, 'opened', {
       recipientName: `${review.employee.firstName} ${review.employee.lastName}`,
       cycleName: period.name,
       reviewUrl: `/performance/reviews/${review.id}`
     })
     ```
     plus the import from `$lib/server/notifications` (or the relative path this script already
     uses for server imports — match the file's existing import style).
- **Employee only, not the reviewer.** `RECIPIENTS.opened = ['employee']`
  (`scripts/send-review-reminders.ts:53`). The generator's reviewer nudge stays in-app, exactly
  as the reminder planner would have done it.
- **Keep the pre-stamp.** Removing it re-opens the duplicate in-app notice the comment at
  `performance.ts:411-414` was written to kill. No schema change, no channel-tracking columns.

**DECISION — `openReviewsForCycle` does NOT get the email.**
`src/lib/server/services/performance.ts:431` has **zero callers** on this branch (verified:
`grep -rn openReviewsForCycle src scripts tests` returns only its own definition). It is a
dead export kept for the HR-initiated path that was never wired. Adding an email to a path
nothing calls is speculative code that no test can reach. Because only one caller needs the
email, **no shared notification helper is created** — `sendReviewNoticeEmail` already *is*
the shared seam, and the generator calls it directly. If the HR path is ever wired, it adds
the same three-line call at that time.

### Item D — `nudgeDay` can precede `createdAt`

- **Where:** `src/lib/server/performance/reminder-plan.ts:99-101`.
- **Change:** one expression —
  `new Date(r.createdAt.getTime() + Math.max(1, cfg.dueDays - DUE_SOON_DAYS) * DAY_MS)`.
- **Why:** `dueDays` is legal from 1 to 180 (`performance.ts:820`, enforced at
  `settings/performance/+page.server.ts:34-38`). With `dueDays <= 3` the nudge day lands on or
  before the open day, so `due-soon` wins precedence on day zero and the employee never gets
  `opened`. Masked today by item A; unmasked the moment A ships.

### Item D-test — new unit case

- **Where:** `tests/unit/performance-reminders.test.ts`. The file pins `CFG = { dueDays: 14 }`
  at `:15` and every case uses it.
- **Change:** add ONE `remindersDue` case with a local `{ dueDays: 2 }` config: a review
  created at `OPENED_AT`, `now` on the same Manila day, `lastReminderKind: null` — assert the
  planned kind is `opened` with channels `['in-app','email']`, not `due-soon`. Mutation check:
  revert the `Math.max` and this case must go red.

### Verification (S1)

| Item | Tier | Proof |
|---|---|---|
| D + D-test | Fully-Automated | `pnpm test tests/unit/performance-reminders.test.ts` green, and red when `Math.max` is reverted |
| A | Hybrid | `pnpm check` cannot see `scripts/**`. Run `npx tsc --noEmit -p tsconfig.json --include scripts/generate-review-cycles.ts` **or** the cheaper real check: `pnpm dotenv -e .env.dev -- tsx scripts/generate-review-cycles.ts --dry-run` if the script supports it. Requires the DB the **user** starts. |
| A | Manual-GUI (optional) | With `SMTP_HOST` unset, the generator run prints one `[NOTIFY] (no SMTP_HOST — not sent) <…>: Performance review open — …` line per new review. |

Must stay green: `tests/unit/performance-reminders.test.ts`,
`tests/unit/review-notice-email.test.ts`, `tests/unit/performance-cycle-plan.test.ts`.

**Blast radius:** 3 files, notification delivery. **Rollback:** `git revert` the section commit;
no data written, no schema touched, so revert is total.

---

# Section 2 — review read-back renders the stale draft

Commit: `fix(performance): show the saved answers in the read-back, not the local draft (#178)`

### Item B

- **Where:** `src/routes/(app)/performance/reviews/[id]/+page.svelte:234`.
- **Change:** `answers={draft}` → `answers={answerDraft(data.structure, r.answers)}`. One line.
  `answerDraft` is already imported at `:5`; `r` is `$derived(data.review)` at `:24`; the
  `{:else if r.answers}` branch at `:232` already proves `r.answers` truthy.
- **Why:** `draft` is `$state(...)` initialised once at `:26-30` deliberately (re-deriving would
  discard unsaved typing) and nothing syncs it. In the DISABLED read-back branch that means the
  employee reads their own stale local object instead of the stored evaluation.
- **Leave the editable branch on `draft`.** That is the whole reason `draft` exists.
- Update the comment at `:233` if it now misdescribes the source.

### Verification (S2)

| Tier | Proof |
|---|---|
| Fully-Automated | `pnpm check` + `pnpm lint` green (catches the expression and unused-import drift) |
| Manual-GUI | Open a released review as the employee: the read-back shows the evaluator's stored answers. Assert on a **positive** marker — a specific answer string that exists only in the DB row, not an empty form. |

Must stay green: `tests/unit/performance-template-render.test.ts`,
`tests/unit/performance-release.test.ts`, `tests/unit/review-privacy.test.ts`.

**Blast radius:** 1 file, 1 line, read-side only. **Rollback:** revert the line.

---

# Section 3 — deactivated template drops off the picker

Commit: `fix(performance): keep an assigned template on the picker after it is deactivated (#178)`

### Item C

- **Where:** `src/routes/(app)/employees/[id]/+page.server.ts:191-197` — the
  `.filter((t) => t.isActive)` on `listTemplates(...)`.
- **Change:** keep the currently assigned template even when inactive, and say so in its label:
  ```
  .filter((t) => t.isActive || t.id === employee.assignedTemplateId)
  .map((t) => ({ id: t.id, name: t.isActive ? t.name : `${t.name} (inactive)` }))
  ```
  `employee.assignedTemplateId` is already in scope — it is returned at `:204`.
- **Why (this is the data-loss one):** `+page.svelte:460-462` renders
  `selected={t.id === data.assignedTemplateId}`. With no matching option the browser selects the
  first, `— none —`, so the card **lies** about a real assignment. Pressing Save on that card
  posts `''`, which `schemas` maps to `null`, and the action at `:511-540` writes
  `data: { assignedTemplateId }` unconditionally — clearing a live assignment.
- **Trigger correction:** only the standalone `?/assignTemplate` form
  (`+page.svelte:446-449`) can do this. Saving other employee cards does NOT touch the field.
  CodeRabbit's "opening and saving the employee form" is wrong; do not widen the fix to other
  actions.
- No Svelte change is required — the `(inactive)` suffix rides in on `name`. Touch
  `+page.svelte` only if the label needs the suffix styled, which it does not.

### Verification (S3)

| Tier | Proof |
|---|---|
| Fully-Automated | Add one case to `tests/unit/performance-template-assignment.test.ts`: with `getEmployee` returning `assignedTemplateId: 'tpl-old'`, `load` returns a list containing `{ id: 'tpl-old', name: 'Retired Form (inactive)' }`. The mock at `:152-156` already carries an inactive `tpl-old`. |
| Fully-Automated (regression) | The existing case at `:171-183` must stay green — with `assignedTemplateId: null` the list is still the two active rows only. |
| Manual-GUI | Deactivate a template that an employee holds, reload their page: the picker shows it selected and labelled inactive. |

Must stay green: `tests/unit/performance-template-assignment.test.ts`,
`tests/unit/performance-templates-rbac.test.ts`, `tests/unit/performance-template-delete.test.ts`.

**Blast radius:** 1-2 files + 1 test, read-side filter only. **Rollback:** revert; the fix
writes nothing, so no data migration is implied either way.

---

# Section 4 — mailer hygiene

Commit: `chore(mailer): mask the recipient local part in delivery logs`

### Item E — PII in logs

- **Where:** `src/lib/server/mailer.ts:53` and `:61`, both interpolating `${to}`.
- **Why:** `docker-compose.yml:41-57` sets no `logging:` block, so the default json-file driver
  keeps every address on disk, unrotated. Pre-existing pattern (commit `9d885e8` cut six such
  sites down to these two), not introduced by this PR — but cheap to close now.
- **Change:** one 2-line local helper at module scope, used by both lines:
  ```
  const mask = (to: string) => to.replace(/^[^@]+/, (l) => l.slice(0, 2) + '***')
  ```
  then `<${mask(to)}>` at `:53` and `:61`. Keep the domain and the subject — that is the
  diagnostic the comment at `:44-48` justifies. This is the one helper this plan allows: two
  call sites in the same file needing the identical expression, and duplicating the regex is
  the worse diff.
- **Docs move with it (both advertise the old output):**
  - `scripts/README.md:443-446` — the sample block prints a full address. Update the sample to
    the masked form.
  - `.env.dev.example:31-32` — the note describing the `[NOTIFY]` line. Update to match.

### Item F10 — `??` → `||`

- **Where:** `src/lib/server/mailer.ts:37`, `Number(process.env.SMTP_PORT ?? 587)`.
- **Change:** `Number(process.env.SMTP_PORT || 587)`. One character pair.
- **Why:** no behaviour change (nodemailer already does `Number(port) || 587`); this is purely
  so a reader does not have to know that to see an empty-string env var is handled.

### Verification (S4)

| Tier | Proof |
|---|---|
| Fully-Automated | `pnpm check`, `pnpm lint`, `pnpm test` green |
| Manual-GUI | Trigger any send with `SMTP_HOST` unset; the console line reads `<ae***@example.com>` and still names the subject |

Must stay green: `tests/unit/review-notice-email.test.ts` and any test asserting `[NOTIFY]`
output — grep `[NOTIFY]` under `tests/unit/` before editing; if one pins the full address, that
assertion moves with the code.

**Blast radius:** 3 files, logging only. **Rollback:** revert; no persisted state depends on
log format.

---

# Section 5 — trivia

Commit: `chore: seed new rating rows at the scale minimum and declare the node engine`

### Item F1 — `value: scale.min`

- **Where:** `src/lib/components/performance/RatingScaleEditor.svelte:19-24`, `add()` pushes
  `{ value: 0, description: '' }`.
- **Change:** `{ value: scale.min, description: '' }`. One token.
- **Why:** `0` sits below the default `min: 1` (`schemas:156-165`). Cosmetic only — row values
  key nothing and are not validated.
- **CodeRabbit's suggested patch is REJECTED.** It proposes
  `Math.max(...scale.rows.map(r => r.value)) + 1`, which yields **6 on a 1-5 scale** (out of
  range, worse than the bug) and returns `-Infinity` on an empty `rows` array. `scale.min` is
  correct, in range, and shorter.

### Item F12 — `engines`

- **Where:** `package.json`, top level.
- **Change:** add `"engines": { "node": ">=20.12" }`.
- **Why:** documents reality, changes nothing. CI pins node 20 (`ci.yml:26,84,164`) and
  `Dockerfile:5,21` uses `node:20-slim`. The floor is real:
  `tests/unit/performance-no-scoring.test.ts:26` uses `import.meta.dirname` (20.11+) and
  `:31-33` uses `Dirent.parentPath` (20.12+).

### Verification (S5)

| Tier | Proof |
|---|---|
| Fully-Automated | `pnpm check`, `pnpm lint`, `pnpm test` green |
| Fully-Automated | `pnpm install --frozen-lockfile` still succeeds under the local node (confirm `node -v` is >= 20.12 before adding the field — if the local runtime is below it, pnpm will warn) |
| Manual-GUI | In the template builder, "Add row" seeds `1` on a default 1-5 scale |

Must stay green: `tests/unit/performance-template-schema.test.ts`,
`tests/unit/performance-no-scoring.test.ts`.

**Blast radius:** 2 files. **Rollback:** revert. If `engines` breaks any local install, drop
that one field and keep F1.

---

# Section 6 — docs

Commit: `docs(performance): correct the stale handoff, the phase5g TL;DR and the reminder comment`

### Item F9 — stale handoff block (highest-risk doc item)

- **Where:** `process/features/performance-eval-bimonthly-178/active/performance-eval-bimonthly-178_25-08-26/performance-eval-bimonthly-178_PLAN_25-08-26.md:2095-2103`.
- **What is wrong:** item 5 still says "Then EXECUTE, beginning at item 1" and "Before item 43
  (`db push`)"; item 6 claims tip `db04eb6`, 0 commits ahead, only untracked docs.
- **Why it matters:** a fresh compacted agent reading this would **re-run applied destructive
  steps** (the `db push`).
- **Change:** replace items 5 and 6 with the true state — all nine phases code done, tip
  `fd9c604`, 51+ commits ahead of `origin/staging`, working tree clean, PR #325 open against
  `staging` and **not** a draft, schema already migrated locally, remaining gate is the owner
  GUI pass.
- **Keep verbatim:** the "user starts the database and dev server" line. Still true.

### Item F13 — phase5g TL;DR

- **Where:** `.../performance-eval-bimonthly-178-phase5g_REPORT_27-08-26.md:18-20`.
- **What is wrong:** the TL;DR says "the only e2e failures are the two known local-data ones";
  the body at `:49` says 8 failed and the table at `:54-63` lists 8.
- **Change:** TL;DR reads 8 failures — 2 local-data plus 6 #287 parallel-run login flakes that
  pass at `--workers=1`. Body and table are already correct; do not touch them.

### Item F6 — comment only

- **Where:** `scripts/send-review-reminders.ts:172-173`.
- **What is wrong:** the comment claims the de-dup write happens after the fan-out so a crash
  mid-send resends. True for in-app; **false for email** — `deliver` (`mailer.ts:50`) returns
  `void` and swallows errors at `:62`, so the write records an email **attempt**, not a
  delivery.
- **Change:** correct the comment to say exactly that. **Do NOT change the control flow.**
  `deliver` cannot be awaited without an async signature change across
  onboarding/timesheets/leave/recruitment/offboarding (`mailer.ts:8-11`), and leaving rows
  unmarked would re-run `notify` (no de-dup, `services/notifications.ts:14`) every 6 hours
  while SMTP is down.

### Verification (S6)

| Tier | Proof |
|---|---|
| Fully-Automated | `git log --oneline -1` matches the tip written into F9; `gh pr view 325 --json isDraft,state,baseRefName` matches the claim |
| Fully-Automated | `pnpm lint` green (the F6 comment lives in a linted script) |
| Manual | Read the corrected F9 block and confirm no instruction tells a reader to run `db push` or start at item 1 |

**Blast radius:** 3 files, prose only (one is a code comment). **Rollback:** revert.

---

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `pnpm test` (full unit suite, ~1737 tests) | Fully-Automated | No regression across all six sections |
| `tests/unit/performance-reminders.test.ts` new `{ dueDays: 2 }` case | Fully-Automated | Item D — `opened` fires on a short cycle instead of `due-soon` |
| Mutation check: revert `Math.max`, the new case goes red | Fully-Automated | Item D test is not vacuous |
| `tests/unit/performance-template-assignment.test.ts` new inactive-assigned case | Fully-Automated | Item C — an assigned inactive template stays on the picker |
| Existing `load` list case at `:171-183` stays green | Fully-Automated | Item C did not widen the active-only list for unassigned employees |
| `pnpm check` | Fully-Automated | Items B, C, E, F1, F10 typecheck (does NOT cover `scripts/**`) |
| `pnpm lint` | Fully-Automated | All sections, incl. the F6 comment file |
| `npx tsc --noEmit` scoped to `scripts/generate-review-cycles.ts` | Fully-Automated | Item A typechecks — `pnpm check` cannot see it |
| Generator run against the user-started DB, `SMTP_HOST` unset | Hybrid | Item A — one `[NOTIFY] … Performance review open` line per new review |
| Employee opens a released review | Manual-GUI | Item B — stored answers render, not the local draft |
| HR deactivates an assigned template, reloads the employee page | Manual-GUI | Item C — picker still shows it, labelled inactive |
| `[NOTIFY]` console line after any send | Manual-GUI | Item E — local part masked, domain and subject intact |
| `git log --oneline -1` + `gh pr view 325` | Fully-Automated | Item F9 handoff block is true when written |

### Gate notes

- **`pnpm check` does NOT cover `scripts/**` or `prisma/**`.** Section 1 and Section 6 both
  touch `scripts/`, so each names its own explicit `tsc`/runtime check above. Do not accept a
  green `pnpm check` as proof for `scripts/generate-review-cycles.ts`.
- **Run `pnpm prisma generate` before believing a red `pnpm check`.** A stale client has
  produced phantom type errors here at least three times.
- **Local `pnpm format:check` is already red** because of the untracked
  `CODERABBIT_REVIEW_PR325.md` owned by another session. Do not chase it, do not stage it, do
  not format it. CI sees committed files only and is unaffected.
- **The e2e suite is not a gate for this plan.** No item touches navigation, auth redirects or
  hydration; #287 flakiness would only add noise.

## Test Infra Improvement Notes

(none identified yet)

## Security

No auth, secrets or trust-boundary change. Item E **reduces** PII exposure in on-disk container
logs. Item C changes a read-side filter only; the write path's org-scoped trust boundary at
`+page.server.ts:524-530` is untouched.

## Risks

| Risk | Mitigation |
|---|---|
| Item A double-notifies (email + a future `opened` reminder) | The pre-stamp stays, so the cron's `opened` kind still never fires. Verified at `reminder-plan.ts:116`. |
| Item A widens the select and breaks the generator's types | `pnpm check` misses `scripts/**` — the explicit `tsc` gate in S1 is mandatory, not optional. |
| Item C label suffix leaks into a consumer that parses `name` | Only `+page.svelte:460-462` renders it, as option text. Grep `performanceTemplates` before committing. |
| Item F12 `engines` blocks an install on an older local node | Check `node -v` first; drop the field if below 20.12. |
| Item E masking hides the address needed to debug a bounce | Domain and subject are kept — the same diagnostic the comment at `mailer.ts:44-48` already justified. |

## Dependencies and ordering

Sections are independent and each is separately committable. Recommended order S1 → S6 (defect
severity first). The one soft coupling: item D's floor only becomes observable once item A ships,
so keep them in the same commit.

## Validate Contract

(placeholder — vc-validate-agent writes this section before EXECUTE)

## Resume and Execution Handoff

1. **Selected plan file:** `process/features/performance-eval-bimonthly-178/active/coderabbit-pr325-fixes_01-09-26/coderabbit-pr325-fixes_PLAN_01-09-26.md`
2. **Last completed step:** PLAN written. No source file has been touched by this plan.
3. **Validate-contract status:** pending — VALIDATE has not run.
4. **Context loaded:** `process/context/all-context.md`, `process/context/tests/all-tests.md`,
   `CLAUDE.md`, and the research brief (all file:line claims re-verified against the branch on
   01-09-26).
5. **Repo state at the moment of writing (verified, not remembered):**
   - branch `feat/performance-eval-bimonthly-178`, tip **`fd9c604`**
   - working tree clean except the untracked `CODERABBIT_REVIEW_PR325.md` (another session's —
     leave it)
   - **PR #325 is OPEN against `staging` and is NOT a draft** (`gh pr view 325`)
   - all nine #178 phases are code-done; the outstanding gate is the **owner GUI pass**
   - the local schema is already migrated — **do not run `db push`**
   - the **user** starts the database and the dev server; never run `./start.sh`, `vite`, or
     `veent-db-5434`
6. **Next step for a fresh agent:** say `ENTER VALIDATE MODE`. Do not implement from this plan
   until VALIDATE has written the contract above.

---

Plan complete. Review carefully. Say **'ENTER VALIDATE MODE'** when ready to proceed to plan
validation (required before implementation).
