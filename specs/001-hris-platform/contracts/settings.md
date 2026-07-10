# API Contract: Settings

**Base path**: `/api/v1/settings`
**Auth**: Bearer JWT required.

**Status**: Positions + org-chart + role-management service implemented (`src/lib/server/services/settings/org.ts`); pages `(app)/settings/org` and `(app)/settings/roles` are scaffolds; dedicated REST routes deferred.

---

## GET /api/v1/settings/positions

List positions in the org.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Response 200**: List of position objects `{ id, title, level, departmentId }`.

---

## POST /api/v1/settings/positions

Create a position.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**:
```json
{ "title": "string", "level": "string | null", "departmentId": "uuid | null" }
```

**Validation**: `title` required.

**Response 201**: Created position object.
**Error 409**: Duplicate — a position with this title already exists in the org.

---

## PATCH /api/v1/settings/positions/:id

Update a position.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**: Partial `{ title?, level?, departmentId? }`.

**Response 200**: Updated position object.

---

## GET /api/v1/settings/org-chart

Departments with their employees and reports-to links, for rendering an org chart.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Response 200**: `{ departments: [ { id, name, employees: [ { id, firstName, lastName, reportsToId } ] } ] }`.

---

## GET /api/v1/settings/users

Org users with role and linked employee name.

**Roles**: `SUPER_ADMIN`

**Response 200**: List of `{ id, email, role, employee: { id, firstName, lastName } | null }`.

---

## PATCH /api/v1/settings/users/:id/role

Set a user's role.

**Roles**: `SUPER_ADMIN`

**Request body**:
```json
{ "role": "EMPLOYEE | MANAGER | HR_ADMIN | SUPER_ADMIN" }
```

**Validation**: `role` ∈ `EMPLOYEE`, `MANAGER`, `HR_ADMIN`, `SUPER_ADMIN`; target user must be in the caller's org; a caller MUST NOT change their own role.

**Response 200**: `{ "id": "uuid", "role": "..." }`.
**Error 400**: Caller attempted to change their own role.
**Side effect**: AuditLog `UPDATE` entry with old/new role.
