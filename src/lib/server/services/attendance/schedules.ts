import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import type { AuditContext } from '../types'

/**
 * Work-schedule CRUD (Slice 4). A schedule holds a shift (start/end/break) applied to a set of
 * weekdays; weekdays without a row are rest days. Employees reference a schedule via
 * `Employee.workScheduleId`; unassigned employees fall back to the Mon–Fri default in the
 * attendance engine.
 */

export function listSchedules(organizationId: string) {
	return db.workSchedule.findMany({
		where: { organizationId },
		include: { days: { orderBy: { weekday: 'asc' } }, _count: { select: { employees: true } } },
		orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]
	})
}

export async function createSchedule(
	organizationId: string,
	data: {
		name: string
		isDefault?: boolean
		startMinutes: number
		endMinutes: number
		breakMinutes: number
		weekdays: number[]
	},
	ctx: AuditContext
) {
	if (data.endMinutes <= data.startMinutes) error(400, 'End time must be after start time')
	if (data.weekdays.length === 0) error(400, 'Select at least one working day')

	const schedule = await db.$transaction(async (tx: Prisma.TransactionClient) => {
		if (data.isDefault)
			await tx.workSchedule.updateMany({ where: { organizationId }, data: { isDefault: false } })
		return tx.workSchedule.create({
			data: {
				organizationId,
				name: data.name,
				isDefault: data.isDefault ?? false,
				days: {
					create: data.weekdays.map((weekday) => ({
						weekday,
						startMinutes: data.startMinutes,
						endMinutes: data.endMinutes,
						breakMinutes: data.breakMinutes
					}))
				}
			}
		})
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'WorkSchedule',
		entityId: schedule.id,
		newValue: {
			name: data.name,
			weekdays: data.weekdays,
			startMinutes: data.startMinutes,
			endMinutes: data.endMinutes
		}
	})
	return schedule
}

/** Assign (or clear, with null) an employee's work schedule. */
export async function assignSchedule(
	employeeId: string,
	organizationId: string,
	scheduleId: string | null,
	ctx: AuditContext
) {
	const emp = await db.employee.findFirst({
		where: { id: employeeId, user: { organizationId } },
		select: { id: true }
	})
	if (!emp) error(404, 'Employee not found')
	if (scheduleId) {
		const s = await db.workSchedule.findFirst({
			where: { id: scheduleId, organizationId },
			select: { id: true }
		})
		if (!s) error(404, 'Work schedule not found')
	}
	await db.employee.update({ where: { id: employeeId }, data: { workScheduleId: scheduleId } })
	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'Employee',
		entityId: employeeId,
		newValue: { workScheduleId: scheduleId }
	})
}
