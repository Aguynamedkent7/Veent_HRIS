import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
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
	sssNumber?: string
	philhealthNumber?: string
	pagibigNumber?: string
	tinNumber?: string
	reportsToId?: string
}

export async function listEmployees(organizationId: string, filters?: {
	status?: EmploymentStatus
	departmentId?: string
	search?: string
}) {
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

export async function getEmployee(id: string, organizationId: string) {
	const employee = await db.employee.findFirst({
		where: { id, user: { organizationId } },
		include: {
			department: true,
			user: { select: { email: true, role: true, isActive: true, lastLoginAt: true } },
			reportsTo: { select: { id: true, firstName: true, lastName: true } }
		}
	})
	if (!employee) error(404, 'Employee not found')
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
				reportsToId: input.reportsToId
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

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Employee',
		entityId: id,
		oldValue: { employmentStatus: existing.employmentStatus, jobTitle: existing.jobTitle },
		newValue: input as Record<string, unknown>
	})

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
