import { error } from '@sveltejs/kit'
import type { ComplaintCategory, ComplaintStatus } from '@prisma/client'
import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { notify } from '$lib/server/services/notifications'
import type { AuditContext } from '$lib/server/services/types'

// HR complaints / inquiries (#112): a two-way thread HR opens against an employee. HR opens
// it (seeding the first message), the employee responds, HR may reply again, and HR resolves
// it. Status pings between OPEN (awaiting the employee) and RESPONDED (awaiting HR) with each
// reply, and lands on RESOLVED when HR closes it. Org scoping is by HrComplaint.organizationId,
// which is stamped at open time and never trusted from client input.

export const COMPLAINT_CATEGORIES: ComplaintCategory[] = [
	'CLASSIFICATION',
	'ATTENDANCE',
	'CONDUCT',
	'PERFORMANCE',
	'OTHER'
]

export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
	CLASSIFICATION: 'Employment classification',
	ATTENDANCE: 'Attendance',
	CONDUCT: 'Conduct',
	PERFORMANCE: 'Performance',
	OTHER: 'Other'
}

export interface OpenComplaintInput {
	employeeId: string
	subject: string
	category: ComplaintCategory
	message: string
}

interface ComplaintFilters {
	status?: ComplaintStatus
	employeeId?: string
}

// HR opens an inquiry against an employee, seeding the thread with the first message.
export async function openComplaint(input: OpenComplaintInput, ctx: AuditContext) {
	const employee = await db.employee.findFirst({
		where: { id: input.employeeId, user: { organizationId: ctx.organizationId } },
		select: { id: true, user: { select: { id: true } } }
	})
	if (!employee) error(404, 'Employee not found')

	const complaint = await db.hrComplaint.create({
		data: {
			organizationId: ctx.organizationId,
			employeeId: employee.id,
			openedById: ctx.actorId,
			subject: input.subject,
			category: input.category,
			status: 'OPEN',
			messages: { create: { authorId: ctx.actorId, body: input.message } }
		}
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'HrComplaint',
		entityId: complaint.id,
		newValue: { subject: input.subject, category: input.category }
	})
	await notify(
		employee.user.id,
		`HR opened an inquiry: ${input.subject}`,
		`/complaints/${complaint.id}`
	)
	return complaint
}

// Append a message to the thread. `actorEmployeeId` is the acting user's own employee id (or
// null) — when it matches the subject the reply is from the employee (→ RESPONDED, notify the
// opener); otherwise it is an HR reply (→ OPEN, notify the employee).
export async function postComplaintMessage(
	complaintId: string,
	body: string,
	ctx: AuditContext,
	actorEmployeeId: string | null
) {
	const complaint = await db.hrComplaint.findFirst({
		where: { id: complaintId, organizationId: ctx.organizationId },
		include: {
			employee: {
				select: { id: true, firstName: true, lastName: true, user: { select: { id: true } } }
			},
			openedBy: { select: { id: true } }
		}
	})
	if (!complaint) error(404, 'Inquiry not found')
	if (complaint.status === 'RESOLVED')
		error(400, 'This inquiry is resolved and can no longer be replied to.')

	const fromEmployee = actorEmployeeId != null && actorEmployeeId === complaint.employeeId
	const status: ComplaintStatus = fromEmployee ? 'RESPONDED' : 'OPEN'

	await db.$transaction([
		db.hrComplaintMessage.create({ data: { complaintId, authorId: ctx.actorId, body } }),
		db.hrComplaint.update({ where: { id: complaintId }, data: { status } })
	])

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'HrComplaint',
		entityId: complaintId,
		newValue: { reply: fromEmployee ? 'employee' : 'hr', status }
	})

	if (fromEmployee) {
		await notify(
			complaint.openedBy.id,
			`${complaint.employee.firstName} ${complaint.employee.lastName} responded to: ${complaint.subject}`,
			`/complaints/${complaintId}`
		)
	} else {
		await notify(
			complaint.employee.user.id,
			`HR replied to inquiry: ${complaint.subject}`,
			`/complaints/${complaintId}`
		)
	}
	return { status }
}

// HR closes the thread.
export async function resolveComplaint(complaintId: string, ctx: AuditContext) {
	const complaint = await db.hrComplaint.findFirst({
		where: { id: complaintId, organizationId: ctx.organizationId },
		include: { employee: { select: { user: { select: { id: true } } } } }
	})
	if (!complaint) error(404, 'Inquiry not found')
	if (complaint.status === 'RESOLVED') return complaint

	const updated = await db.hrComplaint.update({
		where: { id: complaintId },
		data: { status: 'RESOLVED', resolvedAt: new Date() }
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'HrComplaint',
		entityId: complaintId,
		oldValue: { status: complaint.status },
		newValue: { status: 'RESOLVED' }
	})
	await notify(
		complaint.employee.user.id,
		`Your HR inquiry was marked resolved: ${complaint.subject}`,
		`/complaints/${complaintId}`
	)
	return updated
}

// HR-side list (whole org, newest activity first).
export function listComplaintsForOrg(
	organizationId: string,
	filters: ComplaintFilters = {},
	page?: { skip: number; take: number }
) {
	return db.hrComplaint.findMany({
		where: complaintWhere(organizationId, filters),
		include: {
			employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
			_count: { select: { messages: true } }
		},
		orderBy: { updatedAt: 'desc' },
		...(page && { skip: page.skip, take: page.take })
	})
}

export function countComplaintsForOrg(organizationId: string, filters: ComplaintFilters = {}) {
	return db.hrComplaint.count({ where: complaintWhere(organizationId, filters) })
}

// Employee-side list (only the inquiries raised against them).
export function listComplaintsForEmployee(employeeId: string, organizationId: string) {
	return db.hrComplaint.findMany({
		where: { employeeId, organizationId },
		// employee is included (though the subject already knows who they are) to keep the row
		// shape identical to the HR list, so the shared table component needs no per-branch cast.
		include: {
			employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
			_count: { select: { messages: true } }
		},
		orderBy: { updatedAt: 'desc' }
	})
}

export async function getComplaint(id: string, organizationId: string) {
	const complaint = await db.hrComplaint.findFirst({
		where: { id, organizationId },
		include: {
			employee: {
				select: {
					id: true,
					firstName: true,
					lastName: true,
					employeeNumber: true,
					user: { select: { id: true } }
				}
			},
			openedBy: { select: { id: true, email: true } },
			messages: {
				orderBy: { createdAt: 'asc' },
				include: { author: { select: { id: true, email: true } } }
			}
		}
	})
	if (!complaint) error(404, 'Inquiry not found')
	return complaint
}

function complaintWhere(organizationId: string, filters: ComplaintFilters) {
	return {
		organizationId,
		...(filters.status && { status: filters.status }),
		...(filters.employeeId && { employeeId: filters.employeeId })
	}
}
