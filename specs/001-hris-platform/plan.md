# Implementation Plan: Veent HRIS Core Platform

**Branch**: `001-hris-platform` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-hris-platform/spec.md`

## Summary

Veent HRIS is a single-company, web-based Human Resources Information System for a Philippine
organization. It covers employee lifecycle management, timesheets, leave, payroll (with PH
statutory deductions — SSS, PhilHealth, Pag-IBIG, BIR), dashboards, reports, and recruitment.
The system is built as a SvelteKit 2 full-stack application — one project serving both the
Svelte UI and server-side logic via route handlers and form actions, backed by PostgreSQL,
with Lucia v3 session auth, strict RBAC, and an immutable audit log.

## Technical Context

**Language/Version**: TypeScript 5.x — Node.js 20 LTS

**Primary Dependencies**:
- Framework: SvelteKit 2, Svelte 5, Vite 5
- ORM: Prisma 5
- Auth: Lucia v3 + @lucia-auth/adapter-prisma
- UI: Tailwind CSS v3, shadcn-svelte
- Charts: layerchart (Svelte-native, built on D3)
- Validation: zod (schema validation in server actions)

**Storage**: PostgreSQL 16 — relational integrity required for HR entities (employee ↔ department
↔ payroll ↔ leave); Lucia sessions stored in PostgreSQL via Prisma adapter; Redis 7 for
dashboard metric caching only (max 5-min stale, per FR-025)

**Testing**: Vitest (unit + integration), Playwright (E2E), Svelte Testing Library (component)

**Target Platform**: Desktop web (Chrome, Firefox, Edge latest 2 versions); Linux server via
`@sveltejs/adapter-node`; mobile is out of scope for v1

**Project Type**: Full-stack web application (REST API backend + React frontend)

**Performance Goals**:
- Page load: <2s for all dashboard and list views
- Payroll run computation: <30 min for 200 employees (SC-004)
- Report generation: <60s for 12 months of data (SC-005)
- Dashboard data: max 5-min cache age (FR-025)

**Constraints**:
- Single company, single PostgreSQL database, no multi-tenancy
- Payroll statutory rules: Philippines (SSS, PhilHealth, Pag-IBIG, BIR TRAIN law)
- Audit logs: immutable, 3-year retention minimum
- Secrets: loaded from environment variables only (never hardcoded)
- No external accounting/ERP integrations in v1

**Scale/Scope**: Up to ~500 employees; single organization; 4 roles; 6 core modules

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Gate Question | Status |
|-----------|--------------|--------|
| I. Data Privacy & Security | Are passwords hashed (bcrypt)? PII encrypted in transit (HTTPS)? Secrets in env vars? Access logged? | ✅ PASS — bcrypt via Lucia v3, TLS at deployment, all config via `.env`, audit log covers access |
| II. Role-Based Access Control | Are all 4 roles defined? Is enforcement server-side? Are role changes audited? | ✅ PASS — `requireRole()` helper in `hooks.server.ts` + each route handler; role changes in AuditLog |
| III. Spec-Driven Development | Is there a complete, validated spec before planning? | ✅ PASS — spec.md complete, all 14 checklist items passing |
| IV. Audit Trail & Compliance | Are all entity mutations logged with actor/timestamp/before/after? Are logs immutable and retained 3 years? | ✅ PASS — `writeAuditLog()` called in every service mutation; no DELETE/UPDATE route on AuditLog; DB-level revoke |
| V. Test-First & Deliverability | Is each user story independently testable? Are tests written before implementation? | ✅ PASS — 6 stories with independent checkpoints; TDD enforced in tasks.md |

**Post-design re-check**: No new violations introduced. RBAC enforcement is server-side via
SvelteKit `hooks.server.ts` and explicit `requireRole()` calls. Audit log has no mutable
routes exposed in any contract file.

## Project Structure

### Documentation (this feature)

```text
specs/001-hris-platform/
├── plan.md              # This file
├── research.md          # Phase 0 — stack & PH payroll decisions
├── data-model.md        # Phase 1 — entity schema
├── quickstart.md        # Phase 1 — validation guide
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── contracts/           # Phase 1 — REST API contracts
    ├── auth.md
    ├── employees.md
    ├── timesheets.md
    ├── leave.md
    ├── payroll.md
    ├── recruitment.md
    └── reports.md
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── server/                      # Server-only code (never bundled to client)
│   │   ├── auth.ts                  # Lucia instance + session cookie helpers
│   │   ├── db.ts                    # Prisma client singleton
│   │   ├── audit.ts                 # writeAuditLog() helper
│   │   ├── rbac.ts                  # requireRole(...roles) guard helper
│   │   └── services/
│   │       ├── employees.ts
│   │       ├── timesheets.ts
│   │       ├── leave.ts
│   │       ├── payroll/
│   │       │   ├── index.ts         # Payroll run orchestration
│   │       │   └── ph-statutory.ts  # SSS / PhilHealth / Pag-IBIG / BIR
│   │       ├── recruitment.ts
│   │       ├── reports.ts
│   │       └── dashboard.ts
│   ├── components/                  # Shared Svelte components (shadcn-svelte)
│   └── utils/                       # Shared pure utilities (dates, formatting)
├── routes/
│   ├── (auth)/
│   │   └── login/
│   │       ├── +page.svelte         # Login form
│   │       └── +page.server.ts      # Form action: bcrypt verify → Lucia session
│   ├── (app)/                       # All protected routes
│   │   ├── +layout.server.ts        # Auth gate: redirect → /login if no session
│   │   ├── dashboard/
│   │   │   ├── +page.svelte
│   │   │   └── +page.server.ts      # load(): role-aware metrics (Redis cache)
│   │   ├── employees/
│   │   ├── timesheets/
│   │   ├── leave/
│   │   ├── payroll/
│   │   ├── recruitment/
│   │   └── reports/
│   └── api/
│       └── v1/                      # REST endpoints (CSV export, programmatic access)
│           ├── employees/+server.ts
│           ├── timesheets/+server.ts
│           ├── leave/+server.ts
│           ├── payroll/+server.ts
│           ├── recruitment/+server.ts
│           └── reports/+server.ts
├── hooks.server.ts                  # Lucia session validation on every request
├── app.d.ts                         # Locals type: { user, session }
└── app.html

prisma/
├── schema.prisma                    # All 15 HR entities + Lucia Session/User models
└── migrations/

tests/
├── e2e/                             # Playwright
└── unit/                            # Vitest
```

**Structure Decision**: Single SvelteKit project. Pages and form actions handle the UI and
primary mutations. `src/routes/api/v1/` exposes the same operations as REST endpoints for
CSV exports and any programmatic consumers. Business logic lives exclusively in
`src/lib/server/services/` — routes are thin, services are testable.

## Complexity Tracking

> No Constitution Check violations — this section is informational only.

No complexity justifications required. All architectural choices align with constitution
principles. No extra projects, patterns, or abstractions beyond what is needed.

## Addendum — Phase 10 Expansion (Benefits, Performance, Settings/Org, Discord Time Tracking)

**Date**: 2026-07-10. Extends this feature; see spec.md FR-034–FR-046, data-model.md
"Expansion Entities", contracts `benefits.md` / `performance.md` / `settings.md` / `timelog.md`,
and tasks.md Phase 10.

**Corrections to the original plan**: Redis was removed (dashboards query the DB directly);
the frontend is **Svelte**, not React (line 37 is a template typo).

**New models**: `TimeLog`, `BenefitPlan`, `BenefitEnrollment`, `ReviewCycle`, `PerformanceReview`,
`Goal`, `Position`, plus `Employee.discordId`/`positionId`.

**New source layout**:
- `src/lib/server/services/{benefits,performance,timelog}.ts`, `services/settings/org.ts`
- `src/lib/server/hmac.ts` (HMAC sign/verify), Manila UTC+8 helpers in `src/lib/utils/dates.ts`
- `src/routes/(app)/{benefits,performance}/`, `(app)/settings/{org,roles}/`
- `src/routes/api/v1/timesheets/log/+server.ts` (HMAC-authed punch ingestion)
- `scripts/discord-bot.ts` + `scripts/README.md` (standalone `discord.js` bot)

**Integration decisions**:
- **Discord bot → API auth**: HMAC-SHA256 over `${timestamp}.${rawBody}` with `TIMELOG_API_SECRET`
  and a ±5-min replay window (not Lucia sessions — it is server-to-server).
- **Timezone**: punches stored UTC (`timestamptz`); all day/week bucketing in PHT (UTC+8, no DST).
- **Timesheet reuse**: raw `TimeLog` punches aggregate into the existing DRAFT→SUBMITTED→APPROVED
  `Timesheet` workflow, so payroll is unchanged.

**Delivery**: this pass shipped the foundation (schema, docs, integration code + tests, service
layers, route scaffolds). Rich page UIs and per-module REST routes are deferred (tasks T137–T160).

### Constitution re-check (Phase 10)

| Principle | Status |
|-----------|--------|
| I. Data Privacy & Security | ✅ Secret in env (`TIMELOG_API_SECRET`), HMAC + replay guard; Decimal transport hook. ⚠️ Add a PIA note for health/benefit + review PII (spec follow-up). |
| II. RBAC | ✅ Every new endpoint/route declares roles; role changes audited (FR-042); self-role-change blocked. |
| III. Spec-Driven | ✅ spec/data-model/contracts/tasks updated for FR-034–FR-046. |
| IV. Audit Trail | ✅ Every new service mutation calls `writeAuditLog`. ⚠️ Note benefits compliance (DPA) in spec (follow-up). |
| V. Test-First & Deliverability | ✅ Unit tests for HMAC + aggregation. ⚠️ RBAC integration tests for deferred REST routes tracked as T142. |
