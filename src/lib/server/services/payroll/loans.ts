import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { LoanStatus } from '@prisma/client'
import type { AuditContext } from '../types'

/**
 * Loan & cash-advance CRUD (PAY-019). Amortization itself (per-period installment, decrement at
 * lock, reverse on void) lives in the payroll engine + period lifecycle — this just maintains the
 * records HR sets up. All mutations are org-scoped and audited.
 */

async function requireEmployee(employeeId: string, organizationId: string) {
	const e = await db.employee.findFirst({
		where: { id: employeeId, user: { organizationId } },
		select: { id: true }
	})
	if (!e) error(404, 'Employee not found')
	return e
}

export function listLoans(employeeId: string, organizationId: string) {
	return db.loan.findMany({
		where: { employeeId, employee: { user: { organizationId } } },
		orderBy: { createdAt: 'desc' }
	})
}

export function listCashAdvances(employeeId: string, organizationId: string) {
	return db.cashAdvance.findMany({
		where: { employeeId, employee: { user: { organizationId } } },
		orderBy: { createdAt: 'desc' }
	})
}

export async function createLoan(
	employeeId: string,
	organizationId: string,
	data: { type?: string; principal: number; installment: number },
	ctx: AuditContext
) {
	await requireEmployee(employeeId, organizationId)
	if (data.installment <= 0 || data.principal <= 0)
		error(400, 'Principal and installment must be positive')

	const loan = await db.loan.create({
		data: {
			employeeId,
			type: data.type,
			principal: data.principal,
			balance: data.principal,
			installment: data.installment,
			status: 'ACTIVE'
		}
	})
	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'Loan',
		entityId: loan.id,
		newValue: { type: data.type, principal: data.principal, installment: data.installment }
	})
	return loan
}

export async function updateLoan(
	id: string,
	organizationId: string,
	data: { installment?: number; status?: LoanStatus },
	ctx: AuditContext
) {
	const loan = await db.loan.findFirst({ where: { id, employee: { user: { organizationId } } } })
	if (!loan) error(404, 'Loan not found')

	const updated = await db.loan.update({ where: { id }, data })
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Loan',
		entityId: id,
		newValue: data as Record<string, unknown>
	})
	return updated
}

export async function createCashAdvance(
	employeeId: string,
	organizationId: string,
	data: { amount: number; installment: number },
	ctx: AuditContext
) {
	await requireEmployee(employeeId, organizationId)
	if (data.installment <= 0 || data.amount <= 0)
		error(400, 'Amount and installment must be positive')

	const ca = await db.cashAdvance.create({
		data: {
			employeeId,
			amount: data.amount,
			balance: data.amount,
			installment: data.installment,
			status: 'ACTIVE'
		}
	})
	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'CashAdvance',
		entityId: ca.id,
		newValue: { amount: data.amount, installment: data.installment }
	})
	return ca
}

export async function updateCashAdvance(
	id: string,
	organizationId: string,
	data: { installment?: number; status?: LoanStatus },
	ctx: AuditContext
) {
	const ca = await db.cashAdvance.findFirst({
		where: { id, employee: { user: { organizationId } } }
	})
	if (!ca) error(404, 'Cash advance not found')

	const updated = await db.cashAdvance.update({ where: { id }, data })
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'CashAdvance',
		entityId: id,
		newValue: data as Record<string, unknown>
	})
	return updated
}
