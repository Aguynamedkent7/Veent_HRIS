# Data Model: Veent HRIS Core Platform

**Date**: 2026-07-09
**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

All entities are stored in PostgreSQL 16. Schema is managed via Prisma 5.

---

## Entity Relationship Overview

```
Organization
  └── Department (many)
  └── User (many)
       └── Employee (1:1, optional)
            ├── Department (belongs to)
            ├── Employee (reportsTo, self-ref)
            ├── Timesheet (many)
            │    └── TimesheetEntry (many, one per day)
            ├── LeaveBalance (many, one per LeaveType)
            ├── LeaveRequest (many)
            └── PayrollEntry (many, via PayrollRun)

PayrollConfig (1 per Organization)
PayrollRun (many per Organization)
  └── PayrollEntry (many, one per Employee per run)
       └── StatutoryDeduction (many: SSS/PhilHealth/Pag-IBIG/BIR)

LeaveType (many per Organization)

JobPosting (many per Organization)
  └── Applicant (many)
       └── ApplicantStage (many, history)

AuditLog (append-only, all entities)
```

---

## Entities

### Organization

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `name` | String | required, max 200 chars |
| `logoUrl` | String? | optional |
| `address` | String? | optional |
| `createdAt` | DateTime | auto |
| `updatedAt` | DateTime | auto |

---

### Department

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `organizationId` | UUID FK → Organization | required |
| `name` | String | required, unique within org |
| `parentDepartmentId` | UUID FK → Department? | optional (sub-department) |
| `createdAt` | DateTime | auto |
| `updatedAt` | DateTime | auto |

---

### User

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `organizationId` | UUID FK → Organization | required |
| `email` | String | required, unique |
| `passwordHash` | String | required, bcrypt cost 12 |
| `role` | Enum | `EMPLOYEE`, `MANAGER`, `HR_ADMIN`, `SUPER_ADMIN` |
| `isActive` | Boolean | default `true`; `false` = deactivated |
| `lastLoginAt` | DateTime? | updated on successful login |
| `createdAt` | DateTime | auto |
| `updatedAt` | DateTime | auto |

**State transitions**: `isActive` true → false (offboarding); false → true (reactivation).
Both transitions recorded in AuditLog.

---

### Employee

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `userId` | UUID FK → User | unique (1:1) |
| `organizationId` | UUID FK → Organization | required |
| `employeeNumber` | String | unique within org, auto-generated (e.g., `EMP-0001`) |
| `firstName` | String | required |
| `lastName` | String | required |
| `middleName` | String? | optional |
| `dateOfBirth` | Date? | optional, PII |
| `gender` | Enum? | `MALE`, `FEMALE`, `NON_BINARY`, `PREFER_NOT_TO_SAY` |
| `contactPhone` | String? | optional, PII |
| `contactAddress` | String? | optional, PII |
| `departmentId` | UUID FK → Department | required |
| `jobTitle` | String | required |
| `employmentType` | Enum | `FULL_TIME`, `PART_TIME`, `CONTRACTUAL`, `PROBATIONARY` |
| `employmentStatus` | Enum | `ACTIVE`, `ON_LEAVE`, `OFFBOARDED` |
| `startDate` | Date | required |
| `endDate` | Date? | set on offboarding |
| `reportsToId` | UUID FK → Employee? | direct manager |
| `basicMonthlySalary` | Decimal(12,2) | required, PH payroll basis |
| `rateType` | Enum | `MONTHLY`, `DAILY`, `HOURLY` |
| `sssNumber` | String? | PII, encrypted at rest |
| `philhealthNumber` | String? | PII, encrypted at rest |
| `pagibigNumber` | String? | PII, encrypted at rest |
| `tinNumber` | String? | PII, encrypted at rest |
| `createdAt` | DateTime | auto |
| `updatedAt` | DateTime | auto |

**PII fields** (`dateOfBirth`, `contactPhone`, `contactAddress`, `sssNumber`,
`philhealthNumber`, `pagibigNumber`, `tinNumber`): encrypted using application-layer
encryption (AES-256) before storage; decrypted only when explicitly requested by
authorized roles.

---

### Timesheet

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `employeeId` | UUID FK → Employee | required |
| `periodStart` | Date | Monday of the work week |
| `periodEnd` | Date | Friday of the work week |
| `status` | Enum | `DRAFT`, `SUBMITTED`, `APPROVED`, `REJECTED` |
| `submittedAt` | DateTime? | set on submission |
| `reviewedAt` | DateTime? | set on approve/reject |
| `reviewedById` | UUID FK → Employee? | manager who reviewed |
| `rejectionReason` | String? | required if `REJECTED` |
| `totalHours` | Decimal(5,2) | computed from entries |
| `createdAt` | DateTime | auto |
| `updatedAt` | DateTime | auto |

Unique constraint: `(employeeId, periodStart)` — prevents duplicate timesheet submissions.

### TimesheetEntry

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `timesheetId` | UUID FK → Timesheet | required |
| `date` | Date | must fall within timesheet period |
| `hoursWorked` | Decimal(4,2) | 0–24, required |
| `notes` | String? | optional |

---

### LeaveType

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `organizationId` | UUID FK → Organization | required |
| `name` | String | e.g., "Annual Leave", "Sick Leave", "Unpaid Leave" |
| `isPaid` | Boolean | default `true` |
| `defaultDaysPerYear` | Decimal(5,2) | annual allocation |
| `allowCarryOver` | Boolean | default `false` |
| `maxCarryOverDays` | Decimal(5,2)? | if `allowCarryOver = true` |
| `isActive` | Boolean | default `true` |

### LeaveBalance

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `employeeId` | UUID FK → Employee | required |
| `leaveTypeId` | UUID FK → LeaveType | required |
| `year` | Int | calendar year |
| `allocated` | Decimal(5,2) | days allocated for the year |
| `used` | Decimal(5,2) | days consumed (approved requests) |
| `remaining` | Decimal(5,2) | computed: allocated − used |

Unique constraint: `(employeeId, leaveTypeId, year)`.

### LeaveRequest

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `employeeId` | UUID FK → Employee | required |
| `leaveTypeId` | UUID FK → LeaveType | required |
| `startDate` | Date | required |
| `endDate` | Date | required, ≥ startDate |
| `totalDays` | Decimal(5,2) | computed (excludes weekends + holidays) |
| `reason` | String? | optional |
| `status` | Enum | `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED` |
| `reviewedById` | UUID FK → Employee? | approving manager |
| `reviewedAt` | DateTime? | set on approve/reject |
| `rejectionReason` | String? | required if `REJECTED` |
| `createdAt` | DateTime | auto |
| `updatedAt` | DateTime | auto |

Business rule: `totalDays` MUST NOT exceed `LeaveBalance.remaining` at time of submission
(HR Admin override allowed, recorded in AuditLog).

---

### PublicHoliday

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `organizationId` | UUID FK → Organization | required |
| `date` | Date | required |
| `name` | String | required |
| `type` | Enum | `REGULAR`, `SPECIAL_NON_WORKING` |
| `year` | Int | for filtering |

---

### PayrollConfig

One record per Organization.

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `organizationId` | UUID FK → Organization | unique |
| `payFrequency` | Enum | `SEMI_MONTHLY`, `MONTHLY` |
| `firstCutoff` | Int? | day of month (e.g., 15 for semi-monthly) |
| `secondCutoff` | Int? | day of month (e.g., 30/31) |
| `sssTable` | Json | SSS contribution bracket table (updatable) |
| `philhealthRate` | Decimal(5,4) | employee rate (e.g., 0.025) |
| `philhealthFloor` | Decimal(10,2) | min monthly contribution |
| `philhealthCeiling` | Decimal(10,2) | max monthly contribution |
| `pagibigRate` | Decimal(5,4) | employee rate (e.g., 0.02) |
| `pagibigCeiling` | Decimal(10,2) | max employee contribution |
| `birTaxTable` | Json | TRAIN law annual bracket table (updatable) |
| `updatedAt` | DateTime | auto |

### PayrollRun

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `organizationId` | UUID FK → Organization | required |
| `periodStart` | Date | required |
| `periodEnd` | Date | required |
| `status` | Enum | `DRAFT`, `COMPUTED`, `APPROVED`, `VOIDED` |
| `totalGross` | Decimal(14,2) | computed sum |
| `totalDeductions` | Decimal(14,2) | computed sum |
| `totalNet` | Decimal(14,2) | computed sum |
| `hasOverride` | Boolean | true if approved with missing timesheets |
| `overrideNote` | String? | required if `hasOverride = true` |
| `approvedById` | UUID FK → User? | HR Admin who approved |
| `approvedAt` | DateTime? | set on approval |
| `createdAt` | DateTime | auto |
| `updatedAt` | DateTime | auto |

Unique constraint: `(organizationId, periodStart, periodEnd)`.
Status transitions: `DRAFT` → `COMPUTED` → `APPROVED`; `APPROVED` is immutable;
corrections handled via a new run with adjustment entries.

### PayrollEntry

One row per employee per PayrollRun.

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `payrollRunId` | UUID FK → PayrollRun | required |
| `employeeId` | UUID FK → Employee | required |
| `hoursWorked` | Decimal(6,2) | from approved timesheets |
| `basicPay` | Decimal(12,2) | prorated salary or hourly × hours |
| `grossPay` | Decimal(12,2) | basicPay + allowances |
| `sssEe` | Decimal(10,2) | SSS employee share |
| `sssEr` | Decimal(10,2) | SSS employer share |
| `philhealthEe` | Decimal(10,2) | PhilHealth employee share |
| `philhealthEr` | Decimal(10,2) | PhilHealth employer share |
| `pagibigEe` | Decimal(10,2) | Pag-IBIG employee share |
| `pagibigEr` | Decimal(10,2) | Pag-IBIG employer share |
| `withholdingTax` | Decimal(10,2) | BIR monthly withholding |
| `totalDeductions` | Decimal(12,2) | sum of all EE deductions + tax |
| `netPay` | Decimal(12,2) | grossPay − totalDeductions |
| `isFlagged` | Boolean | true if timesheet missing/unapproved |
| `flagReason` | String? | explanation if flagged |

---

### JobPosting

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `organizationId` | UUID FK → Organization | required |
| `departmentId` | UUID FK → Department | required |
| `title` | String | required |
| `description` | String | required |
| `status` | Enum | `DRAFT`, `OPEN`, `CLOSED` |
| `postedAt` | DateTime? | set when status → OPEN |
| `closedAt` | DateTime? | set when status → CLOSED |
| `createdById` | UUID FK → User | HR Admin |
| `createdAt` | DateTime | auto |
| `updatedAt` | DateTime | auto |

### Applicant

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `jobPostingId` | UUID FK → JobPosting | required |
| `firstName` | String | required |
| `lastName` | String | required |
| `email` | String | required |
| `phone` | String? | optional |
| `resumeUrl` | String? | local file path in v1 |
| `coverLetter` | String? | optional |
| `currentStage` | Enum | `APPLIED`, `SCREENING`, `INTERVIEW`, `OFFER`, `HIRED`, `REJECTED` |
| `convertedToEmployeeId` | UUID FK → Employee? | set on hire conversion |
| `createdAt` | DateTime | auto |
| `updatedAt` | DateTime | auto |

### ApplicantStageHistory

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `applicantId` | UUID FK → Applicant | required |
| `stage` | Enum | same as `Applicant.currentStage` |
| `notes` | String? | optional |
| `changedById` | UUID FK → User | HR Admin/Manager |
| `changedAt` | DateTime | auto |

---

### AuditLog

Append-only. No UPDATE or DELETE permitted at any layer.

| Field | Type | Rules |
|-------|------|-------|
| `id` | UUID PK | auto-generated |
| `organizationId` | UUID FK → Organization | required |
| `actorId` | UUID FK → User | user who triggered the action |
| `actorRole` | Enum | role at time of action |
| `action` | Enum | `CREATE`, `UPDATE`, `DELETE`, `LOGIN`, `LOGIN_FAILED`, `PAYROLL_OVERRIDE`, `LEAVE_OVERRIDE` |
| `entityType` | String | e.g., `Employee`, `Timesheet`, `PayrollRun` |
| `entityId` | UUID | PK of affected entity |
| `oldValue` | Json? | snapshot before mutation |
| `newValue` | Json? | snapshot after mutation |
| `ipAddress` | String? | from request header |
| `userAgent` | String? | from request header |
| `createdAt` | DateTime | auto, immutable |

**Retention**: Rows older than 3 years are archived to cold storage (not deleted);
application enforces this via a scheduled archival job.

---

## State Machine Summary

| Entity | States |
|--------|--------|
| Timesheet | DRAFT → SUBMITTED → APPROVED / REJECTED |
| LeaveRequest | PENDING → APPROVED / REJECTED / CANCELLED |
| PayrollRun | DRAFT → COMPUTED → APPROVED (immutable) / VOIDED |
| JobPosting | DRAFT → OPEN → CLOSED |
| Applicant | APPLIED → SCREENING → INTERVIEW → OFFER → HIRED / REJECTED |
| Employee | ACTIVE → ON_LEAVE → ACTIVE (return); ACTIVE → OFFBOARDED |
| User | isActive: true → false (deactivate) → true (reactivate) |
