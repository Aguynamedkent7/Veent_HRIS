import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import type { StatutoryContribution } from '@prisma/client'
import { computePagibig, computePhilhealth, computeSSS } from './ph-statutory'
import { monthlyBasisOf } from './types'
import { q2 } from './money'
import type { AuditContext } from '../types'

/**
 * Per-employee statutory exemption (#173). HR can mark an individual employee as not enrolled in
 * SSS, PhilHealth, or Pag-IBIG; the payroll engine then zeroes BOTH shares of that contribution.
 * Absence of a row = enrolled (the default). Withholding tax is never exempted. All mutations are
 * org-scoped and audited.
 */

const CONTRIBUTIONS = ['SSS', 'PHILHEALTH', 'PAGIBIG'] as const satisfies StatutoryContribution[]

async function requireEmployee(employeeId: string, organizationId: string) {
	const e = await db.employee.findFirst({
		where: { id: employeeId, user: { organizationId } },
		select: { id: true, basicMonthlySalary: true, rateType: true }
	})
	if (!e) error(404, 'Employee not found')
	return e
}

/**
 * Map exempt rows to the engine's `statutoryExemptions` flags. Shared by the real run
 * (`computePayroll`) and the calculator preview so both stay identical.
 */
export function statutoryExemptions(rows: Array<{ contribution: StatutoryContribution }>) {
	return {
		sss: rows.some((r) => r.contribution === 'SSS'),
		philhealth: rows.some((r) => r.contribution === 'PHILHEALTH'),
		pagibig: rows.some((r) => r.contribution === 'PAGIBIG')
	}
}

/**
 * Map "employer share paid externally" rows (#173, Feature C) to the engine's `employerShareExternal`
 * flags. Same shape/plumbing as `statutoryExemptions` so the real run and the preview stay identical.
 */
export function employerShareExternals(rows: Array<{ contribution: StatutoryContribution }>) {
	return {
		sss: rows.some((r) => r.contribution === 'SSS'),
		philhealth: rows.some((r) => r.contribution === 'PHILHEALTH'),
		pagibig: rows.some((r) => r.contribution === 'PAGIBIG')
	}
}

/**
 * The three statutory contributions with the employee's current enrollment and the monthly EE
 * amount they would owe (display-only, computed from the same rate helpers the engine uses).
 */
export async function listStatutoryRows(employeeId: string, organizationId: string) {
	const employee = await requireEmployee(employeeId, organizationId)
	const configs = await db.employeeStatutoryConfig.findMany({
		where: { employeeId },
		select: { contribution: true, exempt: true, employerSharePaidExternally: true }
	})
	const monthly = monthlyBasisOf({
		basicMonthlySalary: employee.basicMonthlySalary,
		rateType: employee.rateType
	})
	const monthlyEe: Record<StatutoryContribution, number> = {
		SSS: q2(computeSSS(monthly).ee).toNumber(),
		PHILHEALTH: q2(computePhilhealth(monthly).ee).toNumber(),
		PAGIBIG: q2(computePagibig(monthly).ee).toNumber()
	}
	return CONTRIBUTIONS.map((contribution) => {
		const config = configs.find((c) => c.contribution === contribution)
		return {
			contribution,
			exempt: config?.exempt ?? false,
			employerSharePaidExternally: config?.employerSharePaidExternally ?? false,
			monthlyEe: monthlyEe[contribution]
		}
	})
}

/** Upsert the exemption row for one contribution and audit the change. */
export async function setStatutoryExemption(
	employeeId: string,
	organizationId: string,
	contribution: StatutoryContribution,
	exempt: boolean,
	ctx: AuditContext
) {
	await requireEmployee(employeeId, organizationId)
	const row = await db.employeeStatutoryConfig.upsert({
		where: { employeeId_contribution: { employeeId, contribution } },
		create: { employeeId, contribution, exempt },
		update: { exempt }
	})
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'EmployeeStatutoryConfig',
		entityId: row.id,
		newValue: { contribution, exempt }
	})
	return row
}

/**
 * Upsert the "employer share paid externally" flag (#173, Feature C) for one contribution and audit
 * it. Shares the `@@unique([employeeId, contribution])` row with `exempt`, so only this flag is
 * touched — `exempt` is preserved (created rows default it to false).
 */
export async function setEmployerShareExternal(
	employeeId: string,
	organizationId: string,
	contribution: StatutoryContribution,
	external: boolean,
	ctx: AuditContext
) {
	await requireEmployee(employeeId, organizationId)
	const row = await db.employeeStatutoryConfig.upsert({
		where: { employeeId_contribution: { employeeId, contribution } },
		create: { employeeId, contribution, employerSharePaidExternally: external },
		update: { employerSharePaidExternally: external }
	})
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'EmployeeStatutoryConfig',
		entityId: row.id,
		newValue: { contribution, employerSharePaidExternally: external }
	})
	return row
}
