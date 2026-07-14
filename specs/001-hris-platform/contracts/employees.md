# API Contract: Employees & Departments

**Base path**: `/api/v1`
**Auth**: Bearer JWT required for all endpoints.

---

## Employees

### GET /api/v1/employees

List employees (paginated, filterable).

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`, `MANAGER` (sees direct reports only)

**Query params**: `page`, `limit`, `departmentId`, `status` (ACTIVE|OFFBOARDED), `search` (name/employeeNumber)

**Response 200**:

```json
{
	"data": [
		{
			"id": "uuid",
			"employeeNumber": "EMP-0001",
			"firstName": "string",
			"lastName": "string",
			"jobTitle": "string",
			"department": { "id": "uuid", "name": "string" },
			"employmentStatus": "ACTIVE",
			"employmentType": "FULL_TIME",
			"startDate": "2025-01-01"
		}
	],
	"total": 0,
	"page": 1,
	"limit": 20
}
```

---

### POST /api/v1/employees

Create a new employee (and linked User account).

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**:

```json
{
	"firstName": "string",
	"lastName": "string",
	"middleName": "string | null",
	"email": "string",
	"departmentId": "uuid",
	"jobTitle": "string",
	"employmentType": "FULL_TIME | PART_TIME | CONTRACTUAL | PROBATIONARY",
	"startDate": "2025-01-01",
	"basicMonthlySalary": 30000,
	"rateType": "MONTHLY | DAILY | HOURLY",
	"reportsToId": "uuid | null",
	"role": "EMPLOYEE | MANAGER"
}
```

**Response 201**: Full employee object.
**Side effect**: User account created; welcome email with temporary password sent; AuditLog `CREATE` entry.

---

### GET /api/v1/employees/:id

Get full employee profile.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN` (any); `MANAGER` (direct reports only); `EMPLOYEE` (own record only).

**Response 200**: Full employee object including PII fields for authorized roles.

---

### PATCH /api/v1/employees/:id

Update employee fields.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**: Any subset of employee fields (partial update).

**Response 200**: Updated employee object.
**Side effect**: AuditLog `UPDATE` entry with `oldValue` / `newValue`.

---

### POST /api/v1/employees/:id/offboard

Mark employee as offboarded.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**: `{ "endDate": "2025-12-31", "reason": "string" }`

**Response 200**: `{ "status": "OFFBOARDED", "endDate": "..." }`
**Side effect**: User `isActive` set to `false`; AuditLog entry.

---

## Departments

### GET /api/v1/departments

List all departments.

**Roles**: All authenticated users.

**Response 200**: `{ "data": [{ "id": "uuid", "name": "string", "parentDepartmentId": "uuid|null" }] }`

---

### POST /api/v1/departments

Create department.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**: `{ "name": "string", "parentDepartmentId": "uuid | null" }`

**Response 201**: Department object.

---

### PATCH /api/v1/departments/:id

Update department name or parent.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Response 200**: Updated department object.
