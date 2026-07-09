# API Contract: Dashboard & Reports

**Base path**: `/api/v1`
**Auth**: Bearer JWT required.

---

## Dashboard

### GET /api/v1/dashboard

Role-aware dashboard metrics. Response shape differs by role.

**Roles**: All authenticated.

**Response 200 — EMPLOYEE**:
```json
{
  "currentTimesheetStatus": "DRAFT | SUBMITTED | APPROVED | null",
  "leaveBalances": [{ "leaveTypeName": "string", "remaining": 12 }],
  "nextPayrollDate": "2025-07-15",
  "pendingLeaveRequests": 1
}
```

**Response 200 — MANAGER**:
```json
{
  "pendingTimesheetApprovals": 3,
  "pendingLeaveApprovals": 2,
  "teamHeadcount": 8,
  "teamOnLeaveToday": 1
}
```

**Response 200 — HR_ADMIN / SUPER_ADMIN**:
```json
{
  "totalHeadcount": 120,
  "activeEmployees": 118,
  "onLeaveToday": 5,
  "pendingApprovals": { "timesheets": 12, "leaveRequests": 4 },
  "nextPayrollDate": "2025-07-15",
  "openJobPostings": 3,
  "newHiresThisMonth": 2
}
```

**Cache**: Max 5-minute Redis cache per organization per role group.

---

## Reports

All report endpoints return paginated JSON by default. Add `?export=csv` to receive
a CSV file download.

---

### GET /api/v1/reports/headcount

Headcount report with optional historical trend.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Query params**: `departmentId?`, `employmentType?`, `dateFrom`, `dateTo`, `groupBy=month|quarter`

**Response 200**:
```json
{
  "summary": { "total": 120, "active": 118, "offboarded": 2 },
  "trend": [{ "period": "2025-06", "headcount": 116 }, { "period": "2025-07", "headcount": 120 }]
}
```

---

### GET /api/v1/reports/attendance

Attendance report (present, absent, on-leave per day per employee).

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`, `MANAGER` (direct reports only)

**Query params**: `employeeId?`, `departmentId?`, `dateFrom`, `dateTo`, `page`, `limit`

**Response 200**: Per-employee per-day attendance status.

**Export**: `?export=csv` → downloadable CSV with headers:
`Employee Number, Name, Date, Status (PRESENT|ABSENT|ON_LEAVE|HOLIDAY), Hours Worked`

---

### GET /api/v1/reports/payroll-costs

Payroll cost report by period and department.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Query params**: `departmentId?`, `dateFrom`, `dateTo`, `groupBy=department|month`

**Response 200**:
```json
{
  "summary": { "totalGross": 1200000, "totalDeductions": 180000, "totalNet": 1020000 },
  "breakdown": [
    { "department": "Engineering", "totalGross": 600000, "headcount": 20, "averageSalary": 30000 }
  ]
}
```

---

### GET /api/v1/reports/leave-utilization

Leave utilization report.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Query params**: `leaveTypeId?`, `departmentId?`, `year`

**Response 200**:
```json
{
  "summary": { "totalAllocated": 1800, "totalUsed": 450, "utilizationRate": 0.25 },
  "byLeaveType": [
    { "leaveTypeName": "Annual Leave", "allocated": 1500, "used": 400 }
  ],
  "byEmployee": [
    { "employeeNumber": "EMP-0001", "name": "string", "allocated": 15, "used": 5, "remaining": 10 }
  ]
}
```

---

### GET /api/v1/reports/audit-log

Audit log viewer (read-only).

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Query params**: `actorId?`, `entityType?`, `action?`, `dateFrom`, `dateTo`, `page`, `limit`

**Response 200**: Paginated AuditLog entries.
**Note**: `oldValue` and `newValue` fields are redacted for non-`SUPER_ADMIN` roles.
