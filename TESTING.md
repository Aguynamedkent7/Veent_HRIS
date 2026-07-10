# Veent HRIS — Manual QA Runbook

Step-by-step manual tests for the payroll, attendance, Discord, and 201-file features.
Automated coverage lives in `tests/unit` (Vitest) and `tests/e2e` (Playwright).

## 0. Setup

- **Run**: `pnpm dev` (app) + `pnpm bot` (Discord), or `./start.sh` (boots DB + app + bot).
- **Logins** (seeded): `admin@veent.ph` / `Admin@1234` (Super Admin) · `manager@veent.ph` / `Manager@1234` · `employee@veent.ph` / `Employee@1234`.
- Inspect DB data with `pnpm db:studio`.

## 1. Login & RBAC
1. As **employee**, open `/employees` → **403 "Access Denied"**.
2. As **admin**, the sidebar shows Benefits / Payroll / Reports / Org Structure / Roles.
3. As **employee**, those admin items are hidden.

## 2. Employee 201 — Discord ID + loans
1. Admin → **Employees → (Elena) → Update Profile → Discord ID** → save → persists on reload.
2. Reuse another employee's Discord ID → **"already linked to another employee."**
3. **Loans & Cash Advances** panel → add a loan (Principal 5000, Per period 1000) → shows **ACTIVE, ₱5,000.00 / ₱1,000.00·pd**. Add a cash advance similarly.

## 3. Discord bot (`/in` `/out` `/break`)
_Prereq: bot invited with the **`applications.commands`** scope; the member's Discord user id set as their `Employee.discordId`._
1. `/in` → private "✅ Recorded." + public "🟢 **Name** clocked in at …".
2. `/break` → "started a break"; `/break` again → "back from break".
3. `/out` → "clocked out".
4. `/in 9:00` → announcement shows **at 9:00 AM** (backfilled, not now).
5. Unlinked account → **private error only**, no public message.

## 4. Payroll period lifecycle
1. Admin → **Payroll → Payroll Periods → Open Period** → row **OPEN**.
2. **Import Attendance** → **IMPORTED** (derives + locks attendance for the range).
3. **Generate** → **GENERATED**, Net populates.
4. **Lock** with an empty note → **409 "override note required"** (seeded staff have no hours).
5. **Lock** with a note → **LOCKED**.
6. **Release** → **RELEASED**.
7. As Super Admin, **Void** → **VOIDED** (any deducted loan balances are restored — check `db:studio`).

## 5. Payroll calculator
1. Admin → **Payroll → Calculator** → pick employee, Regular 80 / Overtime 10 → **Calculate**.
2. Itemized earnings + deductions + **Net pay**; **nothing saved** (reload = empty form).

## 6. Payslip release gating
1. As **employee**, **Payslips** — before **RELEASED**, no payslip listed.
2. After releasing the period, reload → payslip appears; open → itemized detail.

## 7. Attendance → payroll (data)
1. After **Import**, `db:studio` → **AttendanceDay**: one row per employee per day — punched weekdays `PRESENT`, none `ABSENT`, weekends `REST_DAY`, all `isLocked = true`.
2. A day with >8 worked hrs → `rawOvertimeHours` set, `overtimeHours = 0` (OT gated until approvals exist).
3. The payroll entry `hoursWorked` equals the summed attendance hours.

## 8. Reports
1. Admin → **Reports → Payroll Register** → date range over a generated run → table (Employee, Period, Gross, SSS, PhilHealth, PagIBIG, Tax, Other, Net).
2. **Export CSV** → downloads with those columns + correct values.

## 9. `db:migrate` is idempotent
- `pnpm db:migrate` twice → **"already in sync"** both times, no prompts, no data loss.

## 10. Module scaffolds (smoke)
1. **Benefits**, **Performance**, **Settings → Org Structure**, **Settings → Roles** all load.
2. Roles (Super Admin): change a user's role via the row select → saves; changing **your own** → **"cannot change your own role."**
