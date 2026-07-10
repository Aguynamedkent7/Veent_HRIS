# Feature Specification: Veent HRIS Core Platform

**Feature Branch**: `001-hris-platform`

**Created**: 2026-07-09

**Status**: Draft

**Input**: User description: "this will be an HRIS, it will have all of those, time sheets, a dashboard, users, reports"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Employee Self-Service Portal (Priority: P1)

An employee logs in and can view and manage their own work information without needing HR intervention. They can submit timesheets, file leave requests, and view their employment records and payslips.

**Why this priority**: The self-service portal is the single most-used surface of any HRIS. Reducing HR admin burden and giving employees direct access to their own data is foundational value that every other module depends on.

**Independent Test**: Can be fully tested by creating an employee account, logging in, submitting a timesheet, and verifying the timesheet appears in the employee's history — all without any other module being complete.

**Acceptance Scenarios**:

1. **Given** an employee has a valid account, **When** they log in, **Then** they land on a personal dashboard showing their current timesheet status, pending leave balance, and upcoming payslip date.
2. **Given** an employee is logged in, **When** they submit hours worked for a given week, **Then** the timesheet is saved as "Pending Approval" and their manager is notified.
3. **Given** an employee submits a leave request, **When** their manager approves it, **Then** the employee receives a confirmation and their leave balance is updated accordingly.
4. **Given** an employee views their profile, **When** they update their personal contact details, **Then** the change is saved and an audit log entry is created.

---

### User Story 2 - HR Admin: Employee Lifecycle Management (Priority: P2)

An HR Administrator can onboard new employees, manage employment records, update roles and departments, and offboard employees when they leave the organization.

**Why this priority**: HR Admin is the primary operator of the system. Without the ability to manage the employee roster, no other module has valid data to work with.

**Independent Test**: Can be fully tested by an HR Admin creating a new employee record, assigning them a department and role, and verifying the employee can log in — without payroll, reports, or other advanced modules being complete.

**Acceptance Scenarios**:

1. **Given** an HR Admin is logged in, **When** they create a new employee record with required fields, **Then** the employee appears in the employee list and receives login credentials via email.
2. **Given** an HR Admin updates an employee's department or job title, **When** the change is saved, **Then** the audit log records who made the change, when, and what was changed.
3. **Given** an employee's last day arrives, **When** the HR Admin marks them as "offboarded", **Then** their account is deactivated and their records are retained in a read-only state.
4. **Given** an HR Admin searches for an employee by name or ID, **When** results appear, **Then** they can access the full employee profile in one click.

---

### User Story 3 - Manager: Timesheet & Leave Approval (Priority: P3)

A manager can review their direct reports' submitted timesheets and leave requests, approve or reject them with comments, and see a team-level attendance overview.

**Why this priority**: Approval workflows activate the operational value of timesheet and leave modules. Without manager approval, the self-service portal is a dead end.

**Independent Test**: Can be fully tested by a manager logging in, viewing a pending timesheet submission from a direct report, approving it, and verifying the employee's timesheet status updates — without payroll processing or reports being complete.

**Acceptance Scenarios**:

1. **Given** a manager logs in, **When** they open their approvals queue, **Then** they see all pending timesheets and leave requests from their direct reports, sorted by submission date.
2. **Given** a manager reviews a timesheet, **When** they approve it, **Then** the timesheet status changes to "Approved" and the employee is notified.
3. **Given** a manager rejects a timesheet, **When** they provide a rejection reason, **Then** the employee is notified with the reason and can resubmit.
4. **Given** a manager views the team attendance overview, **When** they select a date range, **Then** they see a summary of who was present, absent, or on leave each day.

---

### User Story 4 - HR Admin: Payroll Processing (Priority: P4)

An HR Administrator can run payroll for a given period, review computed pay per employee (salary, deductions, allowances), approve the payroll run, and generate payslips that employees can access.

**Why this priority**: Payroll is business-critical but depends on approved timesheets and accurate employee records being in place (P1–P3).

**Independent Test**: Can be fully tested by running a payroll cycle for a small group of employees with approved timesheets and verifying that payslips are generated with correct amounts.

**Acceptance Scenarios**:

1. **Given** all timesheets for a payroll period are approved, **When** the HR Admin initiates a payroll run, **Then** the system computes gross pay, deductions, and net pay for each employee.
2. **Given** a payroll run is computed, **When** the HR Admin reviews and approves it, **Then** payslips are generated and become visible to each employee in their portal.
3. **Given** an employee views their payslip, **When** they open a pay period, **Then** they see an itemized breakdown of earnings, deductions, and net pay.
4. **Given** a payroll run contains an error (e.g., missing timesheet), **When** the HR Admin reviews it, **Then** the problematic record is flagged with a clear explanation before approval is allowed.

---

### User Story 5 - HR Admin & Executive: Dashboards & Reports (Priority: P5)

HR Admins and executives can view a real-time dashboard of workforce metrics and generate exportable reports covering headcount, attendance, payroll costs, and leave utilization.

**Why this priority**: Dashboards and reports are analytical layers on top of operational data. They are high-value but depend on the operational modules (P1–P4) being functional.

**Independent Test**: Can be fully tested by viewing the dashboard after at least one full payroll cycle and one approved timesheet, and verifying that headcount, attendance, and payroll cost figures are accurate.

**Acceptance Scenarios**:

1. **Given** an HR Admin is logged in, **When** they open the dashboard, **Then** they see live metrics: total headcount, employees on leave today, pending approvals, and next payroll date.
2. **Given** an executive views the workforce report, **When** they select a date range and department filter, **Then** they see headcount trends, turnover rate, and average tenure.
3. **Given** an HR Admin generates an attendance report, **When** they export it, **Then** a downloadable file is produced containing per-employee attendance data for the selected period.
4. **Given** a payroll cost report is generated, **When** filtered by department, **Then** it shows total payroll cost, average salary, and cost-per-department breakdown.

---

### User Story 6 - Recruitment: Job Postings & Applicant Tracking (Priority: P6)

HR Admins can post open positions, receive and manage applications, track candidate progress through hiring stages, and convert successful candidates to employees.

**Why this priority**: Recruitment adds significant value but is independent of the operational HR modules and can be delivered later without blocking the core system.

**Independent Test**: Can be fully tested by creating a job posting, submitting a test application, moving the applicant through stages, and marking them as hired — independently of payroll and timesheets.

**Acceptance Scenarios**:

1. **Given** an HR Admin creates a job posting, **When** it is published, **Then** the posting appears on an internal jobs listing and can be shared externally via a unique link.
2. **Given** an applicant submits their application, **When** it is received, **Then** the HR Admin sees it in the applicant tracker under the relevant job posting.
3. **Given** an applicant progresses through hiring stages (Applied → Screening → Interview → Offer → Hired), **When** each stage is updated, **Then** the applicant and relevant team members are notified.
4. **Given** a candidate is marked "Hired", **When** the HR Admin converts them, **Then** a new employee record is pre-populated from their application data.

---

### Edge Cases

- What happens when an employee submits a timesheet for a period that overlaps with approved leave?
- How does the system handle payroll for an employee who joins or leaves mid-pay-period?
- What if a manager approves a timesheet but the employee has already been offboarded?
- What if two HR Admins attempt to run payroll for the same period simultaneously?
- How are timesheets and leave balances handled across public holidays?
- What happens when a manager is also an employee under another manager?

---

## Requirements *(mandatory)*

### Functional Requirements

**User & Access Management**
- **FR-001**: The system MUST support at least four roles: `employee`, `manager`, `hr_admin`, and `super_admin`, each with distinct access permissions.
- **FR-002**: The system MUST allow HR Admins to create, edit, deactivate, and reactivate employee accounts.
- **FR-003**: The system MUST send login credentials to new employees via email upon account creation.
- **FR-004**: The system MUST enforce role-based access so that employees cannot view other employees' private data.
- **FR-005**: The system MUST log every login attempt (success and failure) with timestamp and IP address.

**Employee Records**
- **FR-006**: The system MUST store, for each employee: full name, employee ID, department, job title, employment type, start date, and contact details.
- **FR-007**: The system MUST maintain a complete change history for every employee record field.
- **FR-008**: Offboarded employees MUST remain accessible in read-only mode for audit and historical reporting purposes.

**Timesheets**
- **FR-009**: Employees MUST be able to submit weekly timesheets specifying hours worked per day.
- **FR-010**: Timesheets MUST go through a defined workflow: Draft → Submitted → Approved / Rejected.
- **FR-011**: Managers MUST be able to approve or reject timesheets with mandatory comments on rejection.
- **FR-012**: The system MUST prevent duplicate timesheet submissions for the same employee and period.

**Leave Management**
- **FR-013**: The system MUST support configurable leave types (e.g., annual, sick, unpaid).
- **FR-014**: Employees MUST be able to submit leave requests specifying type, start date, end date, and reason.
- **FR-015**: Leave requests MUST go through the same approval workflow as timesheets (manager approval).
- **FR-016**: The system MUST automatically calculate and update an employee's remaining leave balance upon approval.
- **FR-017**: The system MUST prevent leave requests that exceed available balance (with override capability for HR Admins).

**Payroll**
- **FR-018**: The system MUST compute payroll based on approved timesheets, employee salary/rate, and configured deductions.
- **FR-019**: Payroll runs MUST be period-based (e.g., semi-monthly, monthly) and configurable per organization.
- **FR-020**: HR Admins MUST be able to review and approve a payroll run before payslips are issued.
- **FR-021**: The system MUST generate itemized payslips accessible to employees after payroll approval.
- **FR-022**: Completed payroll runs MUST be immutable; corrections MUST be handled via adjustment entries.
- **FR-023**: Before a payroll run can be approved, the system MUST display a warning listing all employees with missing or unapproved timesheets. The HR Admin MAY override and approve despite the warning; the override action MUST be recorded in the audit log with the approver's identity and timestamp.

**Dashboard & Reports**
- **FR-024**: Each role MUST see a role-appropriate dashboard upon login (employee sees personal data; HR Admin sees org-wide metrics).
- **FR-025**: The dashboard MUST display real-time data — no stale cache older than 5 minutes.
- **FR-026**: HR Admins MUST be able to generate, filter, and export reports for: headcount, attendance, payroll costs, and leave utilization.
- **FR-027**: All reports MUST be exportable in at least one structured format (e.g., CSV or spreadsheet).

**Recruitment**
- **FR-028**: HR Admins MUST be able to create job postings with title, department, description, and status (Draft / Open / Closed).
- **FR-029**: The system MUST track applicants through configurable hiring stages.
- **FR-030**: Hiring a candidate MUST trigger pre-population of a new employee record from applicant data.

**Audit & Compliance**
- **FR-031**: The system MUST maintain an immutable audit log for all data mutations on core HR entities.
- **FR-032**: Audit logs MUST capture: actor, timestamp, entity type, entity ID, field changed, old value, and new value.
- **FR-033**: Audit logs MUST be retained for a minimum of 3 years and accessible to HR Admins and Super Admins.

**Benefits Administration**
- **FR-034**: HR Admins MUST be able to define benefit plans (HMO, insurance, retirement, allowance, leave credit, other) with employee/employer cost shares.
- **FR-035**: HR Admins MUST be able to enroll employees in benefit plans and change enrollment status (active / waived / terminated); an employee MUST NOT be enrolled twice in the same plan.
- **FR-036**: Employees MUST be able to view their own benefit enrollments.

**Performance Management**
- **FR-037**: HR Admins MUST be able to create review cycles (period-bound) and open performance reviews pairing a subject employee with a reviewer.
- **FR-038**: A performance review MUST follow the workflow: Pending → Self-Assessment → Manager Review → Completed → Acknowledged.
- **FR-039**: The review subject MUST be able to submit a self-assessment; only the assigned reviewer MUST be able to submit manager comments and an overall rating (1–5).
- **FR-040**: Employees MUST be able to create personal goals and track progress (0–100%); goals MAY be linked to a review cycle.

**Settings & Org Structure**
- **FR-041**: HR Admins MUST be able to maintain a catalog of positions (titles) and view an organizational chart derived from departments and reporting lines.
- **FR-042**: Super Admins MUST be able to change a user's role; a user MUST NOT change their own role, and role changes MUST be recorded in the audit log with old and new values.

**Time Tracking (Discord Integration)**
- **FR-043**: The system MUST accept clock-in / clock-out punches from an external Discord bot via a dedicated endpoint authenticated by an HMAC signature (shared secret + timestamp, with replay protection); session cookies MUST NOT be required.
- **FR-044**: Each punch MUST be attributed to the employee whose `discordId` matches; punches from unknown or inactive Discord accounts MUST be rejected.
- **FR-045**: Punch timestamps MUST be stored in UTC and bucketed into calendar days/weeks using Philippine Standard Time (UTC+8).
- **FR-046**: HR MUST be able to aggregate a week of raw punches into a DRAFT weekly timesheet (pairing IN/OUT per day, flagging missing/stray punches), then review, edit, and approve it through the existing timesheet approval workflow so it feeds payroll unchanged.

**Privacy & Compliance note (Phase 10 — per Constitution §I and §IV)**
- Benefit data (HMO/health, insurance) and performance reviews are sensitive PII; access is
  restricted per the RBAC rules above (employees see only their own; HR/Super Admin manage),
  handled under the Philippine Data Privacy Act (RA 10173) alongside existing employee PII.
- The Discord integration stores only a `discordId` mapping and raw punch timestamps; the punch
  endpoint carries no other PII and is authenticated by shared-secret HMAC (no session/credential
  exposure). All benefit, review, goal, role, and punch mutations are recorded in the immutable
  audit log with actor, timestamp, and before/after values.

### Key Entities

- **Organization**: Top-level entity; holds company details, payroll configuration, leave policies.
- **User**: Authentication identity; linked 1:1 to an Employee for staff, or standalone for Super Admins.
- **Employee**: Core HR record — profile, employment details, department, reporting manager.
- **Department**: Organizational unit; employees and job postings belong to departments.
- **Timesheet**: Weekly record of hours worked per day, per employee; tied to a pay period.
- **LeaveRequest**: A request by an employee for time off; associated with a LeaveType and leave balance.
- **LeaveBalance**: Per-employee, per-leave-type counter of allocated vs. used vs. remaining days.
- **PayrollRun**: A period-bound payroll computation; contains PayrollEntries per employee.
- **PayrollEntry**: Per-employee line in a PayrollRun — gross pay, deductions, net pay, payslip.
- **JobPosting**: An open role with hiring stages and associated applicants.
- **Applicant**: A candidate for a JobPosting; progresses through hiring stages.
- **AuditLog**: Immutable record of every mutation on any core entity.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An HR Admin can onboard a new employee (create record, assign role, send credentials) in under 5 minutes.
- **SC-002**: An employee can submit a weekly timesheet in under 2 minutes.
- **SC-003**: A manager can process their full approvals queue (up to 20 items) in under 10 minutes.
- **SC-004**: An HR Admin can complete a payroll run (compute, review, approve, issue payslips) in under 30 minutes for up to 200 employees.
- **SC-005**: Any report can be generated and available for download in under 60 seconds for up to 12 months of data.
- **SC-006**: The system remains fully operational for at least 99.5% of scheduled working hours per month.
- **SC-007**: 90% of employees can complete primary self-service tasks (timesheet, leave request) without HR Admin assistance.
- **SC-008**: All audit log entries are recorded within 1 second of the triggering action and are never deletable by any user.

---

## Assumptions

- The organization is a single company (not multi-tenant); one HRIS instance serves one organization. Multi-company support is out of scope for v1.
- Payroll statutory deductions follow Philippines regulations: SSS, PhilHealth, and Pag-IBIG contributions computed at current mandated rates, plus BIR withholding tax applied using official tax tables.
- Mobile support is out of scope for v1; the system targets desktop web browsers.
- Email is the primary notification channel; SMS and push notifications are out of scope for v1.
- The system does not integrate with external accounting or ERP software in v1; payroll data is self-contained.
- Employees are assumed to have stable internet connectivity during working hours.
- A "working week" is Monday–Friday; weekend handling and shift scheduling are out of scope for v1.
- Public holiday calendars are configurable by the HR Admin, not auto-populated from a third-party service.
- Recruitment is internal-only in v1; public job board integrations (e.g., LinkedIn, JobStreet) are out of scope.
