/**
 * Hydrates a PayslipDocument from Prisma, enforcing the same authorization
 * rules as the JSON payslip endpoint. Owns the DB shape → DTO mapping so
 * the assembler stays DB-free and testable.
 */

import { db } from '$lib/server/db'
import { canViewPayrollReports } from '$lib/server/rbac'
import type { Role } from '@prisma/client'
import { isPayslipVisible } from './runs'
import {
	assemblePayslipDocument,
	type HydrateInput,
	type PayslipDocument
} from './payslip-document'

export interface FetchPayslipContext {
	userId: string
	role: Role
	organizationId: string
}

export type FetchResult =
	{ ok: true; document: PayslipDocument } | { ok: false; status: 401 | 403 | 404; message: string }

export async function fetchPayslipDocument(
	entryId: string,
	ctx: FetchPayslipContext
): Promise<FetchResult> {
	const entry = await db.payrollEntry.findUnique({
		where: { id: entryId },
		include: {
			employee: {
				select: {
					firstName: true,
					lastName: true,
					middleName: true,
					employeeNumber: true,
					jobTitle: true,
					employmentType: true,
					basicMonthlySalary: true,
					rateType: true,
					organizationId: true,
					userId: true
				}
			},
			payrollRun: {
				select: {
					periodStart: true,
					periodEnd: true,
					status: true,
					approvedAt: true,
					organizationId: true,
					period: { select: { status: true } }
				}
			},
			earnings: { select: { code: true, label: true, amount: true } },
			deductions: { select: { code: true, label: true, amount: true } }
		}
	})

	if (!entry) return { ok: false, status: 404, message: 'Payslip not found' }
	if (entry.payrollRun.organizationId !== ctx.organizationId) {
		return { ok: false, status: 404, message: 'Payslip not found' }
	}

	// #123: caller either owns the payslip or has a payroll-report capability
	// (SUPER_ADMIN / HR_ADMIN / PAYROLL_OFFICER / FINANCE). MANAGER stays blocked
	// from peers' compensation, in line with #95.
	const isOwn = entry.employee.userId === ctx.userId
	const isPrivileged = canViewPayrollReports(ctx.role)
	if (!isOwn && !isPrivileged) {
		return { ok: false, status: 403, message: 'Access denied' }
	}
	// The "not-yet-approved" gate still applies to owners so an employee can't
	// preview an unreleased run; privileged roles can inspect drafts.
	if (!isPrivileged && !isPayslipVisible(entry.payrollRun)) {
		return { ok: false, status: 403, message: 'Payslip not yet available' }
	}

	const organization = await db.organization.findUnique({
		where: { id: entry.payrollRun.organizationId },
		select: { name: true, address: true, logoUrl: true }
	})
	if (!organization) return { ok: false, status: 404, message: 'Organization not found' }

	// Attendance summary for the period. Working days = distinct AttendanceDay rows in range;
	// present days = those whose status counts as attended (PRESENT or LATE). OT hours per
	// bucket feed the OVERTIME table's HRS column on the PDF.
	const days = await db.attendanceDay.findMany({
		where: {
			employeeId: entry.employeeId,
			date: { gte: entry.payrollRun.periodStart, lte: entry.payrollRun.periodEnd }
		},
		select: {
			status: true,
			lateMinutes: true,
			overtimeHours: true,
			restDayOtHours: true,
			regularHolidayOtHours: true,
			specialHolidayOtHours: true
		}
	})
	const attendance = {
		daysOfWork: days.length,
		daysOfPresent: days.filter((d) => d.status === 'PRESENT' || d.status === 'LATE').length,
		lateMinutes: days.reduce((acc, d) => acc + (d.lateMinutes ?? 0), 0),
		overtimeHours: days.reduce((s, d) => s + Number(d.overtimeHours), 0),
		restDayOtHours: days.reduce((s, d) => s + Number(d.restDayOtHours), 0),
		regularHolidayOtHours: days.reduce((s, d) => s + Number(d.regularHolidayOtHours), 0),
		specialHolidayOtHours: days.reduce((s, d) => s + Number(d.specialHolidayOtHours), 0)
	}

	const input: HydrateInput = {
		entry: {
			hoursWorked: Number(entry.hoursWorked),
			basicPay: Number(entry.basicPay),
			grossPay: Number(entry.grossPay),
			sssEe: Number(entry.sssEe),
			philhealthEe: Number(entry.philhealthEe),
			pagibigEe: Number(entry.pagibigEe),
			withholdingTax: Number(entry.withholdingTax),
			totalDeductions: Number(entry.totalDeductions),
			netPay: Number(entry.netPay),
			earnings: entry.earnings.map((e) => ({
				code: e.code,
				label: e.label,
				amount: Number(e.amount)
			})),
			deductions: entry.deductions.map((d) => ({
				code: d.code,
				label: d.label,
				amount: Number(d.amount)
			}))
		},
		employee: {
			firstName: entry.employee.firstName,
			lastName: entry.employee.lastName,
			middleName: entry.employee.middleName,
			employeeNumber: entry.employee.employeeNumber,
			jobTitle: entry.employee.jobTitle,
			employmentType: entry.employee.employmentType,
			basicMonthlySalary: Number(entry.employee.basicMonthlySalary),
			rateType: entry.employee.rateType
		},
		organization,
		run: {
			periodStart: entry.payrollRun.periodStart,
			periodEnd: entry.payrollRun.periodEnd,
			approvedAt: entry.payrollRun.approvedAt
		},
		attendance
	}

	return { ok: true, document: assemblePayslipDocument(input) }
}
