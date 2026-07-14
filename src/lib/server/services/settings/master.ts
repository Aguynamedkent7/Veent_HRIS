import { db } from '$lib/server/db'
import { error } from '@sveltejs/kit'
import { writeAuditLog } from '$lib/server/audit'
import type { AuditContext } from '../types'

// ─── Company info ─────────────────────────────────────────────────────────────

export async function getCompanyInfo(organizationId: string) {
	const org = await db.organization.findUnique({
		where: { id: organizationId },
		select: { id: true, name: true, address: true, logoUrl: true }
	})
	if (!org) error(404, 'Organization not found')
	return org
}

export async function updateCompanyInfo(
	organizationId: string,
	input: { name: string; address?: string | null; logoUrl?: string | null },
	ctx: AuditContext
) {
	const updated = await db.organization.update({
		where: { id: organizationId },
		data: {
			name: input.name.trim(),
			address: input.address ?? null,
			logoUrl: input.logoUrl ?? null
		},
		select: { id: true, name: true, address: true, logoUrl: true }
	})
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Organization',
		entityId: organizationId,
		newValue: { name: updated.name }
	})
	return updated
}

// ─── Earning / deduction codes ────────────────────────────────────────────────

export async function listPayCodes(organizationId: string) {
	const [earningTypes, deductionTypes] = await Promise.all([
		db.earningType.findMany({ where: { organizationId }, orderBy: { code: 'asc' } }),
		db.deductionType.findMany({ where: { organizationId }, orderBy: { code: 'asc' } })
	])
	return { earningTypes, deductionTypes }
}

export async function createEarningType(
	organizationId: string,
	input: { code: string; label: string; taxable: boolean; multiplier?: number | null },
	ctx: AuditContext
) {
	const code = input.code.trim().toUpperCase()
	const exists = await db.earningType.findFirst({ where: { organizationId, code } })
	if (exists) error(409, `Earning code "${code}" already exists`)
	const created = await db.earningType.create({
		data: {
			organizationId,
			code,
			label: input.label.trim(),
			taxable: input.taxable,
			multiplier: input.multiplier ?? null
		}
	})
	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'EarningType',
		entityId: created.id,
		newValue: { code }
	})
	return created
}

export async function createDeductionType(
	organizationId: string,
	input: { code: string; label: string; isStatutory: boolean },
	ctx: AuditContext
) {
	const code = input.code.trim().toUpperCase()
	const exists = await db.deductionType.findFirst({ where: { organizationId, code } })
	if (exists) error(409, `Deduction code "${code}" already exists`)
	const created = await db.deductionType.create({
		data: { organizationId, code, label: input.label.trim(), isStatutory: input.isStatutory }
	})
	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'DeductionType',
		entityId: created.id,
		newValue: { code }
	})
	return created
}

// Codes are referenced by historical payroll rows, so we deactivate rather than delete.
export async function toggleEarningType(organizationId: string, id: string, ctx: AuditContext) {
	const et = await db.earningType.findFirst({
		where: { id, organizationId },
		select: { id: true, isActive: true }
	})
	if (!et) error(404, 'Earning code not found')
	const updated = await db.earningType.update({ where: { id }, data: { isActive: !et.isActive } })
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'EarningType',
		entityId: id,
		newValue: { isActive: updated.isActive }
	})
	return updated
}

export async function toggleDeductionType(organizationId: string, id: string, ctx: AuditContext) {
	const dt = await db.deductionType.findFirst({
		where: { id, organizationId },
		select: { id: true, isActive: true }
	})
	if (!dt) error(404, 'Deduction code not found')
	const updated = await db.deductionType.update({ where: { id }, data: { isActive: !dt.isActive } })
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'DeductionType',
		entityId: id,
		newValue: { isActive: updated.isActive }
	})
	return updated
}

// ─── Salary grades / bands ────────────────────────────────────────────────────

// Where a salary sits relative to a grade band. Pure — safe to unit-test.
export function bandStatus(salary: number, min: number, max: number): 'below' | 'within' | 'above' {
	if (salary < min) return 'below'
	if (salary > max) return 'above'
	return 'within'
}

export async function listSalaryGrades(organizationId: string) {
	return db.salaryGrade.findMany({ where: { organizationId }, orderBy: { minSalary: 'asc' } })
}

export async function listPositionsWithGrades(organizationId: string) {
	return db.position.findMany({
		where: { organizationId },
		select: { id: true, title: true, salaryGradeId: true },
		orderBy: { title: 'asc' }
	})
}

export async function createSalaryGrade(
	organizationId: string,
	input: { name: string; minSalary: number; midSalary: number; maxSalary: number },
	ctx: AuditContext
) {
	const name = input.name.trim()
	if (!(input.minSalary <= input.midSalary && input.midSalary <= input.maxSalary)) {
		error(400, 'Salaries must satisfy min ≤ mid ≤ max')
	}
	const exists = await db.salaryGrade.findFirst({ where: { organizationId, name } })
	if (exists) error(409, `Grade "${name}" already exists`)
	const created = await db.salaryGrade.create({
		data: {
			organizationId,
			name,
			minSalary: input.minSalary,
			midSalary: input.midSalary,
			maxSalary: input.maxSalary
		}
	})
	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'SalaryGrade',
		entityId: created.id,
		newValue: { name }
	})
	return created
}

export async function toggleSalaryGrade(organizationId: string, id: string, ctx: AuditContext) {
	const g = await db.salaryGrade.findFirst({
		where: { id, organizationId },
		select: { id: true, isActive: true }
	})
	if (!g) error(404, 'Grade not found')
	const updated = await db.salaryGrade.update({ where: { id }, data: { isActive: !g.isActive } })
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'SalaryGrade',
		entityId: id,
		newValue: { isActive: updated.isActive }
	})
	return updated
}

// Assign (or clear, with null) a position's grade.
export async function assignPositionGrade(
	organizationId: string,
	positionId: string,
	salaryGradeId: string | null,
	ctx: AuditContext
) {
	const pos = await db.position.findFirst({
		where: { id: positionId, organizationId },
		select: { id: true }
	})
	if (!pos) error(404, 'Position not found')
	if (salaryGradeId) {
		const grade = await db.salaryGrade.findFirst({
			where: { id: salaryGradeId, organizationId },
			select: { id: true }
		})
		if (!grade) error(404, 'Grade not found')
	}
	const updated = await db.position.update({ where: { id: positionId }, data: { salaryGradeId } })
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Position',
		entityId: positionId,
		newValue: { salaryGradeId }
	})
	return updated
}
