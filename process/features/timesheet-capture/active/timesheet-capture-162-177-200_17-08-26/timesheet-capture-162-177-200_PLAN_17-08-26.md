---
name: plan:timesheet-capture-162-177-200
description: "AM/PM attendance split (#162), CSV backlog import (#200), and a session-authenticated web punch with location (#177) — one PR, three sequentially-gated phases, food-service orgs only"
date: 17-08-26
feature: timesheet-capture
---

# PLAN — Timesheet Capture Cluster (#162 / #177 / #200)

**TL;DR** — One PR on `feat/timesheet-capture-162-177-200`. Three phases, each with its own
green gate before the next starts. Phase 1 adds four nullable AM/PM columns to `AttendanceDay`
and one boolean parameter to the pure derive function; nothing that reads attendance today
changes. Phase 2 adds a CSV backlog importer that writes `TimeLog` rows and re-uses the same
derive path. Phase 3 adds the first web punch page and four nullable location columns on
`TimeLog`. No Prisma enum is renamed anywhere, so **no `scripts/migrate-*.ts` is needed**.

**Date**: 17-08-26
**Status**: ACTIVE — planned, not started
**Complexity**: COMPLEX (multi-phase, schema + payroll-adjacent, new production dependency, new public surface)
**Branch**: `feat/timesheet-capture-162-177-200`
**SPEC**: `timesheet-capture-162-177-200_SPEC_17-08-26.md` (same task folder)
**RESEARCH**: `research-findings_REF_17-08-26.md` (same task folder)
**Context routing**: `process/context/all-context.md` holds only `.gitkeep` on this repo — the
routing table does not exist yet (RESEARCH §preamble). Test context therefore comes from the
live suites in `tests/unit/` and `tests/e2e/`, enumerated in RESEARCH §11; post-phase testing is
specified per phase below and re-stated in `## Phase Completion Rules`.

---

## Overview

| Phase | Issue | Adds | Gate before next phase |
|---|---|---|---|
| 1 | #162 | 4 nullable `AttendanceDay` columns + `splitAmPm` param on `deriveAttendanceDay` + AM/PM columns on the attendance page and CSV export | 4 CI gates green + 5 new unit specs green + mutation checks red-on-mutate |
| 2 | #200 | `papaparse` dependency, `dedupKey` on `TimeLog`, `attendance/import.ts` service, upload form action | 4 CI gates green + 7 new unit specs green + mutation checks |
| 3 | #177 | 4 nullable `TimeLog` location columns, `recordPunch` refactor, `/punch` page + action | 4 CI gates green + 6 new unit specs green + 1 e2e + manual script |

### Goals

1. A food-service employee's day carries a distinct AM pair and PM pair, without changing the
   one-row-per-date shape or the meaning of `timeIn` / `timeOut`.
2. HR can upload a CSV backlog of punches that is idempotent, lock-respecting, and audited.
3. An employee can punch from a browser page that optionally attaches a location reading.

### Non-goals (locked, do not reopen)

- No change to `@@unique([employeeId, date])` on `AttendanceDay`.
- No photo / EXIF / TimeMark import.
- No new `Organization` column; `isFoodServiceOrg()` is the gate.
- No geofencing, no location purge tooling, no break punches.
- No second AM/PM engine in `timelog.ts` or `TimesheetModal.svelte`.

---

## Locked Design Decisions (from INNOVATE — adopted verbatim, with the exact mechanics)

**D1 — AM/PM boundary = longest mid-day gap between work segments.**
`derive.ts:162-188` already builds `workSegs: Array<[number, number]>` by pairing IN/OUT.
The split is a *post-pass* over that array. No new pairing logic, no fixed noon cut, no
`WorkScheduleDay` read (it stores break *duration*, not position — see the comment at
`derive.ts:233-238`), no break punches.

**D2 — AM/PM is display-only.** The four values never feed `workedHours`, `regularHours`,
`overtimeHours`, `lateMinutes`, `undertimeMinutes`, or any payroll bucket. This is the single
most important safety property in the cluster: a wrong boundary produces a wrong *label*, never
a wrong *peso*. See `## Risks` R1.

**D3 — Org gating is a boolean parameter on the pure function**, exactly like `enforceTardiness`
(`derive.ts:56-61`). `derive.ts` stays DB-free and unit-testable. Call sites pass
`isFoodServiceOrg(organizationId)`.

**D4 — CSV = one new production dependency, `papaparse`.** Parsed in memory, file discarded.
`storage.ts` is not touched: `ALLOWED_MIME` (`storage.ts:12-17`) and `sniffMime` (`:27`) stay
exactly as they are. The durable record is the resulting `TimeLog` rows plus the audit entry.

**D5 — Import idempotency via a deterministic synthetic key on `TimeLog`**, checked in one bulk
query, backed by a DB unique constraint — the same two-layer shape as the Discord replay defence
(`timelog.ts:52-84` + `schema.prisma` `@@unique([discordMessageId, employeeId])`).

**D6 — Web punch refactors `recordPunch()`**; no parallel `recordWebPunch()`. Only employee
resolution and the dedup key vary.

---

## Prisma / Migration Contract (read before Phase 1)

**Does anything here need an enum change? Explicitly: no.**

| Enum | Needed value | Status |
|---|---|---|
| `PunchSource` (`schema.prisma:214`) | `WEB` | **Already exists.** Phase 3 is its first writer. |
| `PunchSource` | `MANUAL` | **Already exists.** Phase 2 writes it. |
| `PunchType` (`schema.prisma:207`) | `IN` / `OUT` | Already exist. No `BREAK_*` writer added. |
| `AuditAction` (`schema.prisma:194-203`) | none | Phase 2 and 3 use existing `CREATE` / `UPDATE` with a descriptive `newValue`, matching the two shapes already in use (`attendance/index.ts:298-303` summary, `timelog.ts:87-99` per-record). |

Therefore **no `ALTER TYPE … RENAME VALUE` and no `scripts/migrate-*.ts` is required by any
phase of this cluster.** Every schema change is an ADD of a nullable column or an ADD of a
unique index over nullable columns — all of which `prisma db push` performs without data loss.

**Exact command sequence after editing `prisma/schema.prisma`, every phase:**

```bash
./start.sh                 # only if the DB container is not already up
pnpm db:push               # dotenv -e .env.dev -- prisma db push
pnpm prisma generate       # MANDATORY — see below
pnpm check                 # confirms the regenerated client types resolve
```

`pnpm prisma generate` is **not optional**. A stale `@prisma/client` has produced phantom
`pnpm check` errors on this repo three times: `svelte-check` reads the generated types from
`node_modules/.prisma/client`, so a new column that exists in Postgres but not in the generated
client surfaces as "Object literal may only specify known properties" on a perfectly correct
write. If `pnpm check` reports an unknown field on a column you just added, run
`pnpm prisma generate` before debugging anything else. (`postinstall` runs it, but `db push`
alone does not always.)

---

## Verification Gate Protocol (applies to every phase)

The four CI gates run in **this order** and CI **stops at the first failure**:

```bash
pnpm format:check      # prettier --check .
pnpm lint              # eslint .            — does NOT run format:check
pnpm check             # svelte-kit sync && svelte-check
pnpm test              # vitest run  (tests/unit/**)
```

`pnpm lint` does not run `format:check`. A phase is not green until all four have been run in
order and all four exit 0. Run `pnpm format` (write mode) before `pnpm format:check` if the
first gate fails on whitespace — do not hand-edit formatting.

E2E (`pnpm test:e2e`, Playwright) is a **hybrid** gate: it needs the seeded DB from `./start.sh`
+ `pnpm db:seed:e2e`. It is required at the end of Phase 3 only.

---

# PHASE 1 — #162 AM/PM split

**Scope:** additive columns, one pure-function parameter, two display surfaces.
**Not in scope:** `timelog.ts` engine B, `TimesheetModal.svelte` engine C, `TimesheetEntry`.

## 1.1 `prisma/schema.prisma` — `AttendanceDay`

Current (`schema.prisma`, `model AttendanceDay`):

```prisma
model AttendanceDay {
  id         String           @id @default(cuid())
  employeeId String
  date       DateTime         @db.Date
  status     AttendanceStatus
  dayType    DayType          @default(REGULAR)
  timeIn     DateTime?
  timeOut    DateTime?
```

**Change:** insert four nullable columns immediately after `timeOut`, with a comment recording
the invariant. Do not touch `@@unique([employeeId, date])` or any other line.

```prisma
  timeIn     DateTime?
  timeOut    DateTime?

  // #162 — food-service tenants only (isFoodServiceOrg). The AM/PM pair is a DISPLAY split of
  // the same punches `timeIn`/`timeOut` already bracket: amTimeIn === timeIn and
  // pmTimeOut === timeOut whenever a PM block exists. Never read by payroll, reports, or the
  // payslip — those keep reading timeIn/timeOut (first punch / last punch of the day). Null on
  // every non-food-service row and on any day with no second work block.
  amTimeIn   DateTime?
  amTimeOut  DateTime?
  pmTimeIn   DateTime?
  pmTimeOut  DateTime?
```

Then run the Prisma command sequence above.

## 1.2 `src/lib/server/services/attendance/derive.ts` — the only engine taught AM/PM

### 1.2a Extend `DeriveInput`

Current (`derive.ts:47-63`):

```ts
export interface DeriveInput {
	punches: PunchLite[]
	schedule: ScheduleDay | null
	dayType: DayType
	approvedOtHours?: number
	onLeave?: boolean
	enforceTardiness?: boolean
	config?: DeriveConfig
}
```

**Change:** add one optional boolean, documented in the same voice as `enforceTardiness`
(`derive.ts:56-61`):

```ts
	/**
	 * Whether to compute the AM/PM display split (#162). Defaults to false; the caller passes
	 * `isFoodServiceOrg(organizationId)`. When false, all four am*/pm* results stay null and this
	 * function behaves exactly as it did before #162. The split is DISPLAY ONLY — it never
	 * changes workedHours, the hour buckets, lateMinutes, or undertimeMinutes.
	 */
	splitAmPm?: boolean
```

### 1.2b Extend `AttendanceDayResult`

Current (`derive.ts:65-83`) starts:

```ts
export interface AttendanceDayResult {
	status: AttendanceStatus
	timeIn: Date | null
	timeOut: Date | null
```

**Change:** add four fields after `timeOut`:

```ts
	amTimeIn: Date | null
	amTimeOut: Date | null
	pmTimeIn: Date | null
	pmTimeOut: Date | null
```

And add all four as `null` to `emptyResult()` (`derive.ts:130-150`), right after `timeOut: null`.
This is load-bearing: it guarantees an ABSENT / ON_LEAVE / REST_DAY row always *clears* stale
AM/PM values rather than leaving them behind.

### 1.2c The boundary constant + the split function

Add near `MEAL_BREAK_OWED_AFTER_MS` (`derive.ts:19-21`):

```ts
// #162 — the smallest gap between two work blocks that counts as the AM/PM boundary. Below
// this, two adjacent segments are the same block interrupted by a quick re-punch (a phone
// double-tap, a corrected mis-punch), not a morning and an evening shift. 30 minutes is the
// shortest real between-shift break at these tenants; a shorter threshold would split a single
// block and label half a morning "PM".
const MIN_AM_PM_GAP_MS = 30 * 60_000
```

Add the pure post-pass, placed directly above `deriveAttendanceDay`:

```ts
/**
 * Split already-paired work segments into an AM block and a PM block at the LONGEST mid-day
 * gap (#162). `segs` must be ascending, which is what the pairing loop produces from sorted
 * punches. `openWork` is a dangling IN with no OUT yet — a half-finished PM block.
 *
 * Ties go to the EARLIEST qualifying gap, so the result is deterministic for a day whose two
 * gaps are exactly equal. Returns all-null when there is no qualifying gap; a single-block day
 * is deliberately NOT reported as "AM only", because a lone evening shift is not a morning.
 */
function splitAmPmBlocks(
	segs: Array<[number, number]>,
	openWork: number | null
): { amIn: Date | null; amOut: Date | null; pmIn: Date | null; pmOut: Date | null }
```

Behaviour, exactly:

1. If `segs.length === 0` → all null. (A day with only a dangling IN has no AM block to anchor
   the split against.)
2. Build `gaps[i] = segs[i + 1][0] - segs[i][1]` for `i` in `0 .. segs.length - 2`. Pick the
   index `k` with the maximum gap, scanning left-to-right and using strict `>` so the earliest
   maximum wins.
3. If such a `k` exists and `gaps[k] >= MIN_AM_PM_GAP_MS`:
   `amIn = segs[0][0]`, `amOut = segs[k][1]`, `pmIn = segs[k + 1][0]`,
   `pmOut = segs[segs.length - 1][1]`.
4. Else if `openWork !== null` and `openWork - segs[segs.length - 1][1] >= MIN_AM_PM_GAP_MS`:
   the day is AM-complete with a PM block still running.
   `amIn = segs[0][0]`, `amOut = segs[segs.length - 1][1]`, `pmIn = openWork`, `pmOut = null`.
5. Else → all null (one continuous block; `timeIn`/`timeOut` already describe it).

Return `Date` objects, not epoch millis, to match the rest of the result type.

### 1.2d Wire it into `deriveAttendanceDay`

`derive.ts:189` currently reads `const incomplete = openWork !== null`. `openWork` is in scope
there. After `result.timeOut = lastOut` (`derive.ts:262`), insert:

```ts
	if (input.splitAmPm) {
		const { amIn, amOut, pmIn, pmOut } = splitAmPmBlocks(workSegs, openWork)
		result.amTimeIn = amIn
		result.amTimeOut = amOut
		result.pmTimeIn = pmIn
		result.pmTimeOut = pmOut
	}
```

Note the early returns at `derive.ts:191-197` (`workSegs.length === 0`) go through
`emptyResult()`, which now returns all-null AM/PM — correct by construction, no extra branch.

**Do not** change `firstIn` / `lastOut`, `lateMinutes` (`:245`), `undertimeMinutes` (`:246`), the
`threshold` (`:250-253`), or any hour bucket. If a diff line touches those, it is out of scope.

## 1.3 `src/lib/server/services/attendance/index.ts` — call sites

### 1.3a Import the gate

Add to the imports at the top (`index.ts:1-9`):

```ts
import { isFoodServiceOrg } from '$lib/orgs'
```

### 1.3b `deriveRange` — pass the flag and persist the columns

Current (`index.ts:258-291`):

```ts
			const r = deriveAttendanceDay({
				punches: byDay.get(dayKey) ?? [],
				schedule: dayType === 'REGULAR' ? schedDay : null,
				dayType,
				approvedOtHours: approvedOtByDay.get(dayKey) ?? 0,
				onLeave,
				enforceTardiness
			})

			const data = {
				status: r.status,
				dayType,
				timeIn: r.timeIn,
				timeOut: r.timeOut,
				workedHours: r.workedHours,
```

**Change 1** — add `splitAmPm` to the call. Hoist the boolean once above the employee loop
(near `orgTracksTardiness`, `index.ts:175`) so it is computed once per run:

```ts
	// #162 — AM/PM display split is food-service only (Decision 4 / isFoodServiceOrg).
	const splitAmPm = isFoodServiceOrg(organizationId)
```

then `splitAmPm` joins the `deriveAttendanceDay({ … })` argument object.

**Change 2** — add the four fields to `data`, immediately after `timeOut: r.timeOut,`:

```ts
				amTimeIn: r.amTimeIn,
				amTimeOut: r.amTimeOut,
				pmTimeIn: r.pmTimeIn,
				pmTimeOut: r.pmTimeOut,
```

Because `data` is used for both the `create` and the `update` branch of the upsert
(`index.ts:287-291`), this covers both. Because `emptyResult` returns nulls, a non-food-service
org writes four nulls — and a food-service day that loses its PM block on re-derive is *cleared*,
not left stale.

### 1.3c `correctDay` — the twin door

`correctDay` is the *other* writer of `timeIn`/`timeOut` (`index.ts:396-515`). It must be taught
the same flag or it silently writes a day whose AM/PM columns contradict its `timeIn`/`timeOut`.

Current (`index.ts:464-495`):

```ts
			const r = deriveAttendanceDay({
				punches,
				schedule: day.dayType === 'REGULAR' ? schedDay : null,
				dayType: day.dayType as DayType,
				approvedOtHours,
				enforceTardiness
			})
			…
			write = {
				status: statusOverride ?? r.status,
				timeIn: r.timeIn,
				timeOut: r.timeOut,
```

**Change:** add `splitAmPm: isFoodServiceOrg(organizationId)` to the call, and add the four
fields to `write` after `timeOut: r.timeOut,` — same four lines as 1.3b.

**Documented consequence (intended, not a bug):** the `correct` form action can only express one
`timeIn`/`timeOut` pair (`attendance/+page.server.ts:149-162`, `:189-192`), so `punches` here is
at most one IN and one OUT (`index.ts:460-462`). `splitAmPmBlocks` therefore returns all-null,
and an HR correction **collapses the day to a single block and clears AM/PM**. That is the
honest reading: HR has declared the day is one pair. Add this comment above the `write` block:

```ts
			// #162: the correction form expresses exactly ONE pair, so the AM/PM split resolves to
			// null here and the columns are cleared. That is deliberate — a hand-correction is a
			// declaration that the day is one block. `resetDay` re-derives from punches and brings
			// the split back.
```

The recovery path already exists and needs no change: `resetDayToDerived` (`index.ts:521-552`)
clears `manuallyEdited` and delegates to `deriveRange`, which now writes the split.

**Every other `AttendanceDay` writer is verified untouched:** `lockRange` (`:562-569`) and
`unlockRange` (`:591-598`) write only `isLocked`; `autoDeriveFromPunches` (`:334`) delegates to
`deriveRange`. That is the complete writer set from the RESEARCH map §3.

## 1.4 `src/routes/(app)/attendance/+page.server.ts` — expose the flag

In `load` (`+page.server.ts:34-119`), add the import `import { isFoodServiceOrg } from '$lib/orgs'`
and one line to the returned object (`:105-118`):

```ts
		showAmPm: isFoodServiceOrg(user.organizationId),
```

No action changes in this file.

## 1.5 `src/routes/(app)/attendance/+page.svelte` — two extra column pairs

Both tables. Team table header currently (`+page.svelte:470-477`):

```svelte
					<th class="px-3 py-3 text-left font-medium text-muted-foreground">Status</th>
					<th class="px-3 py-3 text-left font-medium text-muted-foreground">In</th>
					<th class="px-3 py-3 text-left font-medium text-muted-foreground">Out</th>
```

**Change:** after the `Out` header, in **both** `<thead>` blocks (team at `:470-477`,
per-employee at `:608-616`), add:

```svelte
					{#if data.showAmPm}
						<th class="px-3 py-3 text-left font-medium text-muted-foreground">AM In</th>
						<th class="px-3 py-3 text-left font-medium text-muted-foreground">AM Out</th>
						<th class="px-3 py-3 text-left font-medium text-muted-foreground">PM In</th>
						<th class="px-3 py-3 text-left font-medium text-muted-foreground">PM Out</th>
					{/if}
```

And in both `<tbody>` row blocks, after the existing `timeOut` `<td>` (team at `:526-532`,
per-employee at `:657-666`), add four **read-only** cells using the file's existing `fmtTime`:

```svelte
					{#if data.showAmPm}
						<td class="px-3 py-2 text-muted-foreground">{fmtTime(d?.amTimeIn ?? null)}</td>
						<td class="px-3 py-2 text-muted-foreground">{fmtTime(d?.amTimeOut ?? null)}</td>
						<td class="px-3 py-2 text-muted-foreground">{fmtTime(d?.pmTimeIn ?? null)}</td>
						<td class="px-3 py-2 text-muted-foreground">{fmtTime(d?.pmTimeOut ?? null)}</td>
					{/if}
```

Read-only is deliberate: an editable AM/PM input would be a second correction door with no
service-side writer, and would immediately contradict 1.3c. The `recalcHours` handler
(`+page.svelte:119`) is **not** wired to these cells and is not modified.

Also bump any hardcoded `colspan` on the "no rows" placeholder rows in both tables by 4 when
`data.showAmPm` — grep `colspan` in this file and fix each occurrence in the two affected tables.

## 1.6 `src/routes/(app)/attendance/export/+server.ts` — CSV columns

Current, team branch (`export/+server.ts:38-52`):

```ts
		rows = team.map((t) => ({
			Employee: t.name,
			…
			'Time In': fmtTime(t.day?.timeIn ?? null),
			'Time Out': fmtTime(t.day?.timeOut ?? null),
			'Regular Hrs': t.day ? num(t.day.regularHours) : '',
```

and the per-employee branch (`:75-86`):

```ts
		rows = days.map((d) => ({
			Date: manilaDayKey(d.date),
			Status: d.status,
			'Time In': fmtTime(d.timeIn),
			'Time Out': fmtTime(d.timeOut),
```

**Change:** add `import { isFoodServiceOrg } from '$lib/orgs'` and, above the branch,

```ts
	const showAmPm = isFoodServiceOrg(user.organizationId)
	// Spread into EVERY row: exportToCSV takes its header list from rows[0] only
	// (reports.ts:626), so a key present on some rows and absent on others silently drops
	// columns for the rest of the file.
	const amPmCols = (d: { amTimeIn: Date | null; amTimeOut: Date | null; pmTimeIn: Date | null; pmTimeOut: Date | null } | null | undefined) =>
		showAmPm
			? {
					'AM In': fmtTime(d?.amTimeIn ?? null),
					'AM Out': fmtTime(d?.amTimeOut ?? null),
					'PM In': fmtTime(d?.pmTimeIn ?? null),
					'PM Out': fmtTime(d?.pmTimeOut ?? null)
				}
			: {}
```

then `...amPmCols(t.day)` after `'Time Out'` in the team branch and `...amPmCols(d)` in the
per-employee branch. The helper must be called for **every** row including null days, so the key
set is uniform — this is the exact trap `exportToCSV` sets (`reports.ts:626`,
`const headers = Object.keys(rows[0])`).

`exportToCSV` itself is **not modified**; `FORMULA_PREFIX` (`reports.ts:622`) already neutralises
the write side, and `fmtTime` emits `HH:MM` or `''`, neither of which trips it.

## 1.7 Phase 1 tests

New file `tests/unit/attendance-am-pm-split.test.ts`, following the pure-function style of
`tests/unit/attendance-derive.test.ts:1-33` (the `T`/`p`/`derive` helpers, imported types, no
mocks needed — `derive.ts` is DB-free).

| # | Spec | Asserts |
|---|---|---|
| A1 | 08:00–11:00 + 13:00–17:00, `splitAmPm: true` | `amTimeIn` 08:00, `amTimeOut` 11:00, `pmTimeIn` 13:00, `pmTimeOut` 17:00; `timeIn` 08:00 and `timeOut` 17:00 **unchanged**; `workedHours` identical to the same call with `splitAmPm: false` |
| A2 | Same punches, `splitAmPm: false` (the Veent negative control, criterion 2 + 20) | all four AM/PM are `null`; the whole result object deep-equals the pre-change baseline |
| A3 | Three blocks 08:00–10:00, 10:20–12:00, 14:00–17:00 | picks the **14:00 gap (2h)**, not the 10:00 gap (20 min): `amTimeOut` 12:00, `pmTimeIn` 14:00 |
| A4 | Two blocks 08:00–12:00, 12:10–17:00 (10-min gap, below threshold) | all four `null`; `timeIn`/`timeOut` still 08:00/17:00 |
| A5 | AM complete + dangling PM IN: 08:00–11:00, IN 13:00, no OUT | `amTimeIn/Out` = 08:00/11:00, `pmTimeIn` 13:00, `pmTimeOut` `null`, `status` `INCOMPLETE` |
| A6 | Single punch IN only (criterion 5, partial day) | no throw; `status` `INCOMPLETE`; all four AM/PM `null` |
| A7 | Equal gaps 08:00–09:00, 10:00–11:00, 12:00–13:00 (both gaps 1h) | earliest wins: `amTimeOut` 09:00, `pmTimeIn` 10:00 — determinism |
| A8 | Invariant, over A1/A3/A5 | when `pmTimeOut` is non-null, `amTimeIn!.getTime() === timeIn!.getTime()` and `pmTimeOut!.getTime() === timeOut!.getTime()` |

New file `tests/unit/payroll-am-pm-days-of-work.test.ts` (criterion 3): feed the A1 punch set
through `deriveAttendanceDay` with `splitAmPm: true` and `false`, then through
`buildAttendanceInput`'s accumulator shape, asserting **one** day counted and identical
`regularHours` + `overtimeHours` for both flag values. Cross-check the totals against the
existing expectations in `tests/unit/payroll-attendance-split.test.ts`.

New file `tests/unit/hours-engine-parity-am-pm.test.ts` (criterion 4): feed the A1 punch set to
both `deriveAttendanceDay` (engine A) and `pairPunchesToDailyHours` (engine B, `timelog.ts:186`)
and assert the **documented** relationship rather than naive equality — B applies a fixed
12:00–13:00 lunch and an 08:00–17:00 OT window and ignores `WorkSchedule` (`timelog.ts:146-150`),
so with a punch set whose gap *is* 12:00–13:00 and a schedule of 08:00–17:00/60 min break, the
two must agree to within 0.01 h. Add a comment stating that this test pins the AM/PM case only
and that full engine unification is out of scope per the SPEC.

### Mutation checks — Phase 1

Every guard below must be manually mutated once, the test re-run, and the RED confirmed. Record
the result in the phase report.

| Guard | Mutation that must turn it RED | Test that must go red |
|---|---|---|
| Org gating | In `index.ts`, replace `isFoodServiceOrg(organizationId)` with `true` | A2 |
| Longest-gap rule | In `splitAmPmBlocks`, pick `gaps[0]` instead of the max | A3 |
| Minimum-gap threshold | Set `MIN_AM_PM_GAP_MS = 0` | A4 |
| Tie determinism | Change the scan comparison from `>` to `>=` | A7 |
| Display-only invariant | Subtract the AM/PM gap from `netWorkedMs` in `derive.ts` | A1 (`workedHours` equality) and `payroll-am-pm-days-of-work` |
| `emptyResult` clearing | Remove the four `null`s from `emptyResult()` | A6 |
| `timeIn`/`timeOut` meaning | Set `result.timeIn = amIn` | A8 |

**Vacuous-mock warning.** `derive.ts` needs no mocks, so Phase 1's unit tests are naturally
mutation-honest. Phase 2 and 3 do use `vi.mock('$lib/server/db')` — see the warning under §2.7.

## 1.8 Phase 1 blast radius — every reader of `AttendanceDay`, from the RESEARCH map §4

| Reader | Affected? | Why not |
|---|---|---|
| `attendance/input.ts` `accumulateDay():13`, `buildAttendanceInput():27`, segmented `:57` | No | Selects hour buckets and `date`; never `timeIn`/`timeOut`; new columns are additive and nullable |
| `payroll/calculator.ts:161, 165, 233-234, 242, 250-252, 332, 407` | No | Consumes the `buildAttendanceInput` output shape, not the row |
| `reports.ts:380 generateTardiness`, `:425 generateOvertime`, `:157 generateAttendance` | No | Read `lateMinutes` / `overtimeHours` / `status`; unchanged fields |
| `attendance/export/+server.ts:44-45`, `:78-79` | **YES** | Gains 4 conditional columns — §1.6 |
| `attendance/+page.svelte:516-532`, `:650-666` | **YES** | Gains 4 read-only cells — §1.5 |
| `dashboard.ts:158, 217, 239, 279, 359` | No | Counts and hour sums only |
| `api/v1/timesheets/[id]/punches/+server.ts:42` | No | Reads `TimeLog`, not `AttendanceDay` |
| `payroll/payslip-pdf.ts` | No | Reads the calculator output; "Days of Work" is a row count, and the row count is unchanged (D1) |
| `attendanceEntriesForRange` (`index.ts:344-362`) → `createTimesheetFromAttendance` | No | Maps `timeIn`/`timeOut`/hours to `TimesheetEntry`; AM/PM is deliberately **not** carried to `TimesheetEntry` (locked decision) |
| Prisma migration | **YES** | 4 nullable columns, no enum change |

Risk class: **schema change + payroll-adjacent**. Files changed: 6 (schema, derive.ts, index.ts,
+page.server.ts, +page.svelte, export/+server.ts) + 3 new test files.

## 1.9 Phase 1 gate

```bash
pnpm db:push && pnpm prisma generate
pnpm format:check && pnpm lint && pnpm check && pnpm test
```

Expected: all four exit 0. `pnpm test` runs the 3 new files plus the existing
`attendance-derive`, `attendance-autoderive`, `attendance-correct-derive`,
`attendance-schedule-fallback`, `payroll-attendance-split`, `payroll-calculator`,
`payroll-mid-period` suites **unchanged and green** — that regression set is the real proof of
criterion 2. If any pre-existing attendance or payroll spec needs editing to pass, **stop**: the
change is not additive and Decision 1 has been violated.

## 1.10 Phase 1 rollback

Code: `git revert` the phase-1 commit(s) — the change is confined to 6 files and is purely
additive.
Schema: the four columns are nullable with no default and no reader outside §1.5/§1.6, so they
may be **left in place** after a code revert with zero effect. If they must go:
`ALTER TABLE attendance_days DROP COLUMN am_time_in, DROP COLUMN am_time_out, DROP COLUMN pm_time_in, DROP COLUMN pm_time_out;`
then revert the schema file and `pnpm prisma generate`. No data loss: nothing else writes them.

---

# PHASE 2 — #200 CSV backlog import

**Depends on Phase 1** being green: imported punches materialise through `deriveRange`, so the
AM/PM columns must already exist for a backlog row's PM block to be visible.

## 2.1 Dependency

```bash
pnpm add papaparse
pnpm add -D @types/papaparse
```

Justification for the record (SPEC "no new production dependency without justification"):
`papaparse` is ~45 kB, zero runtime sub-dependencies, and correctly handles quoted fields,
embedded newlines inside quotes, CRLF, and a UTF-8 BOM — all four of which a hand-rolled split
gets wrong and all four of which appear in real HR exports. The repo's own CSV *writer*
(`reports.ts:624-648`) emits quoted fields and `\r\n`, so a re-imported export would break a
naive parser immediately.

## 2.2 `prisma/schema.prisma` — `TimeLog.dedupKey`

Current:

```prisma
model TimeLog {
  id               String      @id @default(cuid())
  employeeId       String
  punchType        PunchType
  source           PunchSource @default(DISCORD)
  timestamp        DateTime    @db.Timestamptz(3)
  discordMessageId String?
  note             String?
  timesheetId      String?
  createdAt        DateTime    @default(now())
  …
  @@unique([discordMessageId, employeeId])
  @@index([employeeId, timestamp])
```

**Change:** add one nullable column after `discordMessageId` and one unique index.

```prisma
  discordMessageId String?
  // #200/#177 — deterministic idempotency key for punches that have no Discord message to key
  // on. `backlog:<employeeNumber>:<YYYY-MM-DD>:<slot>` for a CSV import row, and
  // `web:<employeeId>:<YYYY-MM-DDTHH:mm>` for a web punch (#177). Null for every Discord punch,
  // which keeps using discordMessageId. Same two-layer defence as #99: an app-level bulk
  // pre-check for a clean message, plus this constraint to close the concurrent race.
  dedupKey         String?
```

and, beside the existing unique:

```prisma
  @@unique([dedupKey, employeeId])
```

`db push` adds a nullable column and a unique index over it. Postgres treats `NULL` as distinct,
so the millions of existing Discord rows with `dedupKey = NULL` do not collide — identical to how
`@@unique([discordMessageId, employeeId])` already tolerates null message ids. Run the Prisma
command sequence.

## 2.3 New file — `src/lib/server/services/attendance/import.ts`

### 2.3a CSV contract

Header row required, case-insensitive, exactly these six columns in any order:

```
employeeNumber,date,amIn,amOut,pmIn,pmOut
```

- `employeeNumber` — matches `Employee.employeeNumber` within the uploader's org.
- `date` — `YYYY-MM-DD`, interpreted as a PHT day.
- `amIn`/`amOut`/`pmIn`/`pmOut` — `HH:MM` 24-hour, PHT, each optional but `amIn` required.
  Each non-empty cell becomes one `TimeLog` row: `amIn`/`pmIn` → `IN`, `amOut`/`pmOut` → `OUT`,
  timestamp `new Date(\`${date}T${hhmm}:00+08:00\`)` — the identical construction the existing
  `correct` action uses (`attendance/+page.server.ts:190-191`).

### 2.3b Caps (all enforced before any DB read)

```ts
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024 // 2 MB — ~40k rows of this shape
export const MAX_IMPORT_ROWS = 2000             // one HR batch; keeps the bulk queries bounded
```

`MAX_IMPORT_BYTES` deliberately does **not** reuse `MAX_UPLOAD_BYTES` (10 MB, `storage.ts:11`) —
that ceiling is sized for PDFs and images that hit disk. This file never hits disk.

### 2.3c Read-side formula-injection defence

`reports.ts:622`'s `FORMULA_PREFIX` protects what this app *writes*. Nothing protects what it
*reads*. Add the mirror:

```ts
// Mirror of reports.ts:622's write-side defence, on the read side. A cell arriving as
// `=cmd|'/c calc'!A1` or `\t=HYPERLINK(...)` (the neutralised form our own exporter emits) is
// rejected rather than coerced: none of our six columns can legitimately start with one of
// these characters, so a match means the file is either hostile or a round-tripped export whose
// tab we must strip before parsing.
const FORMULA_PREFIX = /^[=+\-@]/

function sanitizeCell(raw: string): { value: string } | { reject: string } {
	const value = raw.replace(/^\t+/, '').trim()   // strip our own exporter's neutraliser
	if (FORMULA_PREFIX.test(value)) return { reject: 'cell looks like a spreadsheet formula' }
	return { value }
}
```

Also strip a leading UTF-8 BOM (`﻿`) from the decoded text before parsing, and reject the
whole file if the decoded text contains a NUL byte (`\u0000`) — that is the cheap, dependency-free
signal that an XLSX or other binary was renamed to `.csv`.

### 2.3d Exported functions

```ts
/** Pure: text → validated rows + per-row rejections. No DB. Exported for unit testing. */
export function parseBacklogCsv(text: string): {
	rows: BacklogRow[]
	rejected: { line: number; reason: string }[]
}

/** The write path. MANAGE_HR + food-service gating is the CALLER's job (form action). */
export async function importBacklog(
	organizationId: string,
	file: { name: string; size: number; text: string },
	ctx: AuditContext
): Promise<ImportResult>
```

`ImportResult` = `{ applied: number; skippedDuplicate: number; rejected: { line: number; employeeNumber: string; date: string; reason: string }[]; punchesWritten: number }`.

### 2.3e `importBacklog` order of operations — bulk, never per-row round trips

1. `if (file.size > MAX_IMPORT_BYTES) error(413, 'Backlog file exceeds the 2 MB limit')`.
2. `if (!file.name.toLowerCase().endsWith('.csv')) error(415, 'Only .csv files are accepted')`.
3. `parseBacklogCsv(file.text)` → `rows`, `rejected`. If `rows.length + rejected.length > MAX_IMPORT_ROWS`
   → `error(400, …)`. If `rows.length === 0` → `error(400, 'No usable rows in this file')`.
4. **One** employee query:
   `db.employee.findMany({ where: { employeeNumber: { in: [...uniqueNumbers] }, user: { organizationId }, employmentStatus: 'ACTIVE' }, select: { id: true, employeeNumber: true } })`.
   Note the scoping goes through the `user` relation, matching every other org-scoped employee
   read in `attendance/index.ts` (`:114`, `:149`). Unresolved numbers → rejected with
   `employee number not found in your organization`.
5. **One** attendance query for the lock guard:
   `db.attendanceDay.findMany({ where: { employeeId: { in: employeeIds }, date: { in: dates } }, select: { employeeId: true, date: true, isLocked: true, manuallyEdited: true } })`.
   Any row with `isLocked` → reject `this day is locked`; `manuallyEdited` → reject
   `this day was hand-corrected by HR`. **Reject before writing any `TimeLog`** — see the
   twin-door note in §2.6.
6. Build the punch list: for each surviving row, up to 4 `{ employeeId, punchType, timestamp, dedupKey, source: 'MANUAL', note }` records. `dedupKey = \`backlog:${employeeNumber}:${date}:${slot}\``.
7. **One** duplicate query:
   `db.timeLog.findMany({ where: { dedupKey: { in: allKeys } }, select: { dedupKey: true } })` →
   a `Set`. Punches whose key is present are dropped; a row all of whose punches are dropped
   counts as `skippedDuplicate`.
8. `db.$transaction` containing `tx.timeLog.createMany({ data: punches, skipDuplicates: true })`
   and the audit write with the tx client (`writeAuditLog(ctx, payload, tx)` — the third
   parameter exists exactly for this, `audit.ts:20-26`). `skipDuplicates: true` is the second
   layer: it absorbs a concurrent double-submit that raced past step 7, the same role `P2002`
   plays at `timelog.ts:81`.
9. **After** the transaction, call `deriveRange(organizationId, { from: minDate, to: maxDate }, ctx)`
   so the days materialise through the one authoritative engine. `deriveRange` independently
   skips locked (`index.ts:249`) and hand-edited (`:251`) days — the guard is now doubled.
   Guard the span: if `maxDate - minDate > 62 days`, reject the file up front with the same
   2-month message the page actions use (`+page.server.ts:146-148`), so one upload cannot
   trigger an unbounded derive.
10. Return `ImportResult`.

Audit payload (one summary row, matching the range-operation shape at `index.ts:298-303`):

```ts
{
	action: 'CREATE',
	entityType: 'AttendanceDay',
	entityId: organizationId,
	newValue: {
		source: 'backlog_csv',
		fileName: file.name,
		rowsParsed, applied, skippedDuplicate,
		rejected: rejected.length,
		// bounded so one bad file cannot write a megabyte of JSON into the audit row
		rejectedSample: rejected.slice(0, 20)
	}
}
```

## 2.4 Form action — `src/routes/(app)/attendance/+page.server.ts`

Add to the existing `actions` object (which ends at `+page.server.ts:314`), styled like its
siblings:

```ts
	// #200 — CSV backlog upload. Same actor boundary as every other attendance write
	// (MANAGE_HR), plus the food-service gate: for Veent this route genuinely does not exist.
	importBacklog: async (event) => {
		requireAnyCapability(event.locals.user!.roles, 'MANAGE_HR')
		requireFoodServiceOrg(event.locals.user!.organizationId)
		const form = await event.request.formData()
		const file = form.get('backlog')
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { error: 'Choose a CSV file to upload.' })
		try {
			const res = await importBacklogCsv(
				event.locals.user!.organizationId,
				{ name: file.name, size: file.size, text: await file.text() },
				ctxOf(event)
			)
			return { imported: res }
		} catch (e) {
			return toFail(e)
		}
	}
```

`requireFoodServiceOrg` is imported from `$lib/server/rbac` (it exists at `rbac.ts:19-21` and
already throws 404 — reuse, do not re-implement). `toFail` (`+page.server.ts:131-136`) currently
maps 400/404/409; **extend its allow-list to include 413 and 415** so the size and type errors
surface as a form message instead of a 500:

```ts
	if (err?.status && [400, 404, 409, 413, 415].includes(err.status))
```

UI: a small `<form method="POST" action="?/importBacklog" enctype="multipart/form-data">` with
`<input type="file" name="backlog" accept=".csv,text/csv">` and a submit button labelled
**"Import backlog CSV"**, rendered only `{#if data.canManage && data.showAmPm}`, placed beside
the existing Refresh/Lock controls. Render `form.imported` as a summary line: `"Applied N rows,
skipped M duplicates, rejected K rows"` plus a `<details>` list of the rejection reasons.

## 2.5 Phase 2 tests

New `tests/unit/attendance-backlog-parse.test.ts` — pure, no mocks (`parseBacklogCsv` only):

| # | Spec | Asserts |
|---|---|---|
| B1 | Well-formed 3-row file with quoted fields, CRLF, and a BOM | 3 rows parsed, 0 rejected, times correct in PHT |
| B2 | Row with `=HYPERLINK("http://x")` in `employeeNumber` | rejected, reason `cell looks like a spreadsheet formula`, **nothing else in the file is dropped** |
| B3 | Row with `\t=cmd` (our own exporter's neutralised form) | rejected — the tab is stripped before the prefix test |
| B4 | Missing `amIn`, bad date, bad `HH:MM`, unknown extra column | each rejected with its own reason and line number |
| B5 | Text containing `` | whole file rejected |

New `tests/unit/attendance-backlog-import.test.ts` — mocks `$lib/server/db`, `$lib/server/audit`,
and `./index` (for `deriveRange`), following the `vi.hoisted` + per-model-method mock shape of
`tests/unit/punch-access.test.ts:17-27`:

| # | Spec | Asserts (criterion) |
|---|---|---|
| B6 | Happy path, 2 rows × 4 punches | `timeLog.createMany` called **once** with 8 records, each `source: 'MANUAL'` and a `backlog:` `dedupKey`; `deriveRange` called once (13) |
| B7 | One `employeeNumber` not in the org | that row rejected with `not found in your organization`; the **other** row still applied; the rejected employee's id never appears in `createMany` (14) |
| B8 | Target day has `isLocked: true` | row rejected; `createMany` receives **zero** records for that employee/date (15) |
| B9 | Target day has `manuallyEdited: true` | same as B8 with the hand-corrected reason (15) |
| B10 | Re-upload: `timeLog.findMany` returns all 8 keys | `createMany` called with `[]` or not called; `skippedDuplicate` = 2; **no** duplicate write (16) |
| B11 | Audit | exactly one `writeAuditLog` call, `entityType: 'AttendanceDay'`, `newValue.source === 'backlog_csv'`, counts correct, `rejectedSample` length ≤ 20 (17) |
| B12 | Bulk-query discipline | across a 50-row file, `employee.findMany` called **once**, `attendanceDay.findMany` **once**, `timeLog.findMany` **once** (performance guard) |

New `tests/unit/attendance-backlog-rbac.test.ts` — imports the `actions` **export** from
`+page.server.ts` (not the handler body — the repo has been burned by asserting on the wrong
thing here; see the #290 note in the project memory) and asserts:

| # | Spec | Asserts (criterion) |
|---|---|---|
| B13 | Role without `MANAGE_HR` (e.g. `EMPLOYEE`) | throws 403; `importBacklogCsv` never called (18) |
| B14 | `HR_ADMIN` in a **non**-food-service org (`org_veent`) | throws 404; `importBacklogCsv` never called (18, 20 — the negative control) |
| B15 | `HR_ADMIN` in `org_jojo` | reaches `importBacklogCsv` (18) |
| B16 | Oversize file / non-`.csv` name | `fail` with 413 / 415 message, no DB write (19) |

### Mutation checks — Phase 2

| Guard | Mutation that must turn it RED | Test |
|---|---|---|
| Lock refusal | Delete the `isLocked` branch in step 5 | B8 |
| Manual-edit refusal | Delete the `manuallyEdited` branch | B9 |
| Duplicate collapse | Skip step 7's `Set` filter | B10 |
| DB-level dedup backstop | Remove `skipDuplicates: true` **and** the unique index | (integration; assert the `P2002` path in B10's variant) |
| Org gating | Delete `requireFoodServiceOrg` from the action | B14 |
| Capability gating | Delete `requireAnyCapability` from the action | B13 |
| Employee org scoping | Drop `user: { organizationId }` from the step-4 `where` | B7 |
| Formula rejection | Delete `sanitizeCell`'s prefix test | B2 |
| Row/size caps | Raise `MAX_IMPORT_BYTES` / `MAX_IMPORT_ROWS` past the fixture | B16 |

**Vacuous-mock warning — read before writing B7/B8/B12.** A flat
`dbMock.employee.findMany.mockResolvedValue([{ id: 'e1', employeeNumber: 'JJ-001' }])` returns
that row **for every query shape**, which makes "the stranger was not resolved" pass even when
the `organizationId` scoping has been deleted. Use `mockImplementation(({ where }) => …)` and
branch on the `where` shape — exactly the technique `punch-access.test.ts:57-65` documents in its
own comment ("Discriminate on the where-shape, not call order"). The same applies to
`attendanceDay.findMany` in B8: return the locked row only when the queried `date` matches.

## 2.6 Twin-door analysis — Phase 2

This repo has six recorded cases of a guard added to one door while its twin stayed open. Named
explicitly:

| Guard | Its twin | Is the twin covered? |
|---|---|---|
| Import refuses locked days | **The `correct` form action** (`+page.server.ts:182`) → `correctDay` refuses locked at `index.ts:417` | **Yes, pre-existing.** |
| Import refuses locked days | **`deriveRange`** (`index.ts:249`) | **Yes, pre-existing** — and step 9 runs through it, so the guard is doubled. |
| Import refuses locked days | **The web punch (Phase 3)** | **Deliberately different, documented.** A live web punch on a locked day *does* write a `TimeLog` — `TimeLog` is an append-only event log and a locked `AttendanceDay` is what is protected. `deriveRange` then ignores the day. This is already true of every Discord punch today, so Phase 3 introduces no new asymmetry. The import is stricter *on purpose*: a backlog row that wrote punches into a locked day would silently resurrect on the next unlock, which is exactly the "quietly undo real work" failure the SPEC forbids. Assert this asymmetry in B8's comment so a future reader does not "fix" it. |
| Import refuses `manuallyEdited` days | `deriveRange:251`, `resetDayToDerived` clears the flag | **Yes.** |
| Food-service org gate | `load` vs the **form action** | **Both must gate.** A `load`-only gate is bypassed by a direct POST. §2.4 gates the action; the UI visibility (`data.showAmPm`) is cosmetic only. |
| Food-service org gate | The **CSV export** and the **attendance page** (Phase 1 §1.5/§1.6) | Those are read surfaces showing null columns to a non-food-service org — no gate needed, but they are flagged off anyway. |
| `MANAGE_HR` boundary | Every sibling attendance action (`derive`, `correct`, `lock`, `deriveTeam`, `lockTeam` — all `MANAGE_HR`) | **Consistent.** Import is a write of the same class, so `MANAGE_HR` is the right door, not `OVERRIDE_FINALIZED`. |

**Every writer of the state each guard reads:** `isLocked` is written only by `lockRange`
(`index.ts:568`) and `unlockRange` (`:597`). `manuallyEdited` is written only by `correctDay`
(`:501`, sets true) and `resetDayToDerived` (`:538`, sets false). `TimeLog` is written by
`recordPunch` (`timelog.ts:69`), `aggregateTimeLogsToTimesheet` (`:294`, stamps `timesheetId`
only), `scripts/seed-punches-demo.ts:161`, and — new — `importBacklog`. That is the complete set
from the RESEARCH map §3; no fourth writer exists.

## 2.7 Phase 2 blast radius

| Surface | Affected? | Why |
|---|---|---|
| `prisma/schema.prisma` `TimeLog` | **YES** | 1 nullable column + 1 unique index |
| `package.json` / lockfile | **YES** | `papaparse` + `@types/papaparse` |
| `attendance/+page.server.ts` | **YES** | 1 new action, `toFail` allow-list widened |
| `attendance/+page.svelte` | **YES** | 1 upload form + result summary |
| new `attendance/import.ts` | **YES** | new file |
| `recordPunch` (`timelog.ts:26`) | No | Import writes via `createMany`, not `recordPunch` — deliberately, because the Discord path's `previous`-punch read and per-punch audit are wrong for a 2000-row batch |
| `@@unique([discordMessageId, employeeId])` | No | Untouched; `dedupKey` is a separate index |
| `pairPunchesToDailyHours` / `previewTimeLogAggregation` / `aggregateTimeLogsToTimesheet` | **Indirectly** | They read `TimeLog` rows and will now see `MANUAL`-sourced backlog punches. This is **correct and intended** — a backlog punch is a real punch. No code change; note it in the phase report. |
| `api/v1/timesheets/[id]/punches` | **Indirectly** | Will list backlog punches. Already gated by `canTouchEmployee`. No change. |
| `storage.ts`, `sniffMime`, `ALLOWED_MIME` | **No — explicitly** | The CSV never hits disk |
| `reports.ts` `exportToCSV` | No | Write side unchanged |

Risk class: **schema change + new dependency + new write path**. Files changed: 4 + 1 new
service + 3 new test files.

## 2.8 Phase 2 gate

```bash
pnpm db:push && pnpm prisma generate
pnpm format:check && pnpm lint && pnpm check && pnpm test
```

All four exit 0, and `tests/unit/timelog-aggregate.test.ts` must still be green untouched.

## 2.9 Phase 2 rollback

Code: revert the phase-2 commits; `pnpm remove papaparse @types/papaparse`.
Data: backlog punches are identifiable and reversible —
`DELETE FROM time_logs WHERE dedup_key LIKE 'backlog:%';` then re-run Refresh on the affected
range to re-derive. The audit summary row is retained deliberately.
Schema: `ALTER TABLE time_logs DROP COLUMN dedup_key;` (drops the unique index with it). Do this
**only** after Phase 3 is also reverted — Phase 3 shares the column.

---

# PHASE 3 — #177 web punch with location

**Depends on Phase 2** for `TimeLog.dedupKey`, which the web punch reuses as its debounce key.

## 3.1 `prisma/schema.prisma` — `TimeLog` location columns

**Change:** add four nullable columns after `dedupKey`.

```prisma
  // #177 — captured from navigator.geolocation at the moment of a WEB punch, and only there.
  // Null for every DISCORD and MANUAL punch by construction. Sensitive personal data: it is
  // readable ONLY through GET /api/v1/timesheets/:employeeId/punches, which is already gated by
  // `canTouchEmployee` (owner, their manager, branch manager, org HR). Retention follows the
  // TimeLog row itself — no separate purge window (Decision 5).
  latitude          Float?
  longitude         Float?
  locationAccuracyM Float?
  locationCapturedAt DateTime?
```

`Float?` (Postgres `double precision`) rather than `Decimal`: these are never money and never
summed, so the `Decimal`-serialization hook in `src/hooks.ts` does not need to know about them.
Run the Prisma command sequence.

## 3.2 `src/lib/server/services/timelog.ts` — refactor `recordPunch`

Current signature (`timelog.ts:26-44`):

```ts
export async function recordPunch(
	input: {
		discordId: string
		punchType: 'IN' | 'OUT'
		timestamp: Date
		discordMessageId?: string
		source?: PunchSource
	},
	meta?: { ipAddress?: string }
) {
	const employee = await db.employee.findUnique({
		where: { discordId: input.discordId },
		include: { user: { select: { id: true, roles: true, isActive: true } } }
	})

	if (!employee || !employee.user.isActive || employee.employmentStatus !== 'ACTIVE') {
		error(404, 'No active employee is linked to this Discord account')
	}
```

**Change — only employee resolution and the dedup key vary.** Widen the input to a discriminated
resolution and add the two new optional groups:

```ts
export async function recordPunch(
	input: {
		/** Exactly one of these two. Discord resolves by discordId; the web punch resolves by the
		 *  session's own employee id, which the caller has already derived from locals.user. */
		discordId?: string
		employeeId?: string
		punchType: 'IN' | 'OUT'
		timestamp: Date
		discordMessageId?: string
		/** #200/#177 idempotency key for punches with no Discord message. See TimeLog.dedupKey. */
		dedupKey?: string
		source?: PunchSource
		location?: { latitude: number; longitude: number; accuracyM?: number } | null
	},
	meta?: { ipAddress?: string }
)
```

Body changes, in order:

1. Replace the `findUnique` with a branch:

```ts
	const employee = input.employeeId
		? await db.employee.findUnique({
				where: { id: input.employeeId },
				include: { user: { select: { id: true, roles: true, isActive: true } } }
			})
		: await db.employee.findUnique({
				where: { discordId: input.discordId! },
				include: { user: { select: { id: true, roles: true, isActive: true } } }
			})

	if (!employee || !employee.user.isActive || employee.employmentStatus !== 'ACTIVE') {
		error(404, input.employeeId
			? 'No active employee record is linked to this account'
			: 'No active employee is linked to this Discord account')
	}
```

2. Generalise the pre-check at `timelog.ts:59-65`. It currently keys only on
   `discordMessageId`; extend it to also cover `dedupKey`, preserving the existing comment:

```ts
	if (input.discordMessageId || input.dedupKey) {
		const duplicate = await db.timeLog.findFirst({
			where: {
				employeeId: employee.id,
				...(input.discordMessageId
					? { discordMessageId: input.discordMessageId }
					: { dedupKey: input.dedupKey })
			},
			select: { id: true }
		})
		if (duplicate) error(409, 'This punch has already been recorded')
	}
```

3. Extend the `create` (`timelog.ts:69-77`):

```ts
			data: {
				employeeId: employee.id,
				punchType: resolvedType,
				source: input.source ?? 'DISCORD',
				timestamp: input.timestamp,
				discordMessageId: input.discordMessageId,
				dedupKey: input.dedupKey,
				...(input.location
					? {
							latitude: input.location.latitude,
							longitude: input.location.longitude,
							locationAccuracyM: input.location.accuracyM ?? null,
							locationCapturedAt: new Date()
						}
					: {})
			}
```

4. The `P2002` catch (`:81-83`) already covers **both** unique constraints — no change, but add
   `(discordMessageId | dedupKey)` to its comment.
5. The audit call (`:87-100`) gains one field in `newValue`:
   `hasLocation: Boolean(input.location)`. **Do not put the coordinates in the audit row** — the
   audit log has a different read gate than the punch API, and #242 already recorded a case where
   the audit log bypassed a masking rule on this repo. `hasLocation` is enough to investigate.

The Discord route (`api/v1/timesheets/log/+server.ts:47-56`) passes `discordId` and no
`dedupKey`/`location`, so it is **unchanged** and Discord punches keep carrying no location.
Verify this by diff: that file should have **zero** lines changed in Phase 3.

## 3.3 New route — `src/routes/(app)/punch/+page.server.ts`

```ts
export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!                       // (app) layout already requires a session
	requireFoodServiceOrg(user.organizationId)      // 404 for Veent — the page does not exist
	const me = await db.employee.findUnique({
		where: { userId: user.id },
		select: { id: true, firstName: true, lastName: true }
	})
	if (!me) error(404, 'No employee record is linked to your account')
	const recent = await listPunches(me.id, { from: new Date(Date.now() - 7 * 86_400_000) })
	return { employeeName: `${me.firstName} ${me.lastName}`, recent }
}
```

**The exact guard, stated for the record.** This route is **session-authenticated, not HMAC**.
Three layers, all server-side:

1. `locals.user` must exist — enforced by the `(app)` group hook, the same gate every other
   authenticated page uses. There is no HMAC signature and `TIMELOG_API_SECRET` is not read here.
2. `requireFoodServiceOrg(user.organizationId)` → 404 for a non-food-service tenant, in **both**
   `load` and the action (a `load`-only gate is bypassed by a direct POST).
3. **The employee id is resolved from `locals.user.id`, never from the form.** There is no
   `employeeId` field in the punch form and the action must never read one. This is what makes
   the route safe without a new capability: an authenticated user can only ever punch as
   themselves, so no `MANAGE_HR` / `VIEW_TEAM` check is needed or wanted. If a future change
   adds punch-on-behalf-of, it needs `assertCanModifyTimesheet`-style scoping
   (`timesheets.ts:117-126`) — say so in a comment.

Action:

```ts
const punchSchema = z.object({
	punchType: z.enum(['IN', 'OUT']),
	latitude: z.coerce.number().min(-90).max(90).optional(),
	longitude: z.coerce.number().min(-180).max(180).optional(),
	accuracyM: z.coerce.number().min(0).optional()
})

export const actions: Actions = {
	punch: async (event) => {
		const user = event.locals.user!
		requireFoodServiceOrg(user.organizationId)
		const me = await db.employee.findUnique({ where: { userId: user.id }, select: { id: true } })
		if (!me) return fail(404, { error: 'No employee record is linked to your account' })

		const raw = Object.fromEntries(await event.request.formData())
		// The punchType is the only REQUIRED field. Location is parsed separately and a failure
		// there is discarded, never surfaced — criterion 7: a location problem must never cost
		// the employee their punch.
		const type = z.enum(['IN', 'OUT']).safeParse(raw.punchType)
		if (!type.success) return fail(400, { error: 'Invalid punch type' })
		const loc = punchSchema.safeParse(raw)
		const location =
			loc.success && loc.data.latitude !== undefined && loc.data.longitude !== undefined
				? { latitude: loc.data.latitude, longitude: loc.data.longitude, accuracyM: loc.data.accuracyM }
				: null

		// Debounce key: one punch per employee per punchType per PHT minute. A double-tap or a
		// double-submit collapses to one row via the same 409 the Discord replay defence uses.
		const now = new Date()
		const dedupKey = `web:${me.id}:${type.data}:${now.toISOString().slice(0, 16)}`

		try {
			await recordPunch(
				{ employeeId: me.id, punchType: type.data, timestamp: now, dedupKey, source: 'WEB', location },
				{ ipAddress: event.getClientAddress() }
			)
		} catch (e) {
			return toFail(e)
		}
		return { punched: type.data, hadLocation: Boolean(location) }
	}
}
```

Note `source: 'WEB'` — the first writer of that enum value, which has existed unused since the
schema was written (`schema.prisma:214`).

## 3.4 New page — `src/routes/(app)/punch/+page.svelte`

Minimal. Two buttons (`Punch In` / `Punch Out`), a status line, and the last 7 days of the
employee's own punches with their location where present.

Client behaviour, exact:

```svelte
<script lang="ts">
	let lat = $state('')
	let lng = $state('')
	let acc = $state('')
	let locStatus = $state('Location not requested')

	// Fill the three hidden fields, then submit — with a hard watchdog. `navigator.geolocation`
	// does not exist on an insecure origin, so the non-HTTPS case takes the same branch as a
	// denied permission: submit with empty fields. The punch is NEVER blocked (criterion 7-10).
	function withLocation(form: HTMLFormElement) {
		if (!('geolocation' in navigator)) {
			locStatus = 'Location unavailable — punching without it'
			form.requestSubmit()
			return
		}
		let done = false
		const go = (msg: string) => {
			if (done) return
			done = true
			locStatus = msg
			form.requestSubmit()
		}
		setTimeout(() => go('Location timed out — punching without it'), 9000)
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				lat = String(pos.coords.latitude)
				lng = String(pos.coords.longitude)
				acc = String(Math.round(pos.coords.accuracy))
				go(`Location captured (±${acc} m)`)
			},
			() => go('Location unavailable — punching without it'),
			{ enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
		)
	}
</script>
```

The watchdog (9 s) is deliberately longer than the API timeout (8 s) so the normal path is the
API's own error callback and the watchdog only catches a browser that never calls back at all.

Display rule for accuracy (criterion 9): render
`{lat}, {lng} (±{locationAccuracyM} m)` when accuracy is present, and
`{lat}, {lng} (accuracy unknown)` when it is not. Never render bare coordinates without an
accuracy qualifier — that is the "silently presented as precise" failure the SPEC forbids.

Nav: add a `Punch` link to `(app)/+layout.svelte` guarded by `isFoodServiceOrg`, alongside the
existing food-service-only entries at `+layout.svelte:26` and `:30`. Cosmetic only — §3.3 layer 2
is the enforcement.

## 3.5 Location visibility — every surface, confirmed

| Surface | Shows location? | Gate |
|---|---|---|
| `GET /api/v1/timesheets/[id]/punches` (`+server.ts:43`, returns raw `TimeLog` rows) | **Yes** | `canTouchEmployee(user, employeeId)` at `:33` → owner, their manager, branch manager, org HR. Already correct after #282; **no change needed**. |
| `/punch` page own history | **Yes — the employee's own** | `listPunches(me.id, …)` where `me` came from `locals.user.id`. This is the explicit self-visibility Decision 5 requires. |
| Attendance page + attendance CSV export | **No** | They read `AttendanceDay`, which has no location column. Deliberate — a CSV that leaves the building is the wrong place for coordinates. |
| Audit log | **No** | Only `hasLocation: boolean` (§3.2 step 5). #242 recorded the audit log bypassing a masking rule on this repo; do not repeat it. |
| Timesheets / payroll / payslip / dashboard / reports | **No** | None of them read `TimeLog` columns beyond `punchType`/`timestamp`/`timesheetId` |

`listPunches` (`timelog.ts:111-126`) has exactly two callers — the punches API and (new) the
punch page — both listed above. Confirm with `grep -rn "listPunches" src/` before Phase 3 gate;
if a third caller has appeared, it must be gated before merge.

## 3.6 Phase 3 tests

New `tests/unit/punch-location-capture.test.ts` (mocks `$lib/server/db` + `$lib/server/audit`,
tests `recordPunch` directly):

| # | Spec | Asserts (criterion) |
|---|---|---|
| C1 | `recordPunch` with `employeeId` + location | `timeLog.create` `data` has `source: 'WEB'`, `latitude`, `longitude`, `locationAccuracyM`, `locationCapturedAt` (6, 12) |
| C2 | `recordPunch` with `discordId`, no location | `data.latitude` is `undefined`; `source: 'DISCORD'`; **`data` has no location keys at all** (12) |
| C3 | `recordPunch` with `employeeId`, `location: null` | punch created, no location keys, no throw (7) |
| C4 | Employee resolution | with `employeeId` the `where` is `{ id }`; with `discordId` the `where` is `{ discordId }` — asserted via `mockImplementation` branching on the where shape, not a flat mock |
| C5 | Same `dedupKey` twice | second call throws 409; `create` called once (idempotency) |
| C6 | `P2002` thrown by `create` | mapped to 409, not a 500 |

New `tests/unit/punch-location-route.test.ts` (imports the `actions` **export** from
`punch/+page.server.ts`):

| # | Spec | Asserts (criterion) |
|---|---|---|
| C7 | No `latitude`/`longitude` in the form | `recordPunch` called with `location: null`, action returns success, **not** a `fail` (7, 10) |
| C8 | `latitude: '999'` (out of range) / `latitude: 'abc'` | `location: null`, punch still succeeds — a bad location never becomes a 400 (7, 9) |
| C9 | Valid location, no `accuracyM` | `accuracyM: undefined` passed through, punch succeeds (9) |
| C10 | Form containing `employeeId: 'someone-else'` | the action ignores it; `recordPunch` receives the id resolved from `locals.user.id` (the self-scoping guard) |
| C11 | User in `org_veent` | throws 404; `recordPunch` never called (12, 20 — negative control) |
| C12 | User in `org_jojo` with no `Employee` row | `fail(404)`, no throw, `recordPunch` never called |

New `tests/e2e/timesheet-punch-location.spec.ts` (hybrid; extends the existing
`tests/e2e/timesheet-punch.spec.ts` pattern): log in as a seeded JoJo employee, grant geolocation
via Playwright's `context.grantPermissions(['geolocation'])` + `setGeolocation`, click
**Punch In**, and assert the recorded punch row on the page shows a coordinate with an accuracy
qualifier. A second case revokes the permission and asserts the punch still succeeds.

### Mutation checks — Phase 3

| Guard | Mutation that must turn it RED | Test |
|---|---|---|
| Discord carries no location | Add `location` to the Discord route's `recordPunch` call | C2 |
| Location never blocks the punch | Change the action to `return fail(400)` when `loc.success === false` | C7, C8 |
| Self-scoping | Read `employeeId` from the form instead of `locals.user.id` | C10 |
| Org gating on the action | Delete `requireFoodServiceOrg` from the **action** (leave it in `load`) | C11 |
| Web dedup | Drop `dedupKey` from the action | C5 |
| Coordinates stay out of the audit | Put `latitude` into the audit `newValue` | add an explicit assertion in C1: `writeAuditLog`'s `newValue` has no `latitude` key |

Same vacuous-mock warning as §2.7: C4 and C10 are exactly the assertions a flat
`mockResolvedValue` makes meaningless. Branch on `where`.

## 3.7 Twin-door analysis — Phase 3

| Guard | Its twin | Covered? |
|---|---|---|
| `requireFoodServiceOrg` in `load` | `requireFoodServiceOrg` in the **action** | **Yes — both, §3.3.** C11 asserts the action. |
| Self-scoping on the punch action | The punches **read** API | **Yes, pre-existing** — `canTouchEmployee` (`punches/+server.ts:33`). |
| Location only on WEB punches | The Discord route | **Yes** — that file has zero changed lines; C2 pins it. |
| Location only on WEB punches | The **backlog import** (Phase 2) | **Yes** — `importBacklog` builds its records literally and never sets a location field. Add an assertion to B6: no record in `createMany` has a `latitude` key. |
| Web punch respects locked days | See §2.6 row 3 — **deliberately does not**, matching Discord | Documented, not a gap. |

## 3.8 Phase 3 blast radius

| Surface | Affected? | Why |
|---|---|---|
| `prisma/schema.prisma` `TimeLog` | **YES** | 4 nullable columns |
| `timelog.ts` `recordPunch` | **YES** | Signature widened; **behaviour for the existing Discord caller is unchanged** — C2 is the proof |
| `api/v1/timesheets/log/+server.ts` | **No — zero lines** | Verify by diff |
| new `(app)/punch/*` | **YES** | New route, 2 files |
| `(app)/+layout.svelte` | **YES** | 1 nav link |
| `api/v1/timesheets/[id]/punches` | **Indirectly** | Returns 4 more (usually null) fields; already gated |
| `pairPunchesToDailyHours`, `deriveAttendanceDay`, `deriveRange` | No | Read `punchType`/`timestamp` only — a WEB punch is just a punch, and it flows into AM/PM derivation for free |
| `src/hooks.ts` `Decimal` transport hook | No | `Float`, not `Decimal` |
| `storage.ts` | No | No files |

Risk class: **schema change + new public surface + sensitive personal data**. Files changed:
4 + 2 new route files + 3 new test files.

## 3.9 Phase 3 gate

```bash
pnpm db:push && pnpm prisma generate
pnpm format:check && pnpm lint && pnpm check && pnpm test
pnpm test:e2e                    # hybrid: needs ./start.sh + pnpm db:seed:e2e
grep -rn "listPunches" src/      # must return exactly 2 call sites
git diff --stat src/routes/api/v1/timesheets/log/+server.ts   # must be empty
```

## 3.10 Phase 3 rollback

Code: revert the phase-3 commits. The `recordPunch` signature widening is backward-compatible, so
a partial revert (page only, service kept) is also safe.
Data: `DELETE FROM time_logs WHERE source = 'WEB';` removes every web punch and its location in
one statement — the `source` column is the clean seam.
Schema: `ALTER TABLE time_logs DROP COLUMN latitude, DROP COLUMN longitude, DROP COLUMN location_accuracy_m, DROP COLUMN location_captured_at;`

---

## Manual Test Script

Run **after** all three phases are green. Every step names the exact control, plants a findable
marker, and asserts something **positive**. "The card is absent" proves nothing.

### Harness

```bash
./start.sh                      # Postgres on 5434
pnpm db:seed                    # or db:seed:e2e
pnpm dev                        # http://localhost:5173
```

Cookie jar login (dev-only route, `src/routes/api/v1/_dev/login-as/+server.ts` — 404s outside
`dev`):

```bash
J=/tmp/jar.txt; rm -f $J
curl -s -c $J -X POST http://localhost:5173/api/v1/_dev/login-as \
  -H 'content-type: application/json' \
  -d '{"email":"hr@jojopotato.test"}'          # substitute the seeded JoJo HR email
```

psql — **the container runs Postgres on 5434 inside the container too**, so the port flag is
required on both sides:

```bash
docker exec -i veent-db-5434 psql -U veent -d veent_hris -p 5434 -c "…"
```

Table names are **snake_case**: `attendance_days`, `time_logs`, `audit_logs`, `employees`,
`organizations`.

### M1 — AM/PM split appears for JoJo (criterion 1)

1. Plant the marker — four punches on one date for a known JoJo employee:

```bash
EMP=$(docker exec -i veent-db-5434 psql -U veent -d veent_hris -p 5434 -tAc \
  "select id from employees where employee_number='JJ-0001'")
docker exec -i veent-db-5434 psql -U veent -d veent_hris -p 5434 -c \
"insert into time_logs (id,employee_id,punch_type,source,timestamp,created_at) values
 ('mtest-ampm-1','$EMP','IN','MANUAL','2026-08-10 00:00:00+00',now()),
 ('mtest-ampm-2','$EMP','OUT','MANUAL','2026-08-10 03:00:00+00',now()),
 ('mtest-ampm-3','$EMP','IN','MANUAL','2026-08-10 05:00:00+00',now()),
 ('mtest-ampm-4','$EMP','OUT','MANUAL','2026-08-10 09:00:00+00',now());"
```

(UTC times = PHT 08:00, 11:00, 13:00, 17:00.)

2. Open `/attendance`, select employee `JJ-0001`, set the range to cover 2026-08-10, click the
   **Refresh** button (the `derive` action).
3. **Assert positively:** the row for 2026-08-10 shows **AM In 08:00, AM Out 11:00, PM In 13:00,
   PM Out 17:00**, and the existing **In** column reads **08:00** and **Out** reads **17:00**.
4. Confirm on disk:

```bash
docker exec -i veent-db-5434 psql -U veent -d veent_hris -p 5434 -c \
"select time_in, time_out, am_time_in, am_time_out, pm_time_in, pm_time_out
 from attendance_days where employee_id='$EMP' and date='2026-08-10';"
```

Expect six non-null timestamps, with `time_in = am_time_in` and `time_out = pm_time_out`.

### M2 — Veent is untouched (criteria 2, 20)

1. `curl -c /tmp/jar2.txt … -d '{"email":"hr@veent.test"}'`, open `/attendance`.
2. **Assert positively:** the table header row reads exactly
   `Date | Status | In | Out | Reg | OT | Night | Late/UT` — count the `<th>`s; there are **no**
   AM/PM headers.
3. Click **Export CSV**. **Assert positively:** the first line of the downloaded file is
   `Date,Status,Time In,Time Out,Regular Hrs,OT Hrs,Night Diff Hrs,Late Min,Undertime Min,Locked`
   — 10 fields, no `AM In`.
4. As JoJo HR, click **Export CSV**. **Assert positively:** the header line contains
   `Time Out,AM In,AM Out,PM In,PM Out,Regular Hrs` in that order — 14 fields.

### M3 — Backlog import applies rows (criterion 13)

Prepare `/tmp/backlog.csv`:

```
employeeNumber,date,amIn,amOut,pmIn,pmOut
JJ-0002,2026-08-11,08:05,11:30,13:15,17:20
JJ-0002,2026-08-12,08:00,12:00,,
```

1. As JoJo HR on `/attendance`, click **Import backlog CSV**, choose the file, submit.
2. **Assert positively:** the page shows **"Applied 2 rows, skipped 0 duplicates, rejected 0
   rows"**.
3. Confirm the punches and the derived day:

```bash
docker exec -i veent-db-5434 psql -U veent -d veent_hris -p 5434 -c \
"select punch_type, timestamp, source, dedup_key from time_logs
 where dedup_key like 'backlog:JJ-0002:2026-08-11%' order by timestamp;"
```

Expect **4 rows**, all `source = MANUAL`, keys ending `:amIn`, `:amOut`, `:pmIn`, `:pmOut`.

```bash
docker exec -i veent-db-5434 psql -U veent -d veent_hris -p 5434 -c \
"select am_time_in, pm_time_out, worked_hours from attendance_days
 where date='2026-08-11' and employee_id=(select id from employees where employee_number='JJ-0002');"
```

Expect `am_time_in` 08:05 PHT and a non-zero `worked_hours`.

### M4 — Re-upload is a no-op (criterion 16)

1. Upload **the same** `/tmp/backlog.csv` again.
2. **Assert positively:** the summary reads **"Applied 0 rows, skipped 2 duplicates, rejected 0
   rows"**.
3. Confirm no duplicates were written:

```bash
docker exec -i veent-db-5434 psql -U veent -d veent_hris -p 5434 -c \
"select count(*) from time_logs where dedup_key like 'backlog:JJ-0002:%';"
```

Expect exactly **6** (4 + 2), the same number as after M3.

### M5 — Locked day is refused, loudly (criterion 15)

1. On `/attendance` for `JJ-0002`, set the range to 2026-08-13 → 2026-08-13 and click **Lock**.
2. Prepare `/tmp/backlog-locked.csv` with one row: `JJ-0002,2026-08-13,08:00,12:00,13:00,17:00`.
3. Upload it.
4. **Assert positively:** the summary reads **"Applied 0 rows, skipped 0 duplicates, rejected 1
   row"** and the expandable reason list contains the literal text **"this day is locked"** with
   line number 2.
5. Confirm nothing was written:

```bash
docker exec -i veent-db-5434 psql -U veent -d veent_hris -p 5434 -c \
"select count(*) from time_logs where dedup_key like 'backlog:JJ-0002:2026-08-13%';"
```

Expect **0**.

### M6 — Hand-corrected day is refused (criterion 15, the twin)

Repeat M5 for 2026-08-14 but instead of Lock, edit the **Time In** cell for that row to `09:00`
and submit the **Save** button on that row (the `correct` action). Then upload a backlog row for
2026-08-14. **Assert positively:** rejected with **"this day was hand-corrected by HR"**, and
`select manually_edited from attendance_days where date='2026-08-14' …` returns `t`.

### M7 — Import is refused for Veent and for a non-HR user (criterion 18, 20)

1. As Veent HR, `/attendance` — **assert positively:** the **Import backlog CSV** control is not
   rendered, **and** the direct POST is refused:

```bash
curl -s -b /tmp/jar2.txt -o /dev/null -w '%{http_code}\n' \
  -X POST 'http://localhost:5173/attendance?/importBacklog' \
  -F 'backlog=@/tmp/backlog.csv'
```

Expect **404**.

2. As a JoJo rank-and-file employee (`login-as` a seeded EMPLOYEE), run the same curl.
   Expect **403**.

### M8 — Web punch records location (criteria 6, 11)

1. As a JoJo employee, open `http://localhost:5173/punch`.
   *(Geolocation needs a secure context; `localhost` counts as secure in Chrome and Firefox, so
   no TLS setup is needed for this step.)*
2. Click **Punch In**. Grant the browser's location prompt.
3. **Assert positively:** the status line reads **"Location captured (±N m)"** and the punch
   appears in the "Recent punches" list with a coordinate pair followed by **"(±N m)"**.
4. Confirm on disk:

```bash
docker exec -i veent-db-5434 psql -U veent -d veent_hris -p 5434 -c \
"select punch_type, source, latitude, longitude, location_accuracy_m, dedup_key
 from time_logs where source='WEB' order by created_at desc limit 1;"
```

Expect `source = WEB`, non-null latitude/longitude, and a `dedup_key` starting `web:`.

### M9 — Denying location still punches (criteria 7, 8)

1. In the browser site settings, **Block** location for `localhost`. Reload `/punch`.
2. Click **Punch Out**.
3. **Assert positively:** the page shows **"Punched OUT"** and the status line reads **"Location
   unavailable — punching without it"**. There is **no** error banner and **no** retry prompt.
4. Confirm the row exists with nulls:

```bash
docker exec -i veent-db-5434 psql -U veent -d veent_hris -p 5434 -c \
"select punch_type, source, latitude from time_logs where source='WEB' order by created_at desc limit 1;"
```

Expect one row, `punch_type = OUT`, `latitude` null.

### M10 — Discord punches still carry no location (criterion 12)

Send a signed punch through the existing HMAC endpoint (reuse the harness in
`tests/e2e/timelog-replay.spec.ts`), then:

```bash
docker exec -i veent-db-5434 psql -U veent -d veent_hris -p 5434 -c \
"select count(*) from time_logs where source='DISCORD' and latitude is not null;"
```

**Assert positively:** the count is **0**.

### M11 — Location is not visible to a stranger (criterion 11)

As a JoJo MANAGER who does **not** manage the employee from M8:

```bash
curl -s -b /tmp/jar3.txt -o /dev/null -w '%{http_code}\n' \
  "http://localhost:5173/api/v1/timesheets/$EMP/punches"
```

Expect **403**. Then as that employee themselves, expect **200** and a body whose first punch
object contains a `latitude` key with a number — the explicit self-visibility Decision 5 requires.

### Cleanup

```bash
docker exec -i veent-db-5434 psql -U veent -d veent_hris -p 5434 -c \
"delete from time_logs where id like 'mtest-%' or dedup_key like 'backlog:JJ-000%' or source='WEB';"
```

---

## Risks — what goes wrong and is expensive to unwind

**R1 — A silently wrong AM/PM boundary (highest).** A plausible-but-wrong split produces a number
nobody questions. It could ship for weeks and only surface as a payslip dispute.

- *Mitigation 1 (structural, and the reason this risk is survivable):* AM/PM is **display-only**
  by construction (D2). It is written to four columns nothing reads. `workedHours` and every
  hour bucket are computed from `netIntervals` exactly as before, and test A1 asserts
  `workedHours` is **identical** with the flag on and off. A wrong boundary can therefore never
  reach a payslip. If a future change makes payroll read `amTimeIn`, this mitigation evaporates —
  say so in the schema comment (§1.1 does).
- *Mitigation 2:* `MIN_AM_PM_GAP_MS` prevents the most likely wrong answer (splitting one block
  at a re-punch). Test A4 pins it.
- *Mitigation 3:* the invariant test A8 — `amTimeIn === timeIn` and `pmTimeOut === timeOut` —
  catches any boundary logic that has drifted away from the punches it claims to describe.
- *Mitigation 4:* M1 is a positive manual assertion of four specific clock times, not "the
  columns look populated."

**R2 — `correctDay` silently clearing a split.** An HR user editing one number on a row wipes its
AM/PM. Handled by making it explicit and recoverable (§1.3c: read-only AM/PM cells, a comment in
the service, and `resetDay` as the documented recovery). Verified by M6.

**R3 — A backlog row writing punches into a day that is later unlocked.** If the import wrote
`TimeLog` rows for a locked day, unlocking would resurrect them silently at the next derive.
Prevented by rejecting **before** the write (§2.3e step 5), not after. Verified by M5's count of 0.

**R4 — Column-set drift in the CSV export.** `exportToCSV` reads headers from `rows[0]` only
(`reports.ts:626`). A conditional key added to some rows but not others silently drops columns
for the rest of the file. Prevented by the `amPmCols(...)` spread being applied to every row
including nulls (§1.6). Verified by M2 step 4 counting fields.

**R5 — Location leaking to a surface that is not attendance-gated.** Mitigated by keeping
location off `AttendanceDay` entirely (so it cannot reach the CSV export, the payslip, or
reports), keeping coordinates out of the audit row, and the pre-gate `grep -rn "listPunches"`
check (§3.9). #242 on this repo is the precedent for the audit-log bypass specifically.

**R6 — A stale Prisma client faking a broken build.** Three prior occurrences. Mitigated by the
mandatory `pnpm prisma generate` step and the explicit note in §Prisma Contract.

**R7 — `papaparse` supply chain.** One new production dependency. Mitigated by pinning the exact
version in the lockfile, by the fact that the parser never touches disk or `eval`, and by
`sanitizeCell` treating every parsed cell as hostile.

**R8 — Phase coupling.** Phase 2 and 3 share `TimeLog.dedupKey`. Rolling back Phase 2's schema
while Phase 3 is live breaks the web punch. Recorded in §2.9.

---

## Acceptance Criteria

The 20 testable criteria are owned by
`timesheet-capture-162-177-200_SPEC_17-08-26.md` §Acceptance Criteria and are not restated here.
Every one of them is mapped to a named gate in `## Verification Evidence` below; that table is
the criterion-to-gate index. This plan is complete only when all 20 rows in that table are green
or carry an explicit, backlogged known-gap entry.

Plan-level acceptance, in addition to the SPEC's 20:

1. No Prisma enum value is added or renamed; no `scripts/migrate-*.ts` is created.
2. `git diff --stat src/routes/api/v1/timesheets/log/+server.ts` is empty after Phase 3.
3. No pre-existing test file under `tests/unit/` or `tests/e2e/` is edited to make a new change
   pass. If one must change, Decision 1 has been violated — stop and escalate.
4. `grep -rn "listPunches" src/` returns exactly 2 call sites after Phase 3.
5. Each of the three phases is a separate commit, so a phase can be reverted independently.

## Phase Completion Rules

A phase is **CODE DONE** when its file-by-file steps are implemented. A phase is **VERIFIED**
only when all of the following hold, in order:

1. `pnpm db:push && pnpm prisma generate` ran without error (phases that change the schema).
2. `pnpm format:check` → `pnpm lint` → `pnpm check` → `pnpm test` each exit 0, run in that
   order. CI stops at the first failure; so does this gate. `pnpm lint` does **not** run
   `format:check`.
3. Every new unit spec in the phase's test table is green.
4. Every pre-existing suite in the phase's blast radius is green **without edits**.
5. Every mutation check in the phase's mutation table has been applied by hand, confirmed RED,
   and reverted. An unconfirmed mutation check means the guard is unproven.
6. Phase 3 additionally requires `pnpm test:e2e` green and the manual script M1–M11 executed with
   its positive assertions recorded.

**Code-only completion is `CODE DONE`, never `VERIFIED`.** Do not start the next phase from a
`CODE DONE` predecessor — the phases are sequentially gated because Phase 2 writes punches that
Phase 1's derive path must already handle, and Phase 3 reuses a column Phase 2 adds.

## Implementation Checklist

Phase 1 — #162:

1. `prisma/schema.prisma` — add `amTimeIn`, `amTimeOut`, `pmTimeIn`, `pmTimeOut` (all
   `DateTime?`) to `model AttendanceDay` after `timeOut`, with the invariant comment (§1.1).
2. Run `pnpm db:push && pnpm prisma generate`.
3. `derive.ts` — add `splitAmPm?: boolean` to `DeriveInput` (§1.2a).
4. `derive.ts` — add the four `Date | null` fields to `AttendanceDayResult` and to
   `emptyResult()` (§1.2b).
5. `derive.ts` — add `MIN_AM_PM_GAP_MS` and the `splitAmPmBlocks()` post-pass (§1.2c).
6. `derive.ts` — call `splitAmPmBlocks` under `if (input.splitAmPm)` after
   `result.timeOut = lastOut` (§1.2d).
7. `attendance/index.ts` — import `isFoodServiceOrg`; hoist `splitAmPm` in `deriveRange`; pass it
   to `deriveAttendanceDay`; add the four fields to `data` (§1.3b).
8. `attendance/index.ts` — pass `splitAmPm` in `correctDay`; add the four fields to `write`; add
   the collapse comment (§1.3c).
9. `attendance/+page.server.ts` — return `showAmPm` from `load` (§1.4).
10. `attendance/+page.svelte` — add 4 headers and 4 read-only cells to **both** tables; fix every
    affected `colspan` (§1.5).
11. `attendance/export/+server.ts` — add the `amPmCols()` helper and spread it into **every** row
    in both branches (§1.6).
12. Write `tests/unit/attendance-am-pm-split.test.ts` (A1–A8).
13. Write `tests/unit/payroll-am-pm-days-of-work.test.ts`.
14. Write `tests/unit/hours-engine-parity-am-pm.test.ts`.
15. Run the §1.9 gate; run the §1.7 mutation checks; commit.

Phase 2 — #200:

16. `pnpm add papaparse && pnpm add -D @types/papaparse`.
17. `prisma/schema.prisma` — add `dedupKey String?` and `@@unique([dedupKey, employeeId])` to
    `model TimeLog` (§2.2); run `pnpm db:push && pnpm prisma generate`.
18. Create `src/lib/server/services/attendance/import.ts` with `MAX_IMPORT_BYTES`,
    `MAX_IMPORT_ROWS`, `sanitizeCell`, `parseBacklogCsv` (§2.3a–§2.3d).
19. Implement `importBacklog` following the exact 10-step order in §2.3e, with the three bulk
    queries and the single `$transaction`.
20. `attendance/+page.server.ts` — add the `importBacklog` action; widen `toFail` to
    `[400, 404, 409, 413, 415]` (§2.4).
21. `attendance/+page.svelte` — add the upload form and the result summary (§2.4).
22. Create `tests/fixtures/backlog/` with the four fixture CSVs.
23. Write `tests/unit/attendance-backlog-parse.test.ts` (B1–B5).
24. Write `tests/unit/attendance-backlog-import.test.ts` (B6–B12) using where-shape mocks.
25. Write `tests/unit/attendance-backlog-rbac.test.ts` (B13–B16) against the `actions` export.
26. Run the §2.8 gate; run the §2.5 mutation checks; commit.

Phase 3 — #177:

27. `prisma/schema.prisma` — add `latitude`, `longitude`, `locationAccuracyM` (`Float?`) and
    `locationCapturedAt` (`DateTime?`) to `model TimeLog` (§3.1); run
    `pnpm db:push && pnpm prisma generate`.
28. `timelog.ts` — widen the `recordPunch` input; branch employee resolution on
    `employeeId` vs `discordId`; enforce "exactly one of" (§3.2 step 1).
29. `timelog.ts` — generalise the duplicate pre-check to cover `dedupKey` (§3.2 step 2).
30. `timelog.ts` — write `dedupKey` and the conditional location block in `create` (§3.2 step 3).
31. `timelog.ts` — add `hasLocation` to the audit `newValue`; **no coordinates** (§3.2 step 5).
32. Create `src/routes/(app)/punch/+page.server.ts` — `load` + `punch` action, both gated
    (§3.3).
33. Create `src/routes/(app)/punch/+page.svelte` — buttons, `withLocation()` watchdog, recent
    punches with the accuracy qualifier (§3.4).
34. `(app)/+layout.svelte` — add the food-service-gated `Punch` nav link.
35. Write `tests/unit/punch-location-capture.test.ts` (C1–C6).
36. Write `tests/unit/punch-location-route.test.ts` (C7–C12).
37. Write `tests/e2e/timesheet-punch-location.spec.ts`.
38. Run the §3.9 gate (including the two `grep`/`git diff` assertions); run the §3.6 mutation
    checks; run the manual script M1–M11; commit.

---

## Touchpoints

| Path | Phase | Change |
|---|---|---|
| `prisma/schema.prisma` | 1, 2, 3 | 4 + 1 + 4 nullable columns, 1 unique index |
| `src/lib/server/services/attendance/derive.ts` | 1 | `splitAmPm` input, 4 result fields, `splitAmPmBlocks`, `MIN_AM_PM_GAP_MS` |
| `src/lib/server/services/attendance/index.ts` | 1 | `isFoodServiceOrg` import; `deriveRange` + `correctDay` pass the flag and persist 4 fields |
| `src/routes/(app)/attendance/+page.server.ts` | 1, 2 | `showAmPm` in `load`; `importBacklog` action; `toFail` allow-list |
| `src/routes/(app)/attendance/+page.svelte` | 1, 2 | 4 read-only columns × 2 tables; upload form + result summary |
| `src/routes/(app)/attendance/export/+server.ts` | 1 | 4 conditional CSV columns |
| `src/lib/server/services/attendance/import.ts` | 2 | **new** |
| `package.json` | 2 | `papaparse`, `@types/papaparse` |
| `src/lib/server/services/timelog.ts` | 3 | `recordPunch` employee resolution, `dedupKey`, location |
| `src/routes/(app)/punch/+page.server.ts` | 3 | **new** |
| `src/routes/(app)/punch/+page.svelte` | 3 | **new** |
| `src/routes/(app)/+layout.svelte` | 3 | 1 nav link |
| `tests/unit/*` (9 new files) | 1, 2, 3 | see per-phase test tables |
| `tests/e2e/timesheet-punch-location.spec.ts` | 3 | **new** |

**Read but not changed** (verify with `git diff --stat`): `src/lib/orgs.ts`, `src/lib/rbac.ts`,
`src/lib/server/rbac.ts`, `src/lib/server/audit.ts`, `src/lib/server/storage.ts`,
`src/lib/server/services/reports.ts`, `src/lib/server/services/attendance/input.ts`,
`src/lib/server/services/payroll/*`, `src/routes/api/v1/timesheets/log/+server.ts`,
`src/routes/api/v1/timesheets/[id]/punches/+server.ts`,
`src/lib/components/timesheets/TimesheetModal.svelte`.

## Public Contracts

| Contract | Change | Compatibility |
|---|---|---|
| `deriveAttendanceDay(input)` | `splitAmPm?: boolean` added (optional, defaults false); result gains 4 nullable `Date` fields | **Backward compatible.** Every existing caller and test compiles and behaves identically. |
| `recordPunch(input, meta)` | `discordId` becomes optional; `employeeId`, `dedupKey`, `location` added | **Backward compatible** for the one existing caller (the Discord route), which passes `discordId`. Enforce "exactly one of `discordId`/`employeeId`" at runtime with a clear throw. |
| `AttendanceDay` row shape (Prisma + API) | 4 nullable columns | Additive; every reader selects explicit fields or the whole row |
| `TimeLog` row shape | 5 nullable columns | Additive. **`GET /api/v1/timesheets/:id/punches` returns whole rows**, so its response gains 5 usually-null fields — the only externally visible response change in the cluster. |
| Attendance CSV export | 4 extra columns **for food-service orgs only** | Any downstream consumer parsing by column *index* for JoJo/Sweetleaf breaks; parsing by header name is safe. Flag in the PR description. |
| New form action `?/importBacklog` | New | `MANAGE_HR` + food-service |
| New route `/punch` | New | Session-auth + food-service + self-only |

## Blast Radius

- **Files changed:** 12 modified + 3 new source files + 10 new test files.
- **Packages:** single package (this is not a monorepo).
- **Schema:** 9 new nullable columns across 2 tables, 1 new unique index, **0 enum changes**,
  **0 renames**, **0 data migrations**.
- **Risk classes present:** schema/migration; payroll-adjacent; new public surface; sensitive
  personal data (location); new production dependency; file upload.
- **Risk classes absent:** auth/identity (no RBAC table change), billing, container/proxy,
  secrets.
- **Runtime surfaces:** the attendance page, the attendance CSV export, the punches API response
  shape, and one new page.

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `attendance-am-pm-split` A1, A3, A5, A7, A8 | Fully-Automated | 1 |
| `attendance-am-pm-split` A2 (negative control) + the untouched `attendance-derive` / `attendance-autoderive` / `attendance-correct-derive` suites re-run green | Fully-Automated | 2, 20 |
| `payroll-am-pm-days-of-work` | Fully-Automated | 3 |
| `hours-engine-parity-am-pm` | Fully-Automated | 4 |
| `attendance-am-pm-split` A6 (single punch) | Fully-Automated | 5 |
| `punch-location-capture` C1 + e2e `timesheet-punch-location` | Hybrid (e2e needs the seeded DB + a browser) | 6 |
| `punch-location-route` C7, C8 | Fully-Automated | 7 |
| e2e `timesheet-punch-location` permission-denied case | Hybrid | 8 |
| `punch-location-route` C8, C9 + the accuracy-qualifier display rule | Fully-Automated | 9 |
| `punch-location-route` C7 (no reading present → graceful) | Fully-Automated | 10 |
| Existing `punch-access` suite (unchanged, re-run) + M11 self-visibility | Fully-Automated + Agent-Probe (M11) | 11 |
| `punch-location-capture` C2 + `punch-location-route` C11 | Fully-Automated | 12 |
| `attendance-backlog-import` B6 | Fully-Automated | 13 |
| `attendance-backlog-import` B7 | Fully-Automated | 14 |
| `attendance-backlog-import` B8, B9 | Fully-Automated | 15 |
| `attendance-backlog-import` B10 | Fully-Automated | 16 |
| `attendance-backlog-import` B11 | Fully-Automated | 17 |
| `attendance-backlog-rbac` B13, B14, B15 | Fully-Automated | 18 |
| `attendance-backlog-parse` B2–B5 + `attendance-backlog-rbac` B16 | Fully-Automated | 19 |
| A2 + C11 + B14 (three negative controls, one per issue) + M2/M7 | Fully-Automated + Agent-Probe | 20 |
| Mutation checks §1.7, §2.5, §3.6 — each guard mutated once and confirmed RED | Agent-Probe (the mutation is applied and reverted by hand) | all guard criteria (2, 7, 12, 15, 16, 18) |
| `pnpm format:check && pnpm lint && pnpm check && pnpm test`, in order, per phase | Fully-Automated | all |
| Manual script M1–M11 | Agent-Probe | 1, 2, 6, 8, 11, 12, 13, 15, 16, 18, 20 |

**Known gaps** (recorded, not silently accepted):

| Gap | Why | Resolution |
|---|---|---|
| Real-device GPS accuracy behaviour | Cannot be automated; Playwright's `setGeolocation` supplies a synthetic fix with no accuracy variance | Agent-Probe M8 covers the happy path on a real browser. Backlog stub: `web-punch-real-device-accuracy_NOTE_17-08-26.md` — verify on an actual phone before the food-service rollout. Gate stays **CONDITIONAL** for criterion 6. |
| `TimesheetModal.svelte` `recalcRow` (engine C) has no test at all | Pre-existing, and this cluster deliberately does not teach it AM/PM | Out of scope per SPEC. Backlog stub: `timesheet-modal-engine-c-coverage_NOTE_17-08-26.md`. |
| Non-HTTPS behaviour of `navigator.geolocation` | Cannot be exercised on `localhost` (a secure context by browser rule) | Criterion 10 is proven at the *write path* by C7 — the server treats "no reading" identically however it arose. The browser half is a browser guarantee, not our code. Accepted. |

## Test Infra Improvement Notes

- The repo has no shared fixture directory for upload test inputs. Phase 2 should create
  `tests/fixtures/backlog/` with `valid.csv`, `formula-injection.csv`, `malformed.csv`, and
  `binary.csv`, and note it here for reuse.
- `tests/unit/punch-access.test.ts:57-65` is the canonical example of where-shape mock
  discrimination. Reference it from the two new mocked suites so the pattern spreads rather than
  being rediscovered.
- No unit test currently imports a `+page.server.ts` `actions` export directly. B13–B16 and
  C7–C12 will establish that pattern; if it proves awkward, record the friction here.

## Resume and Execution Handoff

1. **Selected plan file:** `process/features/timesheet-capture/active/timesheet-capture-162-177-200_17-08-26/timesheet-capture-162-177-200_PLAN_17-08-26.md`
2. **Last completed phase or step:** none — PLAN written, no code changes on
   `feat/timesheet-capture-162-177-200` (branch is clean, 2 doc commits).
3. **Validate-contract status:** pending — see the placeholder section below.
4. **Supporting context files loaded:** `research-findings_REF_17-08-26.md` and
   `timesheet-capture-162-177-200_SPEC_17-08-26.md` in this task folder; `CLAUDE.md`;
   the twelve source files quoted above.
5. **Next step for a fresh agent:** run VALIDATE against this plan. Then execute **Phase 1 only**,
   stopping at the §1.9 gate. Do not begin Phase 2 until all four CI gates are green and the
   §1.7 mutation checks have each been confirmed RED and reverted. Commit each phase separately
   (three commits, one PR) so a phase can be reverted independently.

## Validate Contract

(placeholder — vc-validate-agent writes this section before EXECUTE)

---

## Next Instruction

Plan complete. Review carefully. Say **"ENTER VALIDATE MODE"** when ready to proceed to plan
validation (required before implementation).
