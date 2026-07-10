# API Contract: Time Logs (Discord Time Tracking)

**Base path**: `/api/v1/timesheets`
**Auth**: See per-endpoint (punch ingestion is HMAC, not session).

**Status**: `POST /api/v1/timesheets/log` is IMPLEMENTED and HMAC-authenticated; the punch-listing and aggregation endpoints below are the intended surface — the aggregation SERVICE (`aggregateTimeLogsToTimesheet` in `src/lib/server/services/timelog.ts`) is implemented, its HTTP route + HR review UI are deferred (tasks.md Phase 10).

---

## POST /api/v1/timesheets/log

**IMPLEMENTED**. Server-to-server punch ingestion for the Discord bot; NOT session-authenticated.

**Auth**: HMAC-SHA256 over `` `${timestamp}.${rawBody}` `` using `TIMELOG_API_SECRET`. Headers: `x-hris-signature` (hex), `x-hris-timestamp` (unix seconds). Replay window ±300s. 401 if invalid/missing/stale.

**Request body**:
```json
{
  "discordId": "string",
  "punchType": "IN | OUT",
  "timestamp": "ISO8601 | null",
  "messageId": "string | null"
}
```
`timestamp` defaults to server now.

**Behavior**: Resolves the Employee by `discordId` (must be `ACTIVE`); inserts a raw `TimeLog` (stored UTC). Timestamps are bucketed to Philippine Standard Time (UTC+8) at aggregation.

**Response 201**:
```json
{
  "data": {
    "id": "uuid",
    "punchType": "IN | OUT",
    "timestamp": "ISO8601",
    "employee": { "id": "uuid", "firstName": "string", "lastName": "string" },
    "previousType": "IN | OUT | null"
  }
}
```

**Error 400**: Invalid body.
**Error 401**: Bad/missing/stale signature.
**Error 404**: No active employee linked to that Discord id.
**Side effect**: AuditLog `CREATE` entry (entityType `TimeLog`).

---

## GET /api/v1/timesheets/:employeeId/punches?from=&to=

INTENDED. List raw punches in a window.

**Roles**: Owner, manager of owner, `HR_ADMIN`, `SUPER_ADMIN`

**Query params**: `from`, `to`

**Response 200**: List of raw `TimeLog` punches within the window.

---

## POST /api/v1/timesheets/aggregate

INTENDED. Build a weekly draft timesheet from raw Discord punches.

**Roles**: `HR_ADMIN`, `SUPER_ADMIN` (or the owner for their own week)

**Request body**:
```json
{ "employeeId": "uuid", "weekOf": "2025-07-07" }
```

**Behavior**: Pairs IN/OUT punches per PHT day (overnight shifts count toward the IN day; missing-OUT/stray-OUT produce warnings), upserts a `DRAFT` weekly `Timesheet` + one `TimesheetEntry` per worked day, and links the punches. Refuses to touch a non-`DRAFT` timesheet.

**Response 200**:
```json
{
  "timesheet": { "...": "..." },
  "hoursByDay": { "2025-07-07": 8 },
  "totalHours": 40,
  "warnings": ["string"]
}
```

**Error 409**: Target timesheet is not `DRAFT`.

Approval reuses the existing timesheet approve/reject flow.
