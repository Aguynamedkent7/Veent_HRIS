# Implementation Plan (Addendum): CI — Automated Quality Gates

**Branch**: `001-hris-platform` | **Date**: 2026-07-14 | **Spec**: Constitution §V + Development Workflow
**Parent plan**: [plan.md](./plan.md) — scoped addendum for CI/testing infrastructure; does not replace plan.md.

## Summary

The repo already carries a real test suite (15 Vitest unit files, 6 Playwright e2e specs), Prettier +
ESLint config, and `svelte-check` typing — but **nothing runs them automatically**: `.github/workflows/`
does not exist, so the Constitution's "PRs MUST NOT merge without passing tests" (Development Workflow) and
Principle V (Test-First) are enforced only by hand. This plan adds a **GitHub Actions CI workflow** that,
on every push/PR, runs the existing checks as merge gates: **format check → lint → typecheck → unit tests**
(fast, DB-free) and **API/e2e tests** (Playwright against the app backed by an ephemeral Postgres 16).

No product code changes. This is tooling: one workflow file, two new `package.json` scripts, and a small
CI env template. It closes the gap between the tests we have and the tests we actually run.

## Technical Context

**Language/Deps**: unchanged (TS 5, SvelteKit 2, Prisma 5, Vitest, Playwright). No new runtime deps.
**Package manager**: pnpm **10.33.0** (pinned via `packageManager` in package.json → use `pnpm/action-setup`).
**Existing scripts**: `test` (`vitest run`), `test:e2e` (`playwright test`), `lint` (`eslint .`),
`format` (`prettier --write .`), `db:seed` (`tsx prisma/seed.ts`), `db:push` (`prisma db push`).
**Test layers & their needs**:

- **Format** — `prettier --check .` (new script `format:check`; today's `format` mutates files, unusable as a gate).
- **Lint** — `eslint .` via `pnpm lint` (`eslint.config.js`, flat config).
- **Typecheck** — `svelte-kit sync && svelte-check` (new script `check`; requires a generated Prisma client).
- **Unit** — `vitest run`; `environment: node`, **confirmed DB-free** (no `tests/unit/**` imports `PrismaClient`/`server/db`). Runs with no services.
- **E2E/API** — `playwright test`; Playwright's `webServer` boots `pnpm dev` on :5173 and honors `process.env.CI` (retries=2, workers=1, `forbidOnly`). `global-setup.ts` requires the seed to have run (`employee@veent.ph` must exist). Needs **Postgres + prisma db push + seed + browser**.

**CI runtime prerequisites** (from `.env.example` + code env refs `TIMELOG_API_SECRET`, `NODE_ENV`, `UPLOAD_DIR`):
`DATABASE_URL`, `LUCIA_SECRET`, `TIMELOG_API_SECRET`, `NODE_ENV`. All are **dummy/ephemeral** for CI (throwaway
Postgres service) — **no repository secrets required**, which keeps Principle I clean.
**Prisma**: CI must run `prisma generate` (client) before typecheck/build/test, and `prisma db push` before e2e.

## Constitution Check

| Principle                                               | Effect                                                                            | Verdict                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------- |
| V — Test-First & Independent Deliverability             | CI runs the suite as a merge gate; integration/e2e cover RBAC-protected endpoints | ✅ Directly advances             |
| Development Workflow ("no merge without passing tests") | Operationalized via required status checks                                        | ✅ Directly advances             |
| I — Data Privacy & Security (secrets never committed)   | CI uses ephemeral Postgres + dummy env; no real secrets in YAML or repo           | ✅ Compliant (design constraint) |
| III — Spec-Driven Development                           | This addendum is the spec/plan for the change                                     | ✅ Compliant                     |

**Gate: PASS.** No violations; no Complexity Tracking entries needed.

## Key Decisions (Phase 0 — Research)

- **D1 — One workflow, two jobs, run in parallel.**
  `quality` (format/lint/typecheck/unit — no services, ~1–2 min) and `e2e` (Postgres + Playwright, slower).
  Parallel jobs give fast feedback on the cheap checks without waiting on browser tests.
  _Alternative rejected_: a single sequential job — slower feedback, and a lint failure would needlessly
  spin up Postgres.
- **D2 — Postgres as a GitHub Actions service container**, `postgres:16`, health-checked, on an ephemeral
  DB. Schema applied with `prisma db push` (matches local `db:migrate`/`db:push`; the repo has no migration
  history dir, so `db push` is the correct provisioning path), then `pnpm db:seed`.
  _Alternative rejected_: Dockerized compose or Neon branch — heavier / introduces external dependency & secrets.
- **D3 — Let Playwright own the app server.** `playwright.config.ts` already starts `pnpm dev` via `webServer`
  and disables `reuseExistingServer` under CI. CI just sets env + seeds; no separate "start server" step.
  _Alternative rejected_: build + `vite preview` — closer to prod but `webServer` is wired to `pnpm dev`;
  revisit only if dev-mode flakiness appears.
- **D4 — Add `format:check` and `check` scripts** rather than inlining raw commands in YAML, so the same
  gates are runnable locally (`pnpm format:check`, `pnpm check`) and CI stays a thin wrapper.
- **D5 — Trigger on `push` and `pull_request`; concurrency-cancel superseded runs.** Cancel in-progress runs
  per ref (`concurrency: group=ci-${{ github.ref }}, cancel-in-progress: true`) to save minutes on rapid pushes.
- **D6 — Cache pnpm store** keyed on `pnpm-lock.yaml`; `playwright install --with-deps chromium` (chromium
  only — config defines a single chromium project). Upload the Playwright HTML report as an artifact on failure.
- **D7 — Approve Prisma's build script.** pnpm 10 blocks postinstall scripts by default; the repo already
  tracks `.pnpm-build-allow.json`. CI installs with `--frozen-lockfile`; run `prisma generate` explicitly so
  client generation never depends on postinstall being allowed.

## Design

**Artifacts to add**

- `.github/workflows/ci.yml` — the workflow (jobs `quality`, `e2e`).
- `package.json` scripts: `"format:check": "prettier --check ."`, `"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"`.
- (Optional) `.github/workflows/README.md` — one-paragraph "what runs and why", + how to reproduce e2e locally.

**No** `data-model.md` / `contracts/` changes — CI is internal tooling, exposes no new entities or API surface
(per plan workflow: skip contracts for purely-internal changes).

### `quality` job (ubuntu-latest, no services)

1. checkout → `pnpm/action-setup@v4` (reads pinned 10.33.0) → `actions/setup-node@v4` (node 20, `cache: pnpm`)
2. `pnpm install --frozen-lockfile`
3. `pnpm exec prisma generate` (typecheck needs the client types)
4. `pnpm format:check`
5. `pnpm lint`
6. `pnpm check`
7. `pnpm test` _(unit — DB-free)_

### `e2e` job (ubuntu-latest, `services.postgres: postgres:16`)

- env: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/veent_ci`, `LUCIA_SECRET`/`TIMELOG_API_SECRET`
  = fixed CI dummies, `NODE_ENV=test`, `CI=true`.

1. checkout → pnpm/node setup → `pnpm install --frozen-lockfile`
2. `pnpm exec prisma generate`
3. `pnpm exec prisma db push` (provision schema on the ephemeral DB)
4. `pnpm db:seed` (satisfies `global-setup.ts` — `employee@veent.ph`)
5. `pnpm exec playwright install --with-deps chromium`
6. `pnpm test:e2e` (Playwright boots `pnpm dev` itself)
7. on failure: `actions/upload-artifact@v4` with `playwright-report/`

### Branch protection (manual follow-up, documented in the README)

Mark `quality` and `e2e` as **required status checks** on `main` so the Constitution's merge rule is enforced
by the platform, not convention.

## Risks / Open Items

- **R1 — e2e flakiness in dev mode.** Mitigated by config's CI retries=2 / workers=1. If it persists, switch
  D3 to build + `vite preview` (needs a `webServer.command` tweak).
- **R2 — Seed/global-setup coupling.** `global-setup.ts` throws if the seed hasn't run; the job order (seed
  before `test:e2e`) covers it. Keep seed idempotent (already is).
- **R3 — Unit tests assumed DB-free.** Verified by grep now; if a future unit test imports the DB, either mock
  it or move it under an integration project so the `quality` job stays serviceless.
- **R4 — First green run.** Existing files may not currently pass `prettier --check`/`eslint`/`svelte-check`
  (we saw a long-line Prettier warning in `seed.ts` and pre-existing `svelte-check` errors). Expect a
  one-time cleanup pass so the initial CI run is green — captured as tasks below.

## Tasks Preview (for `/speckit-tasks`)

1. Add `format:check` + `check` scripts to `package.json`.
2. Baseline cleanup so gates pass: `pnpm format:check` (fix long lines etc.), `pnpm lint`, `pnpm check`
   (resolve the pre-existing `svelte-check` errors, e.g. `timesheets/new` Entry.notes typing).
3. Author `.github/workflows/ci.yml` — `quality` job.
4. Extend `ci.yml` — `e2e` job with Postgres service + seed + Playwright.
5. Add pnpm store cache + concurrency-cancel + failure artifact upload.
6. Add `.github/workflows/README.md` (what runs, how to reproduce e2e locally) and document required status
   checks on `main`.
7. Verify: push a branch, confirm both jobs go green; intentionally break format/a test to confirm the gate fails.
