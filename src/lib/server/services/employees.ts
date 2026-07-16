import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { ROLE_HIERARCHY } from '$lib/server/rbac'
import { error } from '@sveltejs/kit'
import bcrypt from 'bcrypt'
import { Prisma } from '@prisma/client'
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
	basicMonthlySalary?: number
	rateType?: RateType
	sssNumber?: string | null
	philhealthNumber?: string | null
	pagibigNumber?: string | null
	tinNumber?: string | null
	bankName?: string | null
	bankAccountNumber?: string | null
	gcashNumber?: string | null
	positionId?: string | null
	reportsToId?: string
	discordId?: string | null
	workScheduleId?: string | null
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
	'employmentType',
	'employmentStatus',
	'workScheduleId'
] as const

const HISTORY_LABELS: Record<(typeof HISTORY_FIELDS)[number], string> = {
	jobTitle: 'Job title',
	departmentId: 'Department',
	positionId: 'Position',
	basicMonthlySalary: 'Basic salary',
	employmentType: 'Employment type',
	employmentStatus: 'Status',
	workScheduleId: 'Work schedule'
}

export async function listEmployees(
	organizationId: string,
	filters?: {
		status?: EmploymentStatus
		departmentId?: string
		search?: string
	}
) {
	return db.employee.findMany({
		where: {
			user: { organizationId },
			...(filters?.status && { employmentStatus: filters.status }),
			...(filters?.departmentId && { departmentId: filters.departmentId }),
			...(filters?.search && {
				OR: [
					{ firstName: { contains: filters.search, mode: 'insensitive' } },
					{ lastName: { contains: filters.search, mode: 'insensitive' } },
					{ employeeNumber: { contains: filters.search, mode: 'insensitive' } }
				]
			})
		},
		include: {
			department: { select: { id: true, name: true } },
			user: { select: { email: true, role: true, isActive: true } }
		},
		orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
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

	// Compensation, government IDs, and disbursement details are HR-only. A MANAGER
	// may view a report's record but must not see salary, tax/government identifiers,
	// or bank/GCash details.
	if (viewerRole && ROLE_HIERARCHY[viewerRole] < ROLE_HIERARCHY.HR_ADMIN) {
		return {
			...employee,
			basicMonthlySalary: null,
			sssNumber: null,
			philhealthNumber: null,
			pagibigNumber: null,
			tinNumber: null,
			bankName: null,
			bankAccountNumber: null,
			gcashNumber: null
		}
	}
	return employee
}

export async function createEmployee(
	organizationId: string,
	input: CreateEmployeeInput,
	ctx: AuditContext
) {
	const existingUser = await db.user.findUnique({ where: { email: input.email } })
	if (existingUser) error(409, 'Email already in use')

	const count = await db.employee.count({ where: { user: { organizationId } } })
	const employeeNumber = `EMP-${String(count + 1).padStart(4, '0')}`

	const passwordHash = await bcrypt.hash(input.password, 12)

	const employee = await db.$transaction(async (tx: Prisma.TransactionClient) => {
		const user = await tx.user.create({
			data: {
				organizationId,
				email: input.email,
				passwordHash,
				role: input.role
			}
		})

		return tx.employee.create({
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
				reportsToId: input.reportsToId,
				discordId: input.discordId,
				// Onboarding sets the work schedule (attendance derivation depends on it) and the
				// position; both are optional. Coerce empty string → null (an empty <select> posts
				// "", which is not a valid FK) so we don't hit a foreign-key violation.
				workScheduleId: input.workScheduleId || null,
				positionId: input.positionId || null
			},
			include: { department: true, user: { select: { email: true, role: true } } }
		})
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'Employee',
		entityId: employee.id,
		newValue: { employeeNumber, email: input.email }
	})

	return employee
}

export async function updateEmployee(
	id: string,
	organizationId: string,
	input: UpdateEmployeeInput,
	ctx: AuditContext
) {
	const existing = await getEmployee(id, organizationId)

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
	await getEmployee(id, organizationId)

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
	const [departments, positions, schedules] = await Promise.all([
		db.department.findMany({ where: { organizationId }, select: { id: true, name: true } }),
		db.position.findMany({ where: { organizationId }, select: { id: true, title: true } }),
		db.workSchedule.findMany({ where: { organizationId }, select: { id: true, name: true } })
	])
	const deptMap = new Map(departments.map((d) => [d.id, d.name]))
	const posMap = new Map(positions.map((p) => [p.id, p.title]))
	const schedMap = new Map(schedules.map((s) => [s.id, s.name]))
	const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

	const display = (field: string, raw: unknown): string => {
		if (raw == null || raw === '') return '—'
		const v = String(raw)
		if (field === 'departmentId') return deptMap.get(v) ?? '(removed)'
		if (field === 'positionId') return posMap.get(v) ?? '(removed)'
		if (field === 'workScheduleId') return schedMap.get(v) ?? 'Default schedule'
		if (field === 'basicMonthlySalary') return money.format(Number(raw))
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
