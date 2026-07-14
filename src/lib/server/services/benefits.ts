import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import type { AuditContext } from './types'

type BenefitPlanType = 'HMO' | 'INSURANCE' | 'RETIREMENT' | 'ALLOWANCE' | 'LEAVE_CREDIT' | 'OTHER'
type BenefitEnrollmentStatus = 'ACTIVE' | 'WAIVED' | 'TERMINATED'

export async function listBenefitPlans(
	organizationId: string,
	opts?: { activeOnly?: boolean; type?: BenefitPlanType }
) {
	return db.benefitPlan.findMany({
		where: {
			organizationId,
			...(opts?.activeOnly && { isActive: true }),
			...(opts?.type && { type: opts.type })
		},
		orderBy: { name: 'asc' }
	})
}

export async function createBenefitPlan(
	organizationId: string,
	data: {
		name: string
		type: BenefitPlanType
		provider?: string
		description?: string
		employeeCost?: number
		employerCost?: number
		isActive?: boolean
	},
	ctx: AuditContext
) {
	const plan = await db.benefitPlan.create({
		data: {
			organizationId,
			name: data.name,
			type: data.type,
			provider: data.provider,
			description: data.description,
			employeeCost: data.employeeCost,
			employerCost: data.employerCost,
			isActive: data.isActive ?? true
		}
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'BenefitPlan',
		entityId: plan.id,
		newValue: { name: plan.name, type: plan.type, provider: plan.provider }
	})

	return plan
}

export async function updateBenefitPlan(
	id: string,
	organizationId: string,
	data: {
		name?: string
		type?: BenefitPlanType
		provider?: string | null
		description?: string | null
		employeeCost?: number | null
		employerCost?: number | null
		isActive?: boolean
	},
	ctx: AuditContext
) {
	const existing = await db.benefitPlan.findFirst({ where: { id, organizationId } })
	if (!existing) error(404, 'Benefit plan not found')

	const plan = await db.benefitPlan.update({
		where: { id },
		data: {
			...(data.name !== undefined && { name: data.name }),
			...(data.type !== undefined && { type: data.type }),
			...(data.provider !== undefined && { provider: data.provider }),
			...(data.description !== undefined && { description: data.description }),
			...(data.employeeCost !== undefined && { employeeCost: data.employeeCost }),
			...(data.employerCost !== undefined && { employerCost: data.employerCost }),
			...(data.isActive !== undefined && { isActive: data.isActive })
		}
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'BenefitPlan',
		entityId: plan.id,
		newValue: { name: plan.name, type: plan.type, isActive: plan.isActive }
	})

	return plan
}

export async function listAllEnrollments(organizationId: string) {
	return db.benefitEnrollment.findMany({
		where: { plan: { organizationId } },
		include: {
			plan: { select: { id: true, name: true, type: true, employeeCost: true } },
			employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true } }
		},
		orderBy: [{ status: 'asc' }, { effectiveDate: 'desc' }]
	})
}

export async function listEnrollmentsForEmployee(employeeId: string) {
	return db.benefitEnrollment.findMany({
		where: { employeeId },
		include: {
			plan: {
				select: {
					id: true,
					name: true,
					type: true,
					provider: true,
					employeeCost: true,
					employerCost: true
				}
			}
		},
		orderBy: { effectiveDate: 'desc' }
	})
}

export async function enrollEmployee(
	employeeId: string,
	benefitPlanId: string,
	data: { coverageLevel?: string; effectiveDate: Date; status?: BenefitEnrollmentStatus },
	ctx: AuditContext
) {
	// Ensure the plan belongs to the acting organization before enrolling.
	const plan = await db.benefitPlan.findFirst({
		where: { id: benefitPlanId, organizationId: ctx.organizationId }
	})
	if (!plan) error(404, 'Benefit plan not found')

	try {
		const enrollment = await db.benefitEnrollment.create({
			data: {
				employeeId,
				benefitPlanId,
				coverageLevel: data.coverageLevel,
				effectiveDate: data.effectiveDate,
				status: data.status ?? 'ACTIVE'
			}
		})

		await writeAuditLog(ctx, {
			action: 'CREATE',
			entityType: 'BenefitEnrollment',
			entityId: enrollment.id,
			newValue: { employeeId, benefitPlanId, status: enrollment.status }
		})

		return enrollment
	} catch (e) {
		if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
			error(409, 'Employee is already enrolled in this benefit plan')
		}
		throw e
	}
}

export async function updateEnrollmentStatus(
	id: string,
	organizationId: string,
	status: BenefitEnrollmentStatus,
	ctx: AuditContext
) {
	const existing = await db.benefitEnrollment.findFirst({
		where: { id, plan: { organizationId } }
	})
	if (!existing) error(404, 'Benefit enrollment not found')

	const enrollment = await db.benefitEnrollment.update({
		where: { id },
		data: {
			status,
			...(status === 'TERMINATED' && { endedAt: new Date() })
		}
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'BenefitEnrollment',
		entityId: enrollment.id,
		newValue: { status: enrollment.status }
	})

	return enrollment
}
