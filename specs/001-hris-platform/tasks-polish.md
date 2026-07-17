# Tasks (Addendum): QOL & Hardening Batch

**Input**: [plan-polish.md](./plan-polish.md) · issues [#52](https://github.com/Aguynamedkent7/Veent_HRIS/issues/52), [#53](https://github.com/Aguynamedkent7/Veent_HRIS/issues/53), [#54](https://github.com/Aguynamedkent7/Veent_HRIS/issues/54), [#64](https://github.com/Aguynamedkent7/Veent_HRIS/issues/64)
**Parent**: addendum to `tasks.md` — scoped so the main file is not regenerated. IDs use the `POL-###` prefix.

**Story map** (priority = delivery order; each story independently shippable):

| Story | Issue | PR / branch (off `staging`) |
|---|---|---|
| US1 | #53 dashboard links | PR A — `fix/dashboard-links-pii-mask` |
| US2 | #54 PII masking + audited reveal | PR A — same branch |
| US3 | #52 Kanban stage notes + timeline | PR B — `feat/kanban-stage-notes` |
| US4 | #64 shared pagination | PR C — `feat/list-pagination` |

**Conventions**: tests written before implementation (Constitution §V — the test task MUST fail
before its implementation task starts); every mutation and PII access calls `writeAuditLog`;
authorization checks server-side; `[P]` = parallel-safe (different files, no incomplete deps).
Svelte 5 runes; `{@const}` only as immediate child of a block tag; e2e follows
`.claude/skills/verify/SKILL.md` (hydration retry, seeded logins, distinctive labels + cleanup).

No Setup/Foundational phases: nothing is shared across stories — US4's helper/component tasks
live inside US4 and block only its rollout tasks.

---

## Phase 1 — US1: Dashboard metric cards navigate (#53)

**Goal**: each metric card is a one-click drill-down.
**Independent test**: sign in, click each of the four cards, land on its module page.

- [X] POL-001 [US1] **Test-first** e2e `tests/e2e/dashboard.spec.ts`: as admin, click Headcount / On Leave Today / Pending Approvals / Last Payroll cards → assert navigation to `/employees`, `/leave`, `/approvals`, `/payroll`. MUST fail (cards are static divs).
- [X] POL-002 [US1] Wrap the four metric cards in anchors in `src/routes/(app)/dashboard/+page.svelte` — keep `.card` styling, add hover/focus-visible affordance → POL-001 green.

**Checkpoint**: PR-A-ready alongside US2.

## Phase 2 — US2: Mask disbursement numbers + audited reveal (#54)

**Goal**: bank/GCash numbers masked server-side; privileged, audited reveal.
**Independent test**: non-privileged viewer sees `•••• 1234` and no button; HR_ADMIN reveals → full number + `VIEW` audit row; forged reveal POST by non-privileged role → 403.

- [X] POL-003 [US2] Add `VIEW` to `enum AuditAction` in `prisma/schema.prisma`; apply via `pnpm db:migrate`; document the new value in `specs/001-hris-platform/data-model.md`.
- [X] POL-004 [P] [US2] **Test-first** unit cases in `tests/unit/format.test.ts` for `maskAccountNumber`: null → null, length ≤ 4 → fully masked, longer → `•••• ` + last 4, whitespace/dash handling. MUST fail.
- [X] POL-005 [US2] Implement `maskAccountNumber` in `src/lib/utils/format.ts` → POL-004 green.
- [X] POL-006 [US2] Mask in load `src/routes/(app)/employees/[id]/+page.server.ts`: return masked `bankAccountNumber`/`gcashNumber` (full values never leave the server on load) + `canRevealDisbursement` flag (`HR_ADMIN`/`SUPER_ADMIN`).
- [X] POL-007 [US2] Add `?/revealDisbursement` action in the same file: server-side role check (403 otherwise), `writeAuditLog({ action: 'VIEW', entityType: 'Employee', entityId, newValue: { fields: ['bankAccountNumber','gcashNumber'] } })`, return full values in action data.
- [X] POL-008 [US2] UI `src/routes/(app)/employees/[id]/+page.svelte`: masked `font-mono` display + Reveal button when `canRevealDisbursement`; on success swap full values into display **and** edit-form prefills; before reveal, edit inputs are empty with the masked value as placeholder.
- [X] POL-009 [US2] Empty-as-unchanged: in the `update` action / `src/lib/server/services/employees.ts`, an empty submitted `bankAccountNumber`/`gcashNumber` keeps the stored value (explicit clearing deferred — leave a code comment).
- [X] POL-010 [US2] e2e `tests/e2e/pii.spec.ts`: manager opens employee detail → masked + no button; admin reveals → full number visible and audit log lists the `VIEW` entry; direct POST to `?/revealDisbursement` as manager → 403.

**Checkpoint**: PR A (`fix/dashboard-links-pii-mask`) — `pnpm check && pnpm test && pnpm test:e2e` green; PR closes #53 + #54.

## Phase 3 — US3: Kanban stage-move notes + timeline (#52)

**Goal**: optional note on every stage move; applicant page shows who/when/why history.
**Independent test**: drag applicant to a new stage, enter a note, see it on the applicant's timeline.

- [X] POL-011 [US3] **Test-first** unit in `tests/unit/recruitment-stage-notes.test.ts`: `advanceApplicant` persists `notes` to `ApplicantStageHistory` and writes the audit entry (extend existing recruitment test setup/mocks). MUST fail only if coverage is missing — if it passes immediately, keep it as regression cover and note it.
- [X] POL-012 [US3] `advanceStage` action in `src/routes/(app)/recruitment/[id]/+page.server.ts`: read `notes` from formData and pass to `advanceApplicant` (service already accepts it).
- [X] POL-013 [US3] Note dialog in `src/lib/components/recruitment/ApplicantKanban.svelte`: stage move opens a small dialog (target stage summary, optional `<textarea name="notes">`, Confirm/Cancel) that submits the existing `?/advanceStage` form; Svelte 5 `$state`, mind hydration-retry for e2e.
- [X] POL-014 [US3] Timeline: include `stageHistory` (ordered `changedAt desc`) in `getApplicant` (`src/lib/server/services/recruitment.ts`), resolve `changedById` → user email via a batched `db.user.findMany` in the load (no schema change); render a "Stage history" card (stage badge, actor, date, note) in `src/routes/(app)/recruitment/applicant/[applicantId]/+page.svelte`.
- [X] POL-015 [US3] e2e `tests/e2e/recruitment.spec.ts`: admin moves an applicant with a note → applicant detail timeline shows the stage, actor, and note.

**Checkpoint**: PR B (`feat/kanban-stage-notes`) — suite green; PR closes #52.

## Phase 4 — US4: Shared server-side pagination (#64)

**Goal**: list pages load one page (default 20) + count; state in URL; shared component.
**Independent test**: any covered page with >20 rows shows ≤20, "21–40 of N" on page 2, filters + page survive refresh/back.

### Mechanism (blocks the rollout tasks)

- [X] POL-016 [P] [US4] **Test-first** unit `tests/unit/pagination.test.ts`: page clamping (`<1`, `NaN`, beyond last page), skip/take math, custom param name (`myPage`), default pageSize 20, range labels ("21–40 of 137"). MUST fail.
- [X] POL-017 [US4] Implement `src/lib/server/pagination.ts`: `paginate(url, { param = 'page', pageSize = 20 })` → `{ skip, take, page, pageSize }` + meta builder from `total` → POL-016 green.
- [X] POL-018 [US4] `src/lib/components/Pagination.svelte`: prev/next links + "X–Y of N" built from the current `$page.url` searchParams (mutating only its own param, preserving filters); hidden when `total <= pageSize`.

### Rollout (all [P] after POL-017/018 — different files)

- [X] POL-019 [P] [US4] `/timesheets` (`src/routes/(app)/timesheets/+page.{server.ts,svelte}`): paginate mine + team — independent params (`myPage`/`teamPage`) if the tables are separate queries, else split the single query first; **select-all/bulk-delete = current page only**.
- [X] POL-020 [P] [US4] `/leave` (`src/routes/(app)/leave/+page.{server.ts,svelte}`): paginate the requests table; balances/types untouched; select-all = current page.
- [X] POL-021 [P] [US4] `/attendance` (`src/routes/(app)/attendance/+page.{server.ts,svelte}`): paginate the day-rows table; summary header intact.
- [X] POL-022 [P] [US4] `/payslips` (`src/routes/(app)/payslips/+page.{server.ts,svelte}`): skip/take + count on the `payrollEntry` query.
- [X] POL-023 [P] [US4] `/requests` (`src/routes/(app)/requests/+page.{server.ts,svelte}`): paginate `listRequests` (add skip/take/count to the service or paginate at the route).
- [X] POL-024 [P] [US4] `/requests/approvals` (`src/routes/(app)/requests/approvals/+page.{server.ts,svelte}`): paginate; status filter preserved in page links.
- [X] POL-025 [P] [US4] `/reports/audit-log` (`src/routes/(app)/reports/audit-log/+page.{server.ts,svelte}`): refactor hand-rolled pagination onto the shared helper + component (may keep 50/page).
- [X] POL-026 [P] [US4] `/employees` (`src/routes/(app)/employees/+page.{server.ts,svelte}`): paginate; existing search/filter params preserved.
- [X] POL-027 [P] [US4] `/recruitment` (`src/routes/(app)/recruitment/+page.{server.ts,svelte}`): paginate the postings list; the Kanban board is not paginated.
- [X] POL-028 [US4] e2e `tests/e2e/pagination.spec.ts`: seed 25+ rows on one covered page (distinctive label; clean up per verify skill), assert ≤20 rendered, navigate to page 2 ("21–…" visible, URL has `page=2`), apply a filter + change page (both in URL), browser back restores page 1.

**Checkpoint**: PR C (`feat/list-pagination`) — suite green; PR closes #64. Acceptance: one count + one page query per load, no full-table fetches remain on covered pages.

## Phase 5 — Polish & cross-cutting

- [X] POL-029 Per-PR validation gate: `pnpm check && pnpm test && pnpm test:e2e` on each of the three branches before requesting review.
- [X] POL-030 PR descriptions: reference the plan (`specs/001-hris-platform/plan-polish.md`) and close their issues (`Closes #53`, `Closes #54` / `Closes #52` / `Closes #64`).

---

## Dependencies

- **US1, US2, US3**: fully independent of each other and of US4. US1+US2 share PR A only by delivery choice.
- **US2 internal**: POL-003…005 before POL-006; POL-006 → POL-007 → POL-008; POL-009 anytime after POL-006; POL-010 last.
- **US3 internal**: POL-012 before POL-013 (dialog submits the field the action must read); POL-014 independent of both; POL-015 last.
- **US4 internal**: POL-016 → POL-017 → POL-018 → rollout POL-019…027 (all parallel) → POL-028.

## Parallel opportunities

- The three PRs can proceed concurrently (disjoint files).
- Within PR A: POL-004/005 (format util) parallel to POL-003 (schema).
- Within US4: all nine rollout tasks POL-019…027 are `[P]` once the mechanism lands.

## Implementation strategy

**MVP = PR A** (US1 + US2): smallest diff, closes the security-flagged issue first. Then PR B
(small, isolated to recruitment). PR C last — it touches the most load functions, so it rebases
onto whatever merged before it. Suggested order within a solo workflow: A → B → C.
