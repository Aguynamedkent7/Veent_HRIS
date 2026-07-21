# API Contract: Performance

**Base path**: `/api/v1/performance`
**Auth**: Session cookie (Lucia).
**Status**: service layer implemented (`src/lib/server/services/performance.ts`); page UI at `(app)/performance` is a scaffold, richer REST routes deferred.

All mutations write an AuditLog entry.

---

## GET /api/v1/performance/cycles

List review cycles for the org.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Response 200**: List of review cycle objects.

---

## POST /api/v1/performance/cycles

Create a review cycle.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**:

```json
{
	"name": "string",
	"startDate": "2025-07-01",
	"endDate": "2025-12-31"
}
```

**Validation**: `name` required; `endDate` ≥ `startDate`.

**Response 201**: Cycle object with `status: DRAFT`.
**Side effect**: AuditLog `CREATE` entry.

---

## GET /api/v1/performance/reviews

List performance reviews.

**Roles**:

- `EMPLOYEE`: own reviews (as subject)
- `MANAGER`: reviews assigned to them (as reviewer)
- `HR_ADMIN`/`SUPER_ADMIN`: all reviews

**Query params**: `employeeId`, `reviewerId`

**Response 200**: List of review summary objects.

---

## GET /api/v1/performance/reviews/:id

Get review detail.

**Roles**: Subject employee, assigned reviewer, `HR_ADMIN`, `SUPER_ADMIN`.

**Response 200**: Full review object.
**Error 403**: Not subject, reviewer, or HR.

---

## POST /api/v1/performance/reviews/:id/self-assessment

Subject saves their self-assessment.

**Roles**: Subject employee only.

**Request body**: `{ "selfAssessment": "string" }`

**Response 200**: Review object with `status: SELF_ASSESSMENT`.
**Error 403**: Not the review subject.
**Side effect**: AuditLog `UPDATE` entry.

---

## POST /api/v1/performance/reviews/:id/manager-review

Assigned reviewer saves their review.

**Roles**: Assigned reviewer only.

**Request body**:

```json
{
	"managerComments": "string",
	"overallRating": 4
}
```

**Validation**: `overallRating` 1–5.

**Response 200**: Review object with `status: COMPLETED`.
**Error 403**: Not the assigned reviewer.
**Side effect**: AuditLog `UPDATE` entry.

---

## GET /api/v1/performance/goals

List an employee's goals.

**Roles**: Owner employee or their manager.

**Query params**: `employeeId`

**Response 200**: List of goal objects.

---

## POST /api/v1/performance/goals

Create a goal for the current employee.

**Roles**: Self (goal owner).

**Request body**:

```json
{
	"title": "string",
	"description": "string | null",
	"category": "string | null",
	"targetDate": "2025-12-31 | null"
}
```

**Validation**: `title` required.

**Response 201**: Goal object with `status: DRAFT`, `progress: 0`.
**Side effect**: AuditLog `CREATE` entry.

---

## PATCH /api/v1/performance/goals/:id

Update a goal's progress and status.

**Roles**: Owner employee only.

**Request body**:

```json
{
	"progress": 50,
	"status": "DRAFT | ACTIVE | COMPLETED | CANCELLED"
}
```

**Validation**: `progress` 0–100; `status` ∈ `DRAFT`|`ACTIVE`|`COMPLETED`|`CANCELLED`.

**Response 200**: Updated goal object.
**Error 403**: Not the goal owner.
**Side effect**: AuditLog `UPDATE` entry.
