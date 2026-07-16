import { error, fail, isHttpError } from '@sveltejs/kit'
import { requireMinRole, requireRole } from '$lib/server/rbac'
import {
	getEmployee,
	updateEmployee,
	offboardEmployee,
	getEmploymentHistory
} from '$lib/server/services/employees'
import { listPositions } from '$lib/server/services/settings/org'
import {
	listLoans,
	listCashAdvances,
	createLoan,
	createCashAdvance
} from '$lib/server/services/payroll/loans'
import { listSchedules } from '$lib/server/services/attendance/schedules'
import {
	listEmployeeDocuments,
	saveEmployeeDocument,
	deleteEmployeeDocument
} from '$lib/server/services/documents'
import { addEmergencyContact, deleteEmergencyContact } from '$lib/server/services/emergencyContacts'
import { db } from '$lib/server/db'
import { z } from 'zod'
import type { Actions, PageServerLoad } from './$types'

const DOC_CATEGORIES = [
	'CONTRACT',
	'GOVERNMENT_ID',
	'RESUME',
	'PAYROLL_FORM',
	'EXIT_DOCUMENT',
	'OTHER'
] as const

function ctxOf(locals: App.Locals, ip: string) {
	return {
		organizationId: locals.user!.organizationId,
		actorId: locals.user!.id,
		actorRole: locals.user!.role,
		ipAddress: ip
	}
}

// Onboarding checklist (T178 / FR-071): derived from the employee's own record so
// completing the 201 file *is* completing onboarding — no separate data entry, and
// everything flows straight into payroll/attendance.
type OnboardingStep = { key: string; label: string; done: boolean; hint: string }
function buildOnboarding(
	emp: Awaited<ReturnType<typeof getEmployee>>,
	documents: { category: string }[]
) {
	const hasContract = documents.some((d) => d.category === 'CONTRACT')
	const hasDisbursement = !!(
		(emp.bankName && emp.bankAccountName && emp.bankAccountNumber) ||
		emp.gcashNumber
	)
	const govComplete = !!(
		emp.sssNumber &&
		emp.philhealthNumber &&
		emp.pagibigNumber &&
		emp.tinNumber
	)
	const steps: OnboardingStep[] = [
		{
			key: 'account',
			label: 'Company account created',
			done: !!emp.user?.isActive,
			hint: 'A login is generated with the employee record.'
		},
		{
			key: 'position',
			label: 'Position assigned',
			done: !!emp.positionId,
			hint: 'Set “Position” in Update Profile below.'
		},
		{
			key: 'schedule',
			// The built-in default (Mon–Fri 9–6) applies when none is explicitly
			// assigned, so a schedule is always in effect and attendance always
			// tracks — the default counts as satisfied here.
			label: emp.workScheduleId ? 'Work schedule assigned' : 'Work schedule (default)',
			done: true,
			hint: 'Set “Work Schedule” below — this starts attendance tracking.'
		},
		{
			key: 'salary',
			label: 'Compensation set',
			done: Number(emp.basicMonthlySalary ?? 0) > 0,
			hint: 'Set “Basic Monthly Salary” below.'
		},
		{
			key: 'disbursement',
			label: 'Payroll disbursement registered',
			done: hasDisbursement,
			hint: 'Add bank or GCash details under Disbursement.'
		},
		{
			key: 'govids',
			label: 'Government IDs on file',
			done: govComplete,
			hint: 'SSS, PhilHealth, Pag-IBIG, and TIN.'
		},
		{
			key: 'contract',
			label: 'Signed contract uploaded',
			done: hasContract,
			hint: 'Upload a “Contract” document below.'
		}
	]
	const doneCount = steps.filter((s) => s.done).length
	return { steps, doneCount, total: steps.length, complete: doneCount === steps.length }
}

export const load: PageServerLoad = async ({ locals, params }) => {
	requireMinRole(locals.user!.role, 'MANAGER')

	const canManage = ['HR_ADMIN', 'SUPER_ADMIN'].includes(locals.user!.role)

	const employee = await getEmployee(params.id, locals.user!.organizationId, locals.user!.role)

	// Object-level access control: a MANAGER may only open their own direct
	// reports' 201 file. HR/Super-Admin are unrestricted. (Field-level masking of
	// salary/government IDs/bank details is handled inside getEmployee.)
	if (!canManage) {
		const self = await db.employee.findUnique({
			where: { userId: locals.user!.id },
			select: { id: true }
		})
		if (!self || employee.reportsToId !== self.id) {
			error(403, 'You can only view your own team members.')
		}
	}

	const [departments, loans, cashAdvances, documents, positions, history] = await Promise.all([
		db.department.findMany({
			where: { organizationId: locals.user!.organizationId },
			orderBy: { name: 'asc' }
		}),
		canManage ? listLoans(params.id) : Promise.resolve([]),
		canManage ? listCashAdvances(params.id) : Promise.resolve([]),
		canManage ? listEmployeeDocuments(params.id, locals.user!.organizationId) : Promise.resolve([]),
		canManage ? listPositions(locals.user!.organizationId) : Promise.resolve([]),
		canManage ? getEmploymentHistory(params.id, locals.user!.organizationId) : Promise.resolve([])
	])
	const schedules = canManage ? await listSchedules(locals.user!.organizationId) : []
	const onboarding = canManage ? buildOnboarding(employee, documents) : null

	return {
		employee,
		departments,
		canManage,
		loans,
		cashAdvances,
		schedules,
		documents,
		positions,
		history,
		onboarding
	}
}

const loanSchema = z.object({
	type: z.string().optional(),
	principal: z.coerce.number().positive(),
	installment: z.coerce.number().positive()
})
const cashAdvanceSchema = z.object({
	amount: z.coerce.number().positive(),
	installment: z.coerce.number().positive()
})

const updateSchema = z.object({
	jobTitle: z.string().min(1).optional(),
	departmentId: z.string().optional(),
	contactPhone: z.string().optional(),
	contactAddress: z.string().optional(),
	basicMonthlySalary: z.coerce.number().positive().optional(),
	// Empty string clears the link; a value sets it (unique per employee).
	discordId: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : null)),
	workScheduleId: z
		.string()
		.optional()
		.transform((v) => (v ? v : null)),
	// Emergency contact (personal — visible to the employee's managers).
	emergencyContactName: z.string().optional(),
	emergencyContactRelation: z.string().optional(),
	emergencyContactPhone: z.string().optional(),
	// Position from the catalog. Empty string clears the assignment.
	positionId: z
		.string()
		.optional()
		.transform((v) => (v ? v : null)),
	// Government / statutory IDs (payroll registration). Empty clears the field.
	sssNumber: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : null)),
	philhealthNumber: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : null)),
	pagibigNumber: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : null)),
	tinNumber: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : null)),
	// Disbursement details (sensitive, HR-only). Empty string clears the field.
	bankName: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : null)),
	bankAccountName: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : null)),
	bankAccountNumber: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : null)),
	gcashNumber: z
		.string()
		.trim()
		.optional()
		.transform((v) => (v ? v : null))
})

const emergencyContactSchema = z.object({
	name: z.string().trim().min(1),
	relationship: z.string().trim().min(1),
	phone: z.string().trim().min(1)
})

export const actions: Actions = {
	update: async ({ request, locals, params, getClientAddress }) => {
		requireMinRole(locals.user!.role, 'HR_ADMIN')
		const user = locals.user!

		const raw = Object.fromEntries(await request.formData())
		const parsed = updateSchema.safeParse(raw)
		if (!parsed.success) return fail(400, { error: 'Invalid input' })

		try {
			await updateEmployee(params.id, user.organizationId, parsed.data, {
				organizationId: user.organizationId,
				actorId: user.id,
				actorRole: user.role,
				ipAddress: getClientAddress()
			})
		} catch (e: unknown) {
			// Unique constraint on Employee.discordId
			if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
				return fail(409, { error: 'That Discord ID is already linked to another employee.' })
			}
			throw e
		}

		return { success: true }
	},

	offboard: async ({ request, locals, params, getClientAddress }) => {
		requireMinRole(locals.user!.role, 'HR_ADMIN')
		const user = locals.user!

		const data = await request.formData()
		const endDate = new Date(data.get('endDate') as string)

		await offboardEmployee(params.id, user.organizationId, endDate, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
	},

	addLoan: async ({ request, locals, params, getClientAddress }) => {
		requireMinRole(locals.user!.role, 'HR_ADMIN')
		const user = locals.user!
		const parsed = loanSchema.safeParse(Object.fromEntries(await request.formData()))
		if (!parsed.success) return fail(400, { error: 'Invalid loan details' })
		await createLoan(params.id, user.organizationId, parsed.data, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
		return { success: true }
	},

	addCashAdvance: async ({ request, locals, params, getClientAddress }) => {
		requireMinRole(locals.user!.role, 'HR_ADMIN')
		const user = locals.user!
		const parsed = cashAdvanceSchema.safeParse(Object.fromEntries(await request.formData()))
		if (!parsed.success) return fail(400, { error: 'Invalid cash-advance details' })
		await createCashAdvance(params.id, user.organizationId, parsed.data, {
			organizationId: user.organizationId,
			actorId: user.id,
			actorRole: user.role,
			ipAddress: getClientAddress()
		})
		return { success: true }
	},

	addEmergencyContact: async ({ request, locals, params, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')
		const parsed = emergencyContactSchema.safeParse(Object.fromEntries(await request.formData()))
		if (!parsed.success) return fail(400, { error: 'Name, relationship, and phone are required.' })
		try {
			await addEmergencyContact(
				params.id,
				locals.user!.organizationId,
				parsed.data,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { success: true }
	},

	deleteEmergencyContact: async ({ request, locals, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')
		const contactId = (await request.formData()).get('contactId') as string
		if (!contactId) return fail(400, { error: 'Missing contact id.' })
		try {
			await deleteEmergencyContact(
				contactId,
				locals.user!.organizationId,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { success: true }
	},

	uploadDocument: async ({ request, locals, params, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')

		const data = await request.formData()
		const file = data.get('file')
		const categoryRaw = data.get('category') as string
		const label = (data.get('label') as string) || ''

		if (!(file instanceof File) || file.size === 0)
			return fail(400, { error: 'Please choose a file to upload.' })
		const category = DOC_CATEGORIES.includes(categoryRaw as never)
			? (categoryRaw as (typeof DOC_CATEGORIES)[number])
			: 'OTHER'
		const bytes = Buffer.from(await file.arrayBuffer())

		try {
			await saveEmployeeDocument(
				params.id,
				locals.user!.organizationId,
				{ category, label, fileName: file.name, mimeType: file.type, bytes },
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { success: true }
	},

	deleteDocument: async ({ request, locals, getClientAddress }) => {
		requireRole(locals.user!.role, 'HR_ADMIN', 'SUPER_ADMIN')
		const docId = (await request.formData()).get('docId') as string
		if (!docId) return fail(400, { error: 'Missing document id.' })
		try {
			await deleteEmployeeDocument(
				docId,
				locals.user!.organizationId,
				ctxOf(locals, getClientAddress())
			)
		} catch (e: unknown) {
			if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
			throw e
		}
		return { success: true }
	}
}
