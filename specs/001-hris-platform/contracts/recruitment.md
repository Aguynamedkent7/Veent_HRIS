# API Contract: Recruitment

**Base path**: `/api/v1/recruitment`
**Auth**: Bearer JWT required.

---

## Job Postings

### GET /api/v1/recruitment/postings

List job postings.

**Roles**: All authenticated (employees see `OPEN` only; HR Admin sees all).

**Query params**: `status`, `departmentId`, `page`, `limit`

**Response 200**: Paginated list.

---

### POST /api/v1/recruitment/postings

Create a job posting.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**:
```json
{
  "title": "string",
  "departmentId": "uuid",
  "description": "string",
  "status": "DRAFT | OPEN"
}
```

**Response 201**: JobPosting object.

---

### PATCH /api/v1/recruitment/postings/:id

Update a posting (title, description, status).

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Response 200**: Updated JobPosting.

---

## Applicants

### POST /api/v1/recruitment/postings/:postingId/applicants

Submit an application (internal self-application or HR-added).

**Roles**: All authenticated (self-apply); `HR_ADMIN`/`SUPER_ADMIN` (add on behalf)

**Request body** (multipart/form-data):
```
firstName: string
lastName: string
email: string
phone?: string
coverLetter?: string
resume?: file (PDF, max 5MB)
```

**Response 201**: Applicant object with `currentStage: APPLIED`.

---

### GET /api/v1/recruitment/postings/:postingId/applicants

List applicants for a posting.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`, `MANAGER` (if assigned to posting)

**Query params**: `stage`, `page`, `limit`

**Response 200**: Paginated list.

---

### PATCH /api/v1/recruitment/applicants/:id/stage

Advance or reject an applicant.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**:
```json
{
  "stage": "SCREENING | INTERVIEW | OFFER | HIRED | REJECTED",
  "notes": "string | null"
}
```

**Response 200**: Updated applicant with new stage.
**Side effect**: Stage change recorded in `ApplicantStageHistory`; applicant notified by email.

---

### POST /api/v1/recruitment/applicants/:id/convert

Convert a hired applicant to an Employee.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN`

**Request body**:
```json
{
  "departmentId": "uuid",
  "jobTitle": "string",
  "startDate": "2025-08-01",
  "basicMonthlySalary": 30000,
  "employmentType": "FULL_TIME",
  "role": "EMPLOYEE | MANAGER"
}
```

**Response 201**: New Employee object (pre-populated from applicant data).
**Response 409**: Applicant `currentStage` is not `HIRED`.
**Side effect**: Applicant `convertedToEmployeeId` updated; User account created; welcome email sent.
