# Research: Veent HRIS Core Platform

**Date**: 2026-07-09
**Feature**: [spec.md](./spec.md)

---

## 1. Technology Stack

### Decision: SvelteKit Full-Stack (Single Project, TypeScript + PostgreSQL)

**Framework**
- **Decision**: SvelteKit 2 + Svelte 5 (Node.js 20 LTS, TypeScript 5, Vite 5)
- **Rationale**: SvelteKit is a full-stack framework — a single project serves both the UI
  (`+page.svelte`) and server-side logic (`+page.server.ts` form actions, `+server.ts` API
  route handlers). No separate backend process means one codebase, one deployment, simpler
  local dev (`npm run dev`). Svelte 5's runes-based reactivity keeps UI components lean and
  fast without a virtual DOM. TypeScript throughout ensures type safety for payroll logic.
- **Alternatives considered**:
  - *NestJS + Next.js (original plan)*: Two separate projects, two dev servers, more ops
    overhead. Powerful but over-engineered for a single-company HRIS.
  - *SvelteKit + separate NestJS API*: Middle ground but still two processes; no clear benefit
    over full SvelteKit for this scope.

**UI Components**
- **Decision**: shadcn-svelte + Tailwind CSS v3
- **Rationale**: shadcn-svelte is a direct port of shadcn/ui for Svelte — copy-paste
  accessible components (tables, forms, dialogs, dropdowns) that are owned by the project,
  not a library dependency. Ideal for data-heavy HRIS views. Tailwind keeps styling
  consistent and utility-first.
- **Alternatives considered**:
  - *Skeleton UI*: Svelte-native, good theming, but more opinionated design.
  - *Flowbite-svelte*: Well-documented but heavier dependency.

**ORM**
- **Decision**: Prisma 5
- **Rationale**: Type-safe schema-first ORM. Schema file is the single source of truth for
  all 15 HRIS entities + Lucia session models. Migration tooling is robust. Prisma middleware
  can be used for audit log consistency.
- **Alternatives considered**:
  - *Drizzle*: SQL-first, faster queries, growing in Svelte ecosystem — worth revisiting in v2.
  - *TypeORM*: Decorator-heavy; schema drift harder to detect.

**Database**
- **Decision**: PostgreSQL 16
- **Rationale**: Required by constitution (relational integrity for HR entities). Strong JSON
  support for audit log `oldValue`/`newValue` payloads. Robust transaction support for
  payroll runs. Lucia sessions stored here via Prisma adapter (no separate session store).
- **Alternatives considered**: MySQL 8 — comparable, but PostgreSQL has better JSON support
  and is the default for the Prisma/SvelteKit ecosystem.

**Caching**
- **Decision**: Redis 7 (dashboard metrics cache only, 5-min TTL per FR-025)
- **Rationale**: Dashboard aggregates (headcount, pending approvals, etc.) are expensive to
  recompute on every page load. Redis provides fast key-value caching. Auth sessions are
  stored in PostgreSQL via Lucia — Redis is not needed for auth.

**Authentication**
- **Decision**: Lucia v3 with `@lucia-auth/adapter-prisma`
- **Rationale**: Lucia is purpose-built for SvelteKit. It manages server-side sessions stored
  in PostgreSQL (via the Prisma adapter), handles cookie lifecycle, and integrates natively
  with `hooks.server.ts`. Passwords hashed with bcrypt (cost factor 12) per Constitution
  Principle I. No JWTs to manage, rotate, or blacklist.
- **Session flow**: Login form action creates session → Lucia sets `auth_session` cookie →
  `hooks.server.ts` validates session on every request → `locals.user` + `locals.session`
  populated for downstream use.
- **Alternatives considered**:
  - *JWT (original plan)*: Stateless but requires refresh token rotation and blacklisting.
    Session-based via Lucia is simpler and more secure for a server-rendered app.
  - *Auth.js*: Supports SvelteKit but better suited when OAuth providers are needed.

**Testing**
- **Decision**: Vitest (unit + integration), Playwright (E2E), Svelte Testing Library
- **Rationale**: Vitest is native to the Vite/SvelteKit ecosystem — no Jest config needed.
  Playwright is unchanged from original plan (cross-browser E2E). Svelte Testing Library
  mirrors the React Testing Library API for component tests.
- **Alternatives considered**: Jest + Supertest (original plan) — works but requires
  additional Vite transform config; Vitest is the idiomatic choice here.

---

## 2. Philippines Statutory Payroll Computations

### 2.1 SSS (Social Security System)

- **Contribution basis**: Monthly Basic Salary (MSC — Monthly Salary Credit)
- **MSC range**: PHP 4,000 (minimum) to PHP 30,000 (maximum) as of 2025
- **Employee share**: 4.5% of MSC
- **Employer share**: 9.5% of MSC + 1% EC (Employees' Compensation) for MSC ≥ PHP 14,750
- **Contribution table**: Stepped per SSS table; lookup by MSC bracket
- **Implementation**: Store SSS contribution table as configurable data (updated when SSS
  revises rates); payroll engine does table lookup, not formula, to match official schedules.

### 2.2 PhilHealth (Philippine Health Insurance Corporation)

- **Contribution basis**: Basic Monthly Salary
- **Rate**: 5% of basic salary (employee 2.5% + employer 2.5%) as of 2024–2025
- **Floor**: PHP 500 per month (applied when salary is very low)
- **Ceiling**: Based on income bracket (currently PHP 5,000/month max contribution for
  salaries ≥ PHP 100,000)
- **Implementation**: `philhealth = min(max(salary * 0.025, 250), 2500)` for employee share.
  Subject to update — stored as configurable rate, not hardcoded constant.

### 2.3 Pag-IBIG (HDMF — Home Development Mutual Fund)

- **Contribution basis**: Basic Monthly Salary
- **Rate**:
  - Salary ≤ PHP 1,500: Employee 1%, Employer 2%
  - Salary > PHP 1,500: Employee 2%, Employer 2%
- **Maximum monthly employee contribution**: PHP 100 (on salary ≤ PHP 5,000 basis)
- **Implementation**: `pagibig_ee = min(salary * 0.02, 100)` for most employees.

### 2.4 BIR Withholding Tax (TRAIN Law — RA 10963, effective 2023 onwards)

**Tax table (annual):**

| Annual Taxable Income (PHP) | Tax |
|-----------------------------|-----|
| 0 – 250,000 | 0% |
| 250,001 – 400,000 | 15% of excess over 250,000 |
| 400,001 – 800,000 | PHP 22,500 + 20% of excess over 400,000 |
| 800,001 – 2,000,000 | PHP 102,500 + 25% of excess over 800,000 |
| 2,000,001 – 8,000,000 | PHP 402,500 + 30% of excess over 2,000,000 |
| Over 8,000,000 | PHP 2,202,500 + 35% of excess over 8,000,000 |

**Monthly withholding computation:**
1. Compute monthly taxable income = gross pay − mandatory deductions (SSS EE + PhilHealth EE + Pag-IBIG EE)
2. Annualize: taxable_annual = taxable_monthly × 12
3. Apply TRAIN tax table to get annual_tax
4. Monthly withholding = annual_tax / 12

**Implementation**: Store tax brackets as configurable table. Payroll engine annualizes
monthly income, applies bracket lookup, divides by 12. HR Admin can update brackets
when BIR issues new schedules without code changes.

### 2.5 Net Pay Formula

```
gross_pay         = (hourly_rate × hours_worked) OR monthly_rate
sss_ee            = SSS table lookup (employee share)
philhealth_ee     = min(max(basic × 0.025, 250), 2500)
pagibig_ee        = min(basic × 0.02, 100)
taxable_income    = gross_pay − sss_ee − philhealth_ee − pagibig_ee
withholding_tax   = BIR bracket computation on taxable_income
total_deductions  = sss_ee + philhealth_ee + pagibig_ee + withholding_tax
net_pay           = gross_pay − total_deductions
```

---

## 3. RBAC Implementation Approach

- **Decision**: `src/lib/server/rbac.ts` exports a `requireRole(...roles: Role[])` helper
- **Role hierarchy**: `SUPER_ADMIN` > `HR_ADMIN` > `MANAGER` > `EMPLOYEE`
- `hooks.server.ts` validates the Lucia session and attaches `locals.user` (includes `role`)
  on every request — no database call beyond the session lookup
- Each `+page.server.ts` load function and `+server.ts` handler calls `requireRole()` at
  the top, throwing a 403 redirect/error if `locals.user.role` is not in the allowed set
- Ownership checks (employee can only see own data) enforced inside service functions in
  `src/lib/server/services/`, not at the route layer

---

## 4. Audit Logging Approach

- **Decision**: `src/lib/server/audit.ts` exports a `writeAuditLog(entry)` helper function
- Called explicitly inside each service function after a successful mutation (no framework
  interceptor available in SvelteKit — explicit call pattern used instead)
- Captures: `actorId`, `actorRole`, `action`, `entityType`, `entityId`, `oldValue`,
  `newValue`, `ipAddress`, `userAgent`, `createdAt`
- Written via a separate Prisma client call outside the mutation transaction — ensures the
  log is persisted even if the business transaction is rolled back for other reasons
- No `+server.ts` route or form action exposes DELETE or UPDATE on the `AuditLog` table
- Database-level: application DB user has only INSERT + SELECT on `audit_logs` table;
  DELETE and UPDATE are revoked at the PostgreSQL role level

---

## 5. Architecture Patterns

- **Repository pattern**: NOT used — direct Prisma calls inside service files in
  `src/lib/server/services/` to avoid unnecessary abstraction (constitution Principle V)
- **Module structure**: Each domain (employees, payroll, etc.) has a service file in
  `src/lib/server/services/` containing business logic, and corresponding route files
  (`+page.server.ts` or `+server.ts`) that handle HTTP concerns and call into services
- **Error handling**: SvelteKit `error()` and `redirect()` helpers used in route files;
  service functions throw typed domain errors caught at the route layer; API routes return
  RFC 7807 `application/problem+json` responses for programmatic clients
- **File uploads**: CV/resume in recruitment stored on local filesystem (`static/uploads/`)
  in v1 via SvelteKit's built-in file handling; S3/object storage deferred to v2
- **Deployment**: `@sveltejs/adapter-node` produces a standalone Node.js server;
  single process serves both pages and API routes
