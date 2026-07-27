import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { ROLE_HIERARCHY } from '$lib/server/rbac'
import { error } from '@sveltejs/kit'
import bcrypt from 'bcrypt'
import { Prisma } from '@prisma/client'
import { ensureLeaveBalances } from './leave'
import { sendDiscordInviteEmail } from '$lib/server/notifications'
import { notify } from './notifications'
import type { AuditContext } from './types'
import type { EmploymentType, EmploymentStatus, RateType, Gender, Role } from '@prisma/client'

interface CreateEmployeeInput {
	email: string
	password: string
	role: Role
	firstName: string
	lastName: string
	middleName?: string
	dateOfBirth?: Date
	gender?: Gender
	contactPhone?: string
	contactAddress?: string
	departmentId: string
	jobTitle: string
	employmentType: EmploymentType
	startDate: Date
	basicMonthlySalary: number
	rateType?: RateType
	sssNumber?: string
	philhealthNumber?: string
	pagibigNumber?: string
	tinNumber?: string
	reportsToId?: string
	discordId?: string | null
	workScheduleId?: string | null
	positionId?: string | null
	emergencyContactName?: string
	emergencyContactRelation?: string
	emergencyContactPhone?: string
	bankName?: string
	bankAccountName?: string
	bankAccountNumber?: string
	gcashNumber?: string
}

interface UpdateEmployeeInput {
	firstName?: string
	lastName?: string
	middleName?: string
	dateOfBirth?: Date
	gender?: Gender
	contactPhone?: string
	contactAddress?: string
	departmentId?: string
	jobTitle?: string
	employmentType?: EmploymentType
	employmentStatus?: EmploymentStatus
	endDate?: Date
	companyEmail?: string | null
	basicMonthlySalary?: number
	rateType?: RateType
	sssNumber?: string | null
	philhealthNumber?: string | null
	pagibigNumber?: string | null
	tinNumber?: string | null
	bankName?: string | null
	bankAccountName?: string | null
	bankAccountNumber?: string | null
	gcashNumber?: string | null
	positionId?: string | null
	reportsToId?: string
	discordId?: string | null
	workScheduleId?: string | null
	branchId?: string | null
	emergencyContactName?: string
	emergencyContactRelation?: string
	emergencyContactPhone?: string
}

// Fields whose changes make up the employment-history timeline (FR-051):
// promotions, salary adjustments, department/position transfers, status changes.
// Everything else (bank/GCash, government IDs, Discord) is intentionally excluded
// so sensitive PII never lands in the audit trail.
const HISTORY_FIELDS = [
	'jobTitle',
	'departmentId',
	'positionId',
	'basicMonthlySalary',
	'rateType',
	'employmentType',
	'employmentStatus',
	'workScheduleId',
	'branchId'
] as const

const HISTORY_LABELS: Record<(typeof HISTORY_FIELDS)[number], string> = {
	jobTitle: 'Job title',
	departmentId: 'Department',
	positionId: 'Position',
	basicMonthlySalary: 'Basic salary',
	rateType: 'Rate basis',
	employmentType: 'Employment type',
	employmentStatus: 'Status',
	workScheduleId: 'Work schedule',
	branchId: 'Branch'
}

interface EmployeeListFilters {
	status?: EmploymentStatus
	// Split the roster into the active workforce and offboarded records (#184): `true`
	// returns only OFFBOARDED, `false` everyone still on the books (ACTIVE / ON_LEAVE),
	// `undefined` leaves the status unfiltered. Ignored when an exact `status` is given.
	offboarded?: boolean
	departmentId?: string
	branchId?: string
	search?: string
}

// The active roster is everyone still on the books (ACTIVE / ON_LEAVE); the offboarded
// section is exactly OFFBOARDED. Exported for the roster-split test (#184).
export function offboardedFilter(
	offboarded: boolean
): Prisma.EmployeeWhereInput['employmentStatus'] {
	return offboarded ? 'OFFBOARDED' : { not: 'OFFBOARDED' }
}

function employeeListWhere(
	organizationId: string,
	filters?: EmployeeListFilters
): Prisma.EmployeeWhereInput {
	return {
		user: { organizationId },
		...(filters?.status
			? { employmentStatus: filters.status }
			: filters?.offboarded !== undefined && {
					employmentStatus: offboardedFilter(filters.offboarded)
				}),
		...(filters?.departmentId && { departmentId: filters.departmentId }),
		...(filters?.branchId && { branchId: filters.branchId }),
		...(filters?.search && {
			OR: [
				{ firstName: { contains: filters.search, mode: 'insensitive' } },
				{ lastName: { contains: filters.search, mode: 'insensitive' } },
				{ employeeNumber: { contains: filters.search, mode: 'insensitive' } }
			]
		})
	}
}

export async function countEmployees(organizationId: string, filters?: EmployeeListFilters) {
	return db.employee.count({ where: employeeListWhere(organizationId, filters) })
}

export async function listEmployees(
	organizationId: string,
	filters?: EmployeeListFilters,
	pageArgs?: { skip: number; take: number }
) {
	return db.employee.findMany({
		where: employeeListWhere(organizationId, filters),
		// Explicit select, never `include`: the roster is reachable at MANAGER via
		// GET /api/v1/employees, and a bare `include` returns every scalar — salary,
		// government IDs, bank/GCash — defeating the HR-only masking in getEmployee.
		// Display fields only; anything sensitive must stay out of this list.
		select: {
			id: true,
			employeeNumber: true,
			firstName: true,
			lastName: true,
			middleName: true,
			jobTitle: true,
			employmentType: true,
			employmentStatus: true,
			startDate: true,
			// #136: tenure freezes at endDate for offboarded staff.
			endDate: true,
			department: { select: { id: true, name: true } },
			branch: { select: { id: true, name: true } },
			user: { select: { email: true, role: true, isActive: true } }
		},
		orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
		...(pageArgs && { skip: pageArgs.skip, take: pageArgs.take })
	})
}

export async function getEmployee(id: string, organizationId: string, viewerRole?: Role) {
	const employee = await db.employee.findFirst({
		where: { id, user: { organizationId } },
		include: {
			department: true,
			user: { select: { email: true, role: true, isActive: true, lastLoginAt: true } },
			reportsTo: { select: { id: true, firstName: true, lastName: true } },
			position: { include: { salaryGrade: true } },
			emergencyContacts: { orderBy: { createdAt: 'asc' } }
		}
	})
	if (!employee) error(404, 'Employee not found')

	// Compensation, government IDs, and disbursement details are HR-only: below the HR_ADMIN
	// rank they come back null. Note MANAGER is *not* below it — #133 made MANAGER on-branch HR
	// and ranks it level with HR_ADMIN, so a manager does see these. (An earlier comment here
	// claimed the opposite; it predated #133.)
	if (viewerRole && ROLE_HIERARCHY[viewerRole] < ROLE_HIERARCHY.HR_ADMIN) {
		return {
			...employee,
			basicMonthlySalary: null,
			sssNumber: null,
			philhealthNumber: null,
			pagibigNumber: null,
			tinNumber: null,
			bankName: null,
			bankAccountName: null,
			bankAccountNumber: null,
			gcashNumber: null
		}
	}
	return employee
}

/** Employee numbers are `PREFIX-NNN`; NNN is padded to at least this width. */
const NUMBER_WIDTH = 3
/** Attempts to allocate a free number before giving up (only a concurrent create can clash). */
const ALLOCATION_ATTEMPTS = 5

/**
 * Next employee number for an org: the highest numeric suffix already in use, plus one.
 *
 * This used to be `count + 1`, which is not a sequence — it drifts from the numbers actually
 * issued as soon as anyone is deleted, or when rows use different widths. Both were true here,
 * which is how EMP-0013 came to be issued *after* EMP-0014 existed, and then how onboarding
 * started failing outright against the (organizationId, employeeNumber) unique index.
 *
 * Reads through `tx` so the scan and the insert share one transaction. Scoped on
 * Employee.organizationId — the column the unique index actually uses, not
 * `user.organizationId`, which is a separate column that merely agrees today.
 */
async function nextEmployeeNumber(tx: Prisma.TransactionClient, organizationId: string) {
	const org = await tx.organization.findUniqueOrThrow({
		where: { id: organizationId },
		select: { employeeNumberPrefix: true }
	})

	const rows = await tx.employee.findMany({
		where: { organizationId },
		select: { employeeNumber: true }
	})

	// Trailing digits only, so every historical shape reads correctly regardless of prefix or
	// width (EMP-0014 → 14, JJ-004 → 4). Max across all of the org's numbers, not just those
	// sharing the new prefix: conservative, and it cannot collide with an existing number.
	const highest = rows.reduce((max, r) => {
		const n = Number(r.employeeNumber.match(/(\d+)$/)?.[1] ?? NaN)
		return Number.isFinite(n) && n > max ? n : max
	}, 0)

	return `${org.employeeNumberPrefix}-${String(highest + 1).padStart(NUMBER_WIDTH, '0')}`
}

/** True for a unique violation on (organizationId, employeeNumber) specifically. */
function isEmployeeNumberConflict(e: unknown) {
	if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false
	const target = e.meta?.target
	return Array.isArray(target) && target.includes('employeeNumber')
}

export async function createEmployee(
	organizationId: string,
	input: CreateEmployeeInput,
	ctx: AuditContext
) {
	const existingUser = await db.user.findUnique({ where: { email: input.email } })
	if (existingUser) error(409, 'Email already in use')

	// Hashed once, outside the retry loop — bcrypt at cost 12 is by far the expensive part and
	// the password does not change between attempts.
	const passwordHash = await bcrypt.hash(input.password, 12)

	const employee = await allocateAndCreate(organizationId, input, passwordHash)

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'Employee',
		// From the created row, not a variable computed up front: a retry changes the number.
		newValue: { employeeNumber: employee.employeeNumber, email: input.email },
		entityId: employee.id
	})

	// On onboarding, invite the new hire to the company Discord server (#186) — only when
	// the org has configured an invite link (currently just Veent). Sent to their working
	// email since company-email provisioning is deferred. Best-effort: never block a hire.
	try {
		const org = await db.organization.findUnique({
			where: { id: organizationId },
			select: { name: true, discordInviteUrl: true }
		})
		if (org?.discordInviteUrl) {
			sendDiscordInviteEmail(input.email, {
				firstName: input.firstName,
				orgName: org.name,
				inviteUrl: org.discordInviteUrl
			})
			await notify(
				employee.userId,
				`You've been invited to the ${org.name} Discord server — check your email.`,
				'/dashboard'
			)
		}
	} catch (e) {
		console.error('[NOTIFY] Failed to send Discord invite for', employee.id, e)
	}

	return employee
}

/**
 * Allocate a number and insert, retrying the whole transaction if a concurrent create took the
 * number first. Only a genuine race can reach a second attempt — the number is read inside the
 * transaction — so a handful of attempts is plenty.
 */
async function allocateAndCreate(
	organizationId: string,
	input: CreateEmployeeInput,
	passwordHash: string
) {
	for (let attempt = 1; ; attempt++) {
		try {
			return await db.$transaction(async (tx: Prisma.TransactionClient) => {
				const employeeNumber = await nextEmployeeNumber(tx, organizationId)
				const user = await tx.user.create({
					data: {
						organizationId,
						email: input.email,
						passwordHash,
						role: input.role
					}
				})

				const created = await tx.employee.create({
					data: {
						userId: user.id,
						organizationId,
						employeeNumber,
						firstName: input.firstName,
						lastName: input.lastName,
						middleName: input.middleName,
						dateOfBirth: input.dateOfBirth,
						gender: input.gender,
						contactPhone: input.contactPhone,
						contactAddress: input.contactAddress,
						departmentId: input.departmentId,
						jobTitle: input.jobTitle,
						employmentType: input.employmentType,
						startDate: input.startDate,
						basicMonthlySalary: input.basicMonthlySalary,
						rateType: input.rateType ?? 'MONTHLY',
						sssNumber: input.sssNumber,
						philhealthNumber: input.philhealthNumber,
						pagibigNumber: input.pagibigNumber,
						tinNumber: input.tinNumber,
						emergencyContactName: input.emergencyContactName,
						emergencyContactRelation: input.emergencyContactRelation,
						emergencyContactPhone: input.emergencyContactPhone,
						bankName: input.bankName,
						bankAccountName: input.bankAccountName,
						bankAccountNumber: input.bankAccountNumber,
						gcashNumber: input.gcashNumber,
						reportsToId: input.reportsToId,
						discordId: input.discordId,
						// #186: company-email provisioning is deferred, so seed it with the hire's working
						// email; HR updates it once the real address exists.
						companyEmail: input.email,
						// Onboarding sets the work schedule (attendance derivation depends on it) and the
						// position; both are optional. Coerce empty string → null (an empty <select> posts
						// "", which is not a valid FK) so we don't hit a foreign-key violation.
						workScheduleId: input.workScheduleId || null,
						positionId: input.positionId || null
					},
					include: { department: true, user: { select: { email: true, role: true } } }
				})

				// Allocate this year's leave entitlement from the org's leave-type defaults (#137).
				// Inside the transaction so a new hire is never left half-onboarded with no ledger —
				// `assertLeaveBalance` reads a missing row as zero, so that state blocks their first
				// filing outright. Re-run on a retry because the whole transaction is replayed.
				await ensureLeaveBalances(created.id, organizationId, input.startDate.getFullYear(), tx)

				return created
			})
		} catch (e) {
			// Anything that is not a lost race on the number — a duplicate Discord ID, a bad FK —
			// is the caller’s problem and must surface now rather than be retried.
			if (!isEmployeeNumberConflict(e) || attempt >= ALLOCATION_ATTEMPTS) throw e
		}
	}
}

export async function updateEmployee(
	id: string,
	organizationId: string,
	input: UpdateEmployeeInput,
	ctx: AuditContext
) {
	const existing = await getEmployee(id, organizationId)

	// A branch change is a store transfer. Postgres can't express "the branch belongs to the
	// same org", so verify it here — a forged id from another tenant must not cross over.
	// Re-saving an employee who already sits on a closed branch is allowed: the picker keeps
	// their current branch selectable, and blocking it would fail every unrelated edit on
	// that 201 file.
	if (input.branchId && input.branchId !== existing.branchId) {
		const branch = await db.branch.findFirst({
			where: { id: input.branchId, organizationId },
			select: { id: true, status: true }
		})
		if (!branch) error(404, 'Branch not found')
		if (branch.status === 'CLOSED') error(400, 'That branch is closed — choose an open branch.')
	}

	const updated = await db.employee.update({
		where: { id },
		data: input,
		include: { department: true, user: { select: { email: true, role: true } } }
	})

	// Curated audit diff: before/after values for the employment-history fields
	// only, plus the names (not values) of any other changed fields. This powers
	// the history timeline (FR-051) and keeps sensitive PII out of the audit log.
	const norm = (v: unknown) =>
		v == null ? null : typeof v === 'object' && 'toString' in v ? (v as object).toString() : v
	const oldValue: Record<string, unknown> = {}
	const newValue: Record<string, unknown> = {}
	const otherChanged: string[] = []
	for (const key of Object.keys(input) as (keyof UpdateEmployeeInput)[]) {
		const before = norm((existing as Record<string, unknown>)[key])
		const after = norm((updated as Record<string, unknown>)[key])
		if (String(before) === String(after)) continue
		if ((HISTORY_FIELDS as readonly string[]).includes(key)) {
			oldValue[key] = before
			newValue[key] = after
		} else {
			otherChanged.push(key)
		}
	}

	// Only record an audit entry when something actually changed.
	if (Object.keys(newValue).length > 0 || otherChanged.length > 0) {
		if (otherChanged.length > 0) newValue._otherFields = otherChanged
		await writeAuditLog(ctx, {
			action: 'UPDATE',
			entityType: 'Employee',
			entityId: id,
			oldValue,
			newValue
		})
	}

	return updated
}

export async function offboardEmployee(
	id: string,
	organizationId: string,
	endDate: Date,
	ctx: AuditContext
) {
	const target = await getEmployee(id, organizationId)

	// Refuse self-offboarding: the transaction below deactivates the target's
	// user account, so an admin offboarding their own record would be locked out
	// on their next request (hooks.server.ts redirects inactive users to /login).
	// Guarding here covers both the form action and the v1 API in one place.
	if (target.userId === ctx.actorId) {
		error(400, 'You cannot offboard your own employee record — ask another admin to do it.')
	}

	const [employee] = await db.$transaction([
		db.employee.update({
			where: { id },
			data: { employmentStatus: 'OFFBOARDED', endDate }
		}),
		db.user.updateMany({
			where: { employee: { id } },
			data: { isActive: false }
		})
	])

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Employee',
		entityId: id,
		newValue: { employmentStatus: 'OFFBOARDED', endDate }
	})

	return employee
}

export interface EmploymentHistoryChange {
	label: string
	from: string
	to: string
}
export interface EmploymentHistoryEvent {
	id: string
	date: Date
	actorEmail: string | null
	type: 'HIRED' | 'CHANGE'
	changes: EmploymentHistoryChange[]
}

// Surface an employee's employment history (FR-051) from the audit trail:
// hiring, promotions, salary adjustments, department/position transfers, and
// status changes — derived by diffing the HISTORY_FIELDS on each audit entry.
export async function getEmploymentHistory(
	employeeId: string,
	organizationId: string
): Promise<EmploymentHistoryEvent[]> {
	const logs = await db.auditLog.findMany({
		where: {
			organizationId,
			entityType: 'Employee',
			entityId: employeeId,
			action: { in: ['CREATE', 'UPDATE'] }
		},
		orderBy: { createdAt: 'desc' },
		include: { actor: { select: { email: true } } }
	})

	// Resolve foreign-key ids to human-readable names for display.
	const [departments, positions, schedules, branches] = await Promise.all([
		db.department.findMany({ where: { organizationId }, select: { id: true, name: true } }),
		db.position.findMany({ where: { organizationId }, select: { id: true, title: true } }),
		db.workSchedule.findMany({ where: { organizationId }, select: { id: true, name: true } }),
		db.branch.findMany({ where: { organizationId }, select: { id: true, name: true } })
	])
	const deptMap = new Map(departments.map((d) => [d.id, d.name]))
	const posMap = new Map(positions.map((p) => [p.id, p.title]))
	const schedMap = new Map(schedules.map((s) => [s.id, s.name]))
	const branchMap = new Map(branches.map((b) => [b.id, b.name]))
	const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

	const display = (field: string, raw: unknown): string => {
		if (raw == null || raw === '') return '—'
		const v = String(raw)
		if (field === 'departmentId') return deptMap.get(v) ?? '(removed)'
		if (field === 'positionId') return posMap.get(v) ?? '(removed)'
		if (field === 'branchId') return branchMap.get(v) ?? '(removed)'
		if (field === 'workScheduleId') return schedMap.get(v) ?? 'Default schedule'
		if (field === 'basicMonthlySalary') return money.format(Number(raw))
		// The figure's basis (#120) — 'Monthly salary' / 'Hourly rate', not the raw enum.
		if (field === 'rateType') return v === 'HOURLY' ? 'Hourly rate' : 'Monthly salary'
		if (field === 'employmentType' || field === 'employmentStatus') return v.replace(/_/g, ' ')
		return v
	}

	const events: EmploymentHistoryEvent[] = []
	for (const log of logs) {
		if (log.action === 'CREATE') {
			events.push({
				id: log.id,
				date: log.createdAt,
				actorEmail: log.actor?.email ?? null,
				type: 'HIRED',
				changes: []
			})
			continue
		}
		const oldValue = (log.oldValue ?? {}) as Record<string, unknown>
		const newValue = (log.newValue ?? {}) as Record<string, unknown>
		const changes: EmploymentHistoryChange[] = []
		for (const field of HISTORY_FIELDS) {
			if (!(field in newValue)) continue
			const from = display(field, oldValue[field])
			const to = display(field, newValue[field])
			if (from === to) continue
			changes.push({ label: HISTORY_LABELS[field], from, to })
		}
		if (changes.length > 0) {
			events.push({
				id: log.id,
				date: log.createdAt,
				actorEmail: log.actor?.email ?? null,
				type: 'CHANGE',
				changes
			})
		}
	}
	return events
}
