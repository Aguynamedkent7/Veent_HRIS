# Plan — Requests & Multi-Stage Approvals (T168 / T169)

**Spec**: `VEENT HRIS.md` §4 (Request Module) + §5 (Approval Module) · FR-056–FR-059
**Issues**: [#25](https://github.com/Aguynamedkent7/Veent_HRIS/issues/25) (T168), [#26](https://github.com/Aguynamedkent7/Veent_HRIS/issues/26) (T169)
**Branch**: `dev/payroll`

## Goal
One unified **Request** model covering 7 types submitted via the Employee Kiosk, routed through a
**configurable multi-stage approval chain** (Employee → Supervisor → HR → Payroll) with Approve /
Reject / Return-for-correction. Approved requests **auto-apply to attendance & payroll** — most
importantly, approved **Overtime** feeds the attendance engine's OT gate that is currently stubbed to `0`.

## Locked decisions (from discussion)
- **New `Request` model; migrate existing `leave_requests` into it, then retire `LeaveRequest`.** One
  kiosk, one approval engine; leave becomes `type = LEAVE`.
- **Payload = `Json` validated by a Zod `discriminatedUnion('type', …)`**, with a small set of
  **promoted top-level columns** (`dateFrom`, `dateTo`, `status`) for the hot query paths
  (approval inbox, OT lookup, dashboard counts). `hours` also promoted (nullable) for OT/undertime/
  rest-day/holiday so the payroll seam doesn't parse JSON.

---

## Slice 1 — Schema & enums (T168 foundation)

New enums:
```prisma
enum RequestType {
  LEAVE
  OVERTIME
  UNDERTIME
  OFFICIAL_BUSINESS
  REST_DAY_WORK
  HOLIDAY_WORK
  INFO_UPDATE
}
enum RequestStatus {
  PENDING          // in-flight, sitting at some stage
  APPROVED         // all stages approved
  REJECTED         // terminal reject
  RETURNED         // sent back to employee for correction (editable, re-submittable)
  CANCELLED        // withdrawn by employee
}
enum ApprovalDecision { APPROVED  REJECTED  RETURNED }
```

New models:
```prisma
model Request {
  id           String        @id @default(cuid())
  employeeId   String
  type         RequestType
  status       RequestStatus @default(PENDING)
  dateFrom     DateTime?     // promoted for querying (leave/OB span, OT/undertime day)
  dateTo       DateTime?
  hours        Decimal?      @db.Decimal(6, 2)  // OT/undertime/rest-day/holiday
  reason       String?
  payload      Json          // type-specific detail, validated by Zod
  currentStage Int           @default(0)         // index into the resolved chain
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  employee  Employee        @relation(fields: [employeeId], references: [id])
  steps     ApprovalStep[]
  documents RequestDocument[]   // supporting docs (depends on T162 uploads; text-URL stub until then)

  @@index([employeeId, status])
  @@index([type, status, dateFrom])
  @@map("requests")
}

model ApprovalStep {
  id           String            @id @default(cuid())
  requestId    String
  stageIndex   Int                                  // 0-based order in the chain
  role         Role                                 // who acts at this stage (SUPERVISOR handled below)
  decision     ApprovalDecision?                    // null = pending
  actorId      String?                              // user who decided
  note         String?
  decidedAt    DateTime?
  createdAt    DateTime          @default(now())

  request Request @relation(fields: [requestId], references: [id], onDelete: Cascade)
  actor   User?   @relation(fields: [actorId], references: [id])

  @@unique([requestId, stageIndex])
  @@map("approval_steps")
}
```
- **"Supervisor" stage**: there is no `SUPERVISOR` role — supervisor = the employee's
  `reportsToId`. Model it as a stage with a `SUPERVISOR` sentinel in a small `ApprovalStageKind`
  enum (`SUPERVISOR | ROLE`), or reuse `role` with an added `MANAGER` mapping + an `isDirectManager`
  bool. **Chosen**: add `stageKind` enum column (`SUPERVISOR`, `ROLE`); when `ROLE`, `role` names the
  approver group (HR_ADMIN, PAYROLL_OFFICER…). Keeps "my direct report's requests" queryable.
- `RequestDocument`: thin model (`requestId`, `label`, `url`, `uploadedAt`). Real file storage is
  T162 — until then accept a URL/text ref so the flow is complete.

Retire `LeaveRequest`: keep `LeaveType`/`LeaveBalance` (still used); drop the `LeaveRequest` model
after migration (Slice 2). `LeaveRequestStatus` enum stays only if referenced elsewhere (it isn't — verify).

## Slice 2 — Data migration (leave → request)
- One-off migration script (`prisma/migrations` is `db push` here, so a `scripts/migrate-leave-to-request.ts`
  run once): for every `leave_requests` row create a `requests` row with
  `type=LEAVE`, `dateFrom=startDate`, `dateTo=endDate`, `hours=null`,
  `reason`, `payload={ leaveTypeId, totalDays }`, and map status
  (`PENDING/APPROVED/REJECTED/CANCELLED` → same). Recreate the historical approval trail as a single
  resolved `ApprovalStep` reflecting `reviewedById/reviewedAt/rejectionReason` where present.
- Seed data is small/fresh → low risk. Verify counts before/after; keep `leave_requests` table until
  the app no longer reads it, then drop.

## Slice 3 — Validation & config (T168)
- `src/lib/server/schemas/requests.ts`: `z.discriminatedUnion('type', [...])` — one object per type
  (e.g. OVERTIME `{ date, hours, reason }`, LEAVE `{ leaveTypeId, startDate, endDate, reason? }`,
  INFO_UPDATE `{ field, currentValue?, requestedValue }`). A `toColumns(parsed)` helper derives the
  promoted `dateFrom/dateTo/hours` from each payload so the service stays type-agnostic.
- **Routing config**: a per-type default chain (data, not code) so it's "configurable" per FR-059.
  Start with an org-level `RequestRouting` map (`Json` on `Organization` or a small table):
  `LEAVE → [SUPERVISOR, HR]`, `OVERTIME → [SUPERVISOR, HR, PAYROLL]`, `INFO_UPDATE → [HR]`, etc.
  When a request is created, resolve the chain into concrete `ApprovalStep` rows.

## Slice 4 — Request service + kiosk API/UI (T168)
- `src/lib/server/services/requests.ts`: `createRequest`, `listRequests` (filters: mine / inbox /
  type / status), `getRequest`, `cancelRequest`, `resubmitRequest` (after RETURNED).
- Employee Kiosk: `(app)/requests` (list + new) with a type picker driving the right payload form;
  `(app)/requests/[id]` detail with timeline of steps. Employees see their own; the old
  `(app)/leave` pages become a filtered view of Requests (`type=LEAVE`) or redirect.
- REST: `api/v1/requests` (+ `[id]`, `[id]/decision`).

## Slice 5 — Approval engine (T169)
- `src/lib/server/services/approvals.ts`: `decide(requestId, stageIndex, decision, note, ctx)`:
  - authorize actor against the stage (`SUPERVISOR` ⇒ actor is employee's `reportsToId`'s user;
    `ROLE` ⇒ actor has that role). Reuse `rbac.ts`.
  - **APPROVED** → stamp step, advance `currentStage`; if last stage → `status=APPROVED` + fire
    `applyApprovedRequest` (Slice 6). **REJECTED** → terminal. **RETURNED** → `status=RETURNED`,
    reset to employee.
  - write `AuditLog` per decision.
- Rebuild `(app)/approvals` inbox to list pending **Requests** at stages the current user can act on
  (union of: SUPERVISOR steps for my reports + ROLE steps for my role), alongside existing pending
  timesheets. Approve / Reject / **Return** actions. `ApprovalCard.svelte` gains a Return button + note.

## Slice 6 — Auto-apply to attendance & payroll (T169) ⭐ the OT gate
- `applyApprovedRequest(request)` switch by type:
  - **OVERTIME / REST_DAY_WORK / HOLIDAY_WORK** → nothing to persist eagerly; consumed at derivation.
  - **LEAVE** → already consumed by `deriveRange` (reads approved leave). Repoint that query from
    `leaveRequest` to `request` where `type=LEAVE, status=APPROVED`.
  - **INFO_UPDATE** → apply the field change to `Employee` (HR-gated fields via existing rules).
- **Wire the OT gate** in `src/lib/server/services/attendance/index.ts` (`deriveRange`, ~line 93/122):
  add, beside the existing `leaves` query, an approved-OT lookup:
  ```ts
  const otReqs = await db.request.findMany({
    where: { employeeId: emp.id, type: 'OVERTIME', status: 'APPROVED',
             dateFrom: { gte: dayWindowStart, lte: dayWindowEnd } },
    select: { dateFrom: true, hours: true }
  })
  const otByDay = new Map(...)  // dayKey -> approved hours
  ```
  then pass `approvedOtHours: otByDay.get(dayKey) ?? 0` into `deriveAttendanceDay` instead of the
  hard-wired `0`. `deriveAttendanceDay` already pays `min(rawOvertime, approvedOtHours)` — so OT
  starts paying with **zero engine changes**, only the wiring.
- Re-derivation timing: `importAttendance` (period lock) already calls `deriveRange`; approving an OT
  request before lock is enough. Optionally re-derive the affected day on approval for live preview.

## Slice 7 — Tests & verify
- Unit: request Zod union (each type accept/reject), `toColumns` promotion, approval engine state
  machine (advance / reject / return / re-submit), routing resolution, **OT gate** (approved OT hours
  flow into `deriveAttendanceDay` and cap raw OT).
- Migration: assert `leave_requests` count == migrated `requests(type=LEAVE)` count + status mapping.
- Manual (TESTING.md): employee files OT → supervisor approves → HR approves → payroll approves →
  run payroll → OT is paid. Return-for-correction round trip.

## RBAC / roles touchpoints
- Approve authorization reuses `rbac.ts`. The **Payroll** approval stage targets `PAYROLL_OFFICER`
  (added in T161) or HR/Super. Supervisor stage = `reportsToId`.

## Risks / open questions
- **Chain configurability depth**: v1 = per-type default chain (org-level). Full per-department or
  conditional routing (e.g. OT > N hours needs extra stage) is a follow-up — flag, don't silently cap.
- **Info-Update auto-apply** to sensitive fields overlaps T164 (bank/GCash) — gate writes; for fields
  not yet on the employee record, store the approved change and apply when T164 lands.
- **Unworked regular-holiday pay** and rest-day+holiday stacking remain out of scope (pre-existing
  HANDOFF gotchas), unaffected by this work.
- Dropping `LeaveRequest`: **11 readers must be repointed** to `Request(type=LEAVE)` before the drop —
  services: `attendance/index.ts` (deriveRange), `dashboard.ts`, `leave.ts`, `reports.ts`; routes:
  `api/v1/leave/[id]`, `approvals`, `dashboard`, `leave`, `team`, `reports/audit-log`; schema:
  `schemas/index.ts`. This is the bulk of Slice 2's app-side work (migration script moves the data;
  these edits move the reads).

## Suggested build order
**Re-sequenced during implementation** to keep every commit non-breaking: the leave→Request
migration is deferred to the end (after the approval engine exists), so leave never sits in a
half-migrated state.

1. **Slice 1** ✅ — schema + enums.
2. **Slice 2** — validation (Zod union) + routing config + `createRequest` service. *Additive, touches
   no existing code.*
3. **Slice 3** — Employee Kiosk API/UI (`(app)/requests`) for the 6 new types.
4. **Slice 4** — approval engine (`decide()`), rebuild `/approvals` inbox to include requests.
5. **Slice 5** — auto-apply + **OT gate** ⭐ (wire approved OT into `deriveRange`).
6. **Slice 6 (cutover)** ✅ — migrated `leave_requests` → `Request(type=LEAVE)`, repointed all readers
   (deriveRange, dashboard, team, reports, approvals), routed leave create/approve through the Request
   engine (balance validated on create, deducted on final approval), leave now shows in the unified
   Approvals → Requests tab. **`LeaveRequest` table kept dormant (no readers) for reversibility — the
   physical `DROP` is deferred to a small post-QA cleanup commit.**
7. **Slice 7** — tests + manual verify throughout.

## Deferred cleanup (after QA sign-off)
- Drop the `LeaveRequest` model + `leave_requests` table + the `Employee.leaveRequests` /
  `LeaveType.leaveRequests` relations, and remove `LeaveRequestStatus` if unused.
- Optionally retire the `/leave` route entirely in favour of `/requests` (kept for now to preserve the
  balance-aware leave form UX).
