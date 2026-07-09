<!--
SYNC IMPACT REPORT
==================
Version change: [TEMPLATE] → 1.0.0 (initial ratification)
Modified principles: N/A (first version)
Added sections:
  - Core Principles (5 principles)
  - Technology & Architecture Guidelines
  - Development Workflow
  - Governance
Templates reviewed:
  - .specify/templates/plan-template.md ✅ aligned (Constitution Check gate references these principles)
  - .specify/templates/spec-template.md ✅ aligned (FR- requirements must satisfy P1 Security)
  - .specify/templates/tasks-template.md ✅ aligned (security hardening + audit tasks in Polish phase)
Deferred TODOs:
  - None
-->

# Veent HRIS Constitution

## Core Principles

### I. Data Privacy & Security (NON-NEGOTIABLE)

Employee data is sensitive Personally Identifiable Information (PII). The system MUST treat
data protection as a first-class concern at every layer — storage, transit, and access.

- All PII MUST be encrypted at rest and in transit (TLS 1.2+ minimum).
- No raw passwords MUST be stored; only cryptographic hashes (bcrypt/argon2).
- Secrets and credentials MUST NEVER be committed to version control.
- Data access MUST be logged for audit purposes.
- Features touching PII MUST include a privacy impact assessment in the spec.

### II. Role-Based Access Control (NON-NEGOTIABLE)

The system MUST enforce strict, least-privilege access control. No user MUST ever access
data or functionality beyond their assigned role.

- Roles at minimum: `employee`, `manager`, `hr_admin`, `super_admin`.
- Every API endpoint and UI route MUST declare its required role(s).
- Authorization checks MUST happen server-side; client-side gating is cosmetic only.
- Role assignments MUST be auditable with a full change log.

### III. Spec-Driven Development

All features MUST be specified before implementation begins. Code without a corresponding
spec is not eligible for merge.

- The SDD workflow MUST be followed: specify → clarify → plan → tasks → implement.
- Specs MUST define acceptance scenarios in Given/When/Then format.
- Implementation MUST NOT begin until `/speckit-tasks` has produced a tasks.md.
- Deviations from the spec during implementation MUST update the spec, not just the code.

### IV. Audit Trail & Compliance

The system MUST maintain a complete, tamper-evident audit trail for all data mutations.
HR operations are subject to labor law and data protection regulations (e.g., DPDPA, GDPR
where applicable).

- Every CREATE, UPDATE, and DELETE on core HR entities MUST be recorded with:
  actor, timestamp, before-value, after-value.
- Audit logs MUST be immutable (append-only) and retained for a minimum of 3 years.
- Features involving payroll, leave, or benefits MUST note applicable compliance
  requirements in the spec.

### V. Test-First & Independent Deliverability

Tests MUST be written before implementation. Each user story MUST be independently
testable and deliverable as a working MVP increment.

- Red-Green-Refactor cycle is REQUIRED: tests MUST fail before implementation begins.
- Each user story in a spec MUST have at least one acceptance scenario that can be
  verified without other stories being complete.
- Integration tests MUST cover role-based access for every protected endpoint.

## Technology & Architecture Guidelines

The technology stack is not yet finalized (TBD at first `/speckit-plan` run). These
constraints MUST be respected regardless of stack choice:

- **API-First**: The system MUST expose a documented API before any UI is built.
- **Database**: A relational database MUST be used for HR data (referential integrity
  is required for entity relationships like employee ↔ department ↔ payroll).
- **Authentication**: A proven authentication mechanism MUST be used (OAuth2/JWT or
  equivalent); custom auth schemes are prohibited.
- **Environment config**: All environment-specific values (DB credentials, secret keys)
  MUST be loaded from environment variables or a secrets manager — never hardcoded.

## Development Workflow

- Feature branches MUST be created from `main` and named `###-short-description`.
- Every feature MUST have a corresponding spec under `specs/###-feature-name/spec.md`.
- PRs MUST NOT merge without: passing tests, spec alignment verification, and peer review.
- The constitution supersedes all other practices. Conflicts resolve in favor of this
  document.
- Constitution amendments MUST be proposed as a PR with rationale, reviewed by at least
  one team member, and result in a version increment per the Governance rules below.

## Governance

This constitution governs all development on the Veent HRIS project.

- **Amendment procedure**: Open a PR modifying this file → document rationale →
  require at least one approving review → merge and increment version.
- **Versioning policy**:
  - MAJOR: backward-incompatible principle removals or redefinitions.
  - MINOR: new principle or section added.
  - PATCH: wording clarifications, typo fixes, non-semantic refinements.
- **Compliance review**: Every `/speckit-plan` run MUST include a Constitution Check
  gate. Plans that fail the gate MUST be revised before implementation.
- **Enforcement**: PRs that violate any principle MUST be blocked until resolved.
  Use the Complexity Tracking table in `plan.md` to formally justify any necessary
  deviation.

**Version**: 1.0.0 | **Ratified**: 2026-07-09 | **Last Amended**: 2026-07-09
