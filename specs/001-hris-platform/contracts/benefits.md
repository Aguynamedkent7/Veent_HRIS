# API Contract: Benefits

**Base path**: `/api/v1/benefits`
**Auth**: Session cookie (Lucia).
**Status**: service layer implemented (`src/lib/server/services/benefits.ts`); page UI + REST routes deferred (tracked in tasks.md Phase 10).

All mutations write an AuditLog entry. Costs (`employeeCost`, `employerCost`) are PHP Decimals.

---

## GET /api/v1/benefits/plans

List benefit plans for the current org.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Response 200**: List of benefit plan objects.

---

## POST /api/v1/benefits/plans

Create a benefit plan.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**:

```json
{
	"name": "string",
	"type": "HMO | INSURANCE | RETIREMENT | ALLOWANCE | LEAVE_CREDIT | OTHER",
	"provider": "string | null",
	"description": "string | null",
	"employeeCost": "0.00 | null",
	"employerCost": "0.00 | null"
}
```

**Validation**: `name` required; `type` ∈ `HMO`|`INSURANCE`|`RETIREMENT`|`ALLOWANCE`|`LEAVE_CREDIT`|`OTHER`; costs ≥ 0.

**Response 201**: Created benefit plan object.
**Error 400**: Invalid `type` or negative cost.
**Side effect**: AuditLog `CREATE` entry.

---

## PATCH /api/v1/benefits/plans/:id

Update a benefit plan.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**: Partial of the create body (`name`, `type`, `provider`, `description`, `employeeCost`, `employerCost`).

**Response 200**: Updated benefit plan object.
**Error 404**: Plan not found in org.
**Side effect**: AuditLog `UPDATE` entry.

---

## GET /api/v1/benefits/enrollments

List an employee's benefit enrollments.

**Roles**: Owner employee, or `HR_ADMIN`/`SUPER_ADMIN`.

**Query params**: `employeeId` _(required)_

**Response 200**: List of enrollment objects.
**Error 403**: Non-owner without HR role.

---

## POST /api/v1/benefits/enrollments

Enroll an employee in a benefit plan.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**:

```json
{
	"employeeId": "uuid",
	"benefitPlanId": "uuid",
	"coverageLevel": "string | null",
	"effectiveDate": "2025-07-07"
}
```

**Validation**: `employeeId`, `benefitPlanId`, `effectiveDate` required.

**Response 201**: Enrollment object with `status: ACTIVE`.
**Error 409**: Duplicate — employee already enrolled in this plan (unique `employeeId`+`benefitPlanId`).
**Side effect**: AuditLog `CREATE` entry.

---

## PATCH /api/v1/benefits/enrollments/:id

Change an enrollment's status.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**: `{ "status": "ACTIVE | WAIVED | TERMINATED" }`

**Validation**: `status` ∈ `ACTIVE`|`WAIVED`|`TERMINATED`.

**Response 200**: Updated enrollment object.
**Error 404**: Enrollment not found.
**Side effect**: AuditLog `UPDATE` entry.
