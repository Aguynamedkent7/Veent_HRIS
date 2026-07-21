# Plan — QOL & Hardening Batch (dashboard links, PII masking, Kanban notes, pagination)

**Spec**: `specs/001-hris-platform/spec.md` (recruitment FR-066–FR-069, dashboard, employee 201, list pages)
**Issues**: [#52](https://github.com/Aguynamedkent7/Veent_HRIS/issues/52) · [#53](https://github.com/Aguynamedkent7/Veent_HRIS/issues/53) · [#54](https://github.com/Aguynamedkent7/Veent_HRIS/issues/54) · [#64](https://github.com/Aguynamedkent7/Veent_HRIS/issues/64)
**Base branch**: `staging`

## Goal

Close out four post-launch gaps: make dashboard metric cards navigate (#53), mask bank/GCash
numbers with an audited reveal (#54), add stage-move notes + a history timeline to recruitment
(#52 — the only remaining gap; interviews/offers already shipped), and introduce shared
server-side pagination across the list pages (#64).

## Current state (verified against `staging`)

- **#52**: `Interview`/`Offer` models, the full service layer (`scheduleInterview`, `issueOffer`,
  `respondToOffer`, …), applicant detail UI, and offer-gated conversion **already exist**.
  `advanceApplicant(applicantId, orgId, stage, notes, ctx)` already accepts and stores `notes`
  in `ApplicantStageHistory` — but the Kanban's `?/advanceStage` forms never send one, and no UI
  displays stage history.
- **#53**: the four metric cards in `src/routes/(app)/dashboard/+page.svelte` are plain
  `div.card`s; only the Attendance summary links out.
- **#54**: `src/routes/(app)/employees/[id]/+page.svelte` renders `bankAccountNumber` and
  `gcashNumber` in full (display card ~line 182 and edit-form prefills). `AuditAction` has no
  view/access value — the constitution requires data _access_ logging for a reveal.
- **#64**: only `/reports/audit-log` paginates (`?page=` + skip/take + count). No shared
  component or helper; `/timesheets` and `/leave` have select-all + bulk actions over the full
  rendered list.

## Locked decisions (from discussion)

1. **#52** — optional **note dialog on every Kanban stage move**, plus a **stage-history
   timeline** (who, when, note) on the applicant detail page.
2. **#54** — **masked by default for everyone** (`•••• 1234`); **Reveal** action for
   `HR_ADMIN`/`SUPER_ADMIN` that fetches full numbers server-side and writes a **VIEW audit
   entry**.
3. **#64** — first iteration covers the **core six** (`/timesheets`, `/leave`, `/attendance`,
   `/payslips`, `/requests` + `/requests/approvals`, `/reports/audit-log`) **plus `/employees`
   and `/recruitment`**. No page-size selector yet. **Select-all = current page only.**
4. **Delivery — three PRs off `staging`**:
   - PR A (small): #53 + #54 — `fix/dashboard-links-pii-mask`
   - PR B (small): #52 — `feat/kanban-stage-notes`
   - PR C (larger): #64 — `feat/list-pagination`

## Constitution check

| Gate            | Status                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1 Data privacy | ✅ Strengthened: #54 masks PII server-side (masked strings leave the server; full values only via the audited reveal action). No new PII surfaces elsewhere. |
| P2 RBAC         | ✅ Reveal is role-checked **server-side** (`HR_ADMIN`/`SUPER_ADMIN`); all other slices reuse existing route/action guards.                                   |
| P3 Spec-driven  | ✅ This plan + `/speckit-tasks` before implementation; spec FRs unchanged (gap-closing work).                                                                |
| P4 Audit trail  | ✅ New `VIEW` value on `AuditAction` records reveals; stage moves already write stage history + audit log.                                                   |
| P5 Test-first   | ✅ Unit tests for mask + pagination helpers; e2e for reveal gating, note dialog, page navigation (see per-slice verification).                               |

No deviations — Complexity Tracking table not needed.

---

## Slice A1 — Dashboard metric cards navigate (#53)

`src/routes/(app)/dashboard/+page.svelte`: wrap each metric card in an anchor (keep `.card`
styling; add hover/focus affordance so it reads as clickable).

| Card               | Target                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| Employee headcount | `/employees`                                                            |
| On Leave Today     | `/leave`                                                                |
| Pending Approvals  | `/approvals` (unified inbox; card already counts requests + timesheets) |
| Last Payroll       | `/payroll`                                                              |

No server changes. Verification: e2e — click each card, assert URL.

## Slice A2 — Mask disbursement numbers + audited reveal (#54)

1. **Schema**: add `VIEW` to `AuditAction` (`prisma db push`; reflect in `data-model.md`).
2. **Helper**: `maskAccountNumber(value: string | null): string | null` in
   `src/lib/utils/format.ts` — all but last 4 as `••••`; values ≤4 chars fully masked. Unit tests.
3. **Load**: employee detail `+page.server.ts` returns **masked** `bankAccountNumber` /
   `gcashNumber` (masking happens server-side; the full values never reach the client on load).
4. **Reveal**: form action `?/revealDisbursement` — server-side role check
   (`HR_ADMIN`/`SUPER_ADMIN`), returns full numbers in action data, writes
   `{ action: 'VIEW', entityType: 'Employee', entityId, newValue: { fields: ['bankAccountNumber','gcashNumber'] } }`.
5. **UI**: masked `font-mono` display + "Reveal" button (privileged roles only — cosmetic gate,
   the action re-checks). After reveal, full values swap into the display **and** edit-form
   prefills. Before reveal, edit inputs are empty with the masked value as placeholder; the
   update action treats empty-as-unchanged for these two fields (explicit clearing deferred —
   note in tasks).
6. Sweep other surfaces rendering these fields (payroll/employee lists) — mask or confirm absent.

Verification: unit (mask helper, empty-as-unchanged update), e2e (employee sees mask & no
button; HR reveals → full number + audit row exists; non-privileged POST to the action → 403).

## Slice B — Kanban stage-move notes + timeline (#52)

1. **Kanban** (`src/lib/components/recruitment/ApplicantKanban.svelte`): moving an applicant
   opens a small dialog — stage summary, optional note `<textarea>`, Confirm/Cancel — submitting
   the existing `?/advanceStage` form with a `notes` field. (Svelte 5 `$state`; mind the
   hydration gotcha from the verify skill.)
2. **Action** (`recruitment/[id]/+page.server.ts`): read `notes` from formData, pass to
   `advanceApplicant` (service already persists it).
3. **Timeline** (`recruitment/applicant/[applicantId]/`): include `stageHistory`
   (+ `changedBy` user email) in `getApplicant`; render a "Stage history" card — stage badge,
   actor, `formatShortDate`, note text.

Verification: unit (advanceApplicant persists notes — likely already covered; extend), e2e
(move card with note → note visible in applicant timeline).

## Slice C — Shared server-side pagination (#64)

**Mechanism** (build once):

- `paginate(url, defaults)` helper in `$lib/server/pagination.ts`: parses/clamps `?page=`
  (per-table param name configurable, e.g. `myPage`/`teamPage` where two tables share a page),
  returns `{ skip, take, page, pageSize }`; pair with `count()` → `{ rows, page, pageSize, total }`.
  Unit-tested (clamping, bad input, param names).
- `<Pagination>` component in `$lib/components`: prev/next + "X–Y of N", builds links from the
  **current** `$page.url` searchParams so existing filters (status, date range) survive page
  changes; hidden when `total <= pageSize`.
- URL contract: `?page=N` (1-based), default page size **20** (tune per page; audit-log may keep 50).

**Rollout** (one page = one task; each independently shippable):

| Page                               | Notes                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/timesheets`                      | Mine + team tables → independent params (`myPage`, `teamPage`) or paginate the single combined query if the split is client-side — resolve at task time. **Select-all/bulk-delete scope = current page** (ids rendered on the page). |
| `/leave`                           | Requests table; keep balances/types unpaginated. Same select-all scoping.                                                                                                                                                            |
| `/attendance`                      | Paginate the day-rows table; keep the summary header intact.                                                                                                                                                                         |
| `/payslips`                        | Straightforward `findMany` → skip/take + count.                                                                                                                                                                                      |
| `/requests`, `/requests/approvals` | Preserve status filters in links.                                                                                                                                                                                                    |
| `/reports/audit-log`               | Refactor existing hand-rolled pagination onto the shared helper/component.                                                                                                                                                           |
| `/employees`                       | Include existing search/filter params in page links.                                                                                                                                                                                 |
| `/recruitment`                     | Paginate the postings list; the Kanban board itself is not paginated.                                                                                                                                                                |

Acceptance (from issue): ≤ pageSize rows rendered; page + filters in URL, survive refresh/back;
visible "21–40 of 137"; exactly one count + one page query per load.

Verification: unit (helper), e2e (seed >20 rows on one page — navigate, filter + paginate
combined, back button restores page).

---

## Artifacts

- `data-model.md` — add `VIEW` to the `AuditAction` enum section (Slice A2). No other entity changes.
- `contracts/` — no API surface changes beyond the `?page=` URL contract documented above.
- Verification steps above serve as the quickstart additions; `quickstart.md` unchanged.

## Suggested sequencing

PR A (#53+#54) → PR B (#52) in parallel → PR C (#64) last (largest; rebases cleanly since it
touches load functions others don't). `/speckit-tasks` next to expand slices into tasks.
