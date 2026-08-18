import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import type { SeparationType } from '@prisma/client'
import type { AuditContext } from './types'
import { clearanceTemplateForOrg } from './offboarding'
import { currentCompensation } from './payroll/compensation'
import { sendOffboardingNoticeEmail } from '$lib/server/notifications'

// Average paid working days per month — used to convert a monthly salary to a
// daily rate for unused-leave conversion. A deliberate, adjustable simplification;
// swap for the DOLE factor (313/12) if payroll policy requires it.
const WORKING_DAYS_PER_MONTH = 22

export interface CreateSeparationInput {
	employeeId: string
	type: SeparationType
	effectiveDate: Date
	reason?: string
}

export async function createSeparation(
	organizationId: string,
	input: CreateSeparationInput,
	ctx: AuditContext
) {
	const employee = await db.employee.findFirst({
		where: { id: input.employeeId, organizationId },
		select: {
			id: true,
			employmentStatus: true,
			firstName: true,
			lastName: true,
			user: { select: { email: true } }
		}
	})
	if (!employee) error(404, 'Employee not found')
	if (employee.employmentStatus === 'OFFBOARDED') error(409, 'Employee is already offboarded')

	const existing = await db.separationRecord.findFirst({
		where: { employeeId: input.employeeId, status: { not: 'FINALIZED' } },
		select: { id: true }
	})
	if (existing) error(409, 'An open separation case already exists for this employee')

	// Seed the case's clearance items from the org's editable offboarding checklist (#192),
	// falling back to the built-in defaults when none are configured.
	const clearance = await clearanceTemplateForOrg(organizationId)

	const record = await db.separationRecord.create({
		data: {
			organizationId,
			employeeId: input.employeeId,
			type: input.type,
			effectiveDate: input.effectiveDate,
			reason: input.reason || null,
			clearanceItems: { create: clearance }
		}
	})

	await writeAuditLog(ctx, {
		action: 'CREATE',
		entityType: 'SeparationRecord',
		entityId: record.id,
		newValue: { employeeId: input.employeeId, type: input.type, effectiveDate: input.effectiveDate }
	})

	// Email the departing employee a due-diligence / transition-period notice with their
	// effective date and the clearance checklist (#185). Best-effort: a notifier failure
	// must not roll back an opened case.
	try {
		sendOffboardingNoticeEmail(employee.user.email, {
			employeeName: `${employee.firstName} ${employee.lastName}`,
			effectiveDate: input.effectiveDate,
			checklist: clearance
		})
	} catch (e) {
		console.error('[NOTIFY] Failed to email offboarding notice for', record.id, e)
	}

	return record
}

export async function listSeparations(organizationId: string) {
	return db.separationRecord.findMany({
		where: { organizationId },
		orderBy: { createdAt: 'desc' },
		include: {
			employee: { select: { firstName: true, lastName: true, employeeNumber: true } },
			clearanceItems: { select: { status: true } }
		}
	})
}

export async function getSeparation(id: string, organizationId: string) {
	const record = await db.separationRecord.findFirst({
		where: { id, organizationId },
		include: {
			employee: {
				select: {
					id: true,
					firstName: true,
					lastName: true,
					employeeNumber: true,
					jobTitle: true,
					employmentStatus: true,
					department: { select: { name: true } }
				}
			},
			clearanceItems: { orderBy: { area: 'asc' } }
		}
	})
	if (!record) error(404, 'Separation record not found')
	return record
}

export interface ClearanceActorRef {
	status: string
	clearedById: string | null
}

// #297/D3: whoever ticked any box on this case may not close it out. A PURE function on purpose —
// approvals.ts:119 (decidedActorIds) is the same shape, and it makes the rule testable with zero
// DB mocks. This repo's documented failure mode is exactly the vacuous mock (all-tests.md, five
// recorded cases), so the ~10 extra lines buy a test that cannot lie.
// Un-cleared items carry a null clearedById, so a re-opened item stops barring its clearer.
export function clearedAnyItem(items: ClearanceActorRef[], actorId: string): boolean {
	return items.some((i) => i.status === 'CLEARED' && i.clearedById === actorId)
}

// The ONE source of truth for both the server 403 in finalizeSeparation and the greyed-out
// Finalize button on /separations/[id] — computed once so the guard and the button cannot drift.
// Returns the refusal message, or null when the actor may finalize.
//
// Status choice (VALIDATE G4, recorded): the self refusal is 403, NOT offboardEmployee's 400.
// Four self-action bars in this codebase already use 403 (approvals.ts:231,
// employee-access.ts:136, action-proposals.ts:71 and :80) against offboardEmployee's single 400,
// and 403 is what "the request is fine, the ACTOR is refused" means. AC-4.3 asks for consistent
// wording and placement, not a matching status code; offboardEmployee's 400 is a live API
// contract and stays as the deliberate, known outlier.
export async function finalizeBarFor(
	record: { employee: { id: string }; clearanceItems: ClearanceActorRef[] },
	actorId: string
): Promise<string | null> {
	// SCOPED query, not a widened getSeparation select: userId is an identity column and
	// getSeparation's result goes straight to the client. This repo has shipped a select that
	// leaked a field it did not need twice (#111, #290). One extra indexed lookup is the cheaper bug.
	const employee = await db.employee.findUnique({
		where: { id: record.employee.id },
		select: { userId: true }
	})
	// #297/D4: mirrors offboardEmployee (employees.ts:1216) — finalize does the same destructive
	// thing (OFFBOARDED + isActive=false) plus writes off the actor's own loans.
	if (employee?.userId === actorId) {
		return 'You cannot finalize your own separation — ask another admin to do it.'
	}
	// #297/D3.
	if (clearedAnyItem(record.clearanceItems, actorId)) {
		return CLEARER_BAR
	}
	return null
}

// Shared so the pre-flight bar and the re-check inside `finalizeSeparation`'s transaction can
// never word the same refusal two different ways.
export const CLEARER_BAR =
	'You cannot finalize a separation whose clearance items you cleared — ask another HR administrator, or your CEO, to finalize it.'

export async function setClearanceItem(
	itemId: string,
	organizationId: string,
	cleared: boolean,
	ctx: AuditContext
) {
	const item = await db.clearanceItem.findFirst({
		where: { id: itemId, separation: { organizationId } },
		include: { separation: { select: { id: true, status: true } } }
	})
	if (!item) error(404, 'Clearance item not found')
	if (item.separation.status === 'FINALIZED') error(409, 'Separation is already finalized')

	// #297/D8: an item already cleared by somebody else is theirs. Without this the D3 bar is
	// trivially defeatable — B un-ticks A's item (which NULLs clearedById), re-ticks it, becomes
	// the clearer, and can wipe their own bar the same way. Chosen over a full clearance history
	// table, which the owner declined as too big for now.
	//
	// Covers BOTH directions (re-clear AND un-clear) — owner-confirmed 18-08-26, SPEC AC-9.1 and
	// AC-9.2, with AC-9.4 naming the two-step defeat route this closes. The UI's only path to
	// re-clearing is un-clear-then-clear, so barring only the re-clear would leave the defeat intact.
	// NULL-safe: a legacy CLEARED row with no clearedById stays editable rather than frozen.
	if (item.status === 'CLEARED' && item.clearedById && item.clearedById !== ctx.actorId) {
		error(403, 'This clearance item was already cleared by someone else. Only they can change it.')
	}

	await db.clearanceItem.update({
		where: { id: itemId },
		data: {
			status: cleared ? 'CLEARED' : 'PENDING',
			clearedById: cleared ? ctx.actorId : null,
			clearedAt: cleared ? new Date() : null
		}
	})

	// Roll the parent status forward/back so the finalize gate reflects the checklist.
	const remaining = await db.clearanceItem.count({
		where: { separationId: item.separation.id, status: 'PENDING' }
	})
	// `updateMany` with a status floor, NOT `update`: the FINALIZED check at the top of this
	// function is a read, and a finalize landing between it and here would be silently rolled
	// back to CLEARED/OPEN by this line — leaving a record that says OPEN while still carrying
	// `finalizedAt` and `finalizedById`. A finalized case is closed; the roll-forward skips it.
	await db.separationRecord.updateMany({
		where: { id: item.separation.id, status: { not: 'FINALIZED' } },
		data: { status: remaining === 0 ? 'CLEARED' : 'OPEN' }
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'ClearanceItem',
		entityId: itemId,
		newValue: { status: cleared ? 'CLEARED' : 'PENDING' }
	})
}

export interface FinalPayLine {
	label: string
	amount: number // positive = pay to employee, negative = deducted/owed
}

export interface FinalPayResult {
	lines: FinalPayLine[]
	total: number
}

// Snapshot-style final pay: unused paid-leave conversion, minus outstanding loan
// and cash-advance balances. Prorated 13th-month and tax refunds are out of scope
// here (they need YTD payroll) and can be layered on later.
export async function computeFinalPay(
	separationId: string,
	organizationId: string
): Promise<FinalPayResult> {
	const record = await getSeparation(separationId, organizationId)
	const employeeId = record.employee.id

	const [employee, compHistory, leaveBalances, loans, cashAdvances] = await Promise.all([
		db.employee.findUniqueOrThrow({
			where: { id: employeeId },
			select: { basicMonthlySalary: true, rateType: true }
		}),
		// #170 Stage 1.5: final pay reads salary directly (not via getEmployee), so resolve the comp in
		// effect on the separation date from history — a raise effective by then must reach final pay.
		db.employeeCompensation.findMany({
			where: { employeeId },
			select: { basicMonthlySalary: true, rateType: true, effectiveDate: true, changedAt: true }
		}),
		db.leaveBalance.findMany({
			where: { employeeId, year: record.effectiveDate.getFullYear() },
			select: { remaining: true }
		}),
		db.loan.findMany({ where: { employeeId, status: 'ACTIVE' }, select: { balance: true } }),
		db.cashAdvance.findMany({
			where: { employeeId, status: 'ACTIVE' },
			select: { balance: true }
		})
	])

	const comp = currentCompensation(compHistory, record.effectiveDate, {
		basicMonthlySalary: employee.basicMonthlySalary,
		rateType: employee.rateType
	})
	const rate = comp.salary.toNumber()
	// #189: the stored figure means something different per basis (mirror payslip-document.ts). Dividing
	// an hourly/daily rate by the monthly working days would understate the day value 176×/22×.
	const dailyRate =
		comp.rateType === 'HOURLY'
			? rate * 8
			: comp.rateType === 'DAILY'
				? rate
				: rate / WORKING_DAYS_PER_MONTH
	const leaveDays = leaveBalances.reduce((sum, b) => sum + Number(b.remaining), 0)
	const leaveConversion = round2(leaveDays * dailyRate)
	const loanBalance = round2(loans.reduce((sum, l) => sum + Number(l.balance), 0))
	const caBalance = round2(cashAdvances.reduce((sum, c) => sum + Number(c.balance), 0))

	const lines: FinalPayLine[] = [
		{ label: `Unused leave conversion (${leaveDays.toFixed(2)} days)`, amount: leaveConversion },
		{ label: 'Outstanding loan balances', amount: -loanBalance },
		{ label: 'Outstanding cash advances', amount: -caBalance }
	]
	const total = round2(lines.reduce((sum, l) => sum + l.amount, 0))
	return { lines, total }
}

// Finalize: requires all clearance items CLEARED. Snapshots final pay, marks the
// employee OFFBOARDED (endDate = effectiveDate), and deactivates their login.
export async function finalizeSeparation(id: string, organizationId: string, ctx: AuditContext) {
	const record = await getSeparation(id, organizationId)
	if (record.status === 'FINALIZED') error(409, 'Separation is already finalized')

	// #297/D3+D4, ABOVE the pending-items check on purpose: pending-items implicitly says "go clear
	// the rest", but under D3 every item this actor clears deepens their own bar. Same reasoning as
	// approvals.ts:636-639 — the specific refusal stays above the generic one.
	const bar = await finalizeBarFor(record, ctx.actorId)
	if (bar) error(403, bar)

	const pending = record.clearanceItems.filter((i) => i.status !== 'CLEARED').length
	if (pending > 0) error(409, `Cannot finalize — ${pending} clearance item(s) still pending`)

	const finalPay = await computeFinalPay(id, organizationId)

	await db.$transaction(async (tx) => {
		// #297: re-read the clearance rows here. `finalizeBarFor` ran before this transaction
		// opened, so a tick landing in that window would otherwise let an actor finalize a case
		// they had just become a clearer of. The pre-flight bar still runs first — it is what
		// produces the message the UI shows; this is the one that cannot be raced.
		const live = await tx.clearanceItem.findMany({
			where: { separationId: id },
			select: { status: true, clearedById: true }
		})
		if (clearedAnyItem(live, ctx.actorId)) error(403, CLEARER_BAR)

		// Status-guarded update: the check above is only preliminary — a concurrent
		// finalize between it and here would otherwise double-snapshot.
		const updated = await tx.separationRecord.updateMany({
			where: { id, status: { not: 'FINALIZED' } },
			data: {
				status: 'FINALIZED',
				finalPayAmount: new Prisma.Decimal(finalPay.total),
				finalPayBreakdown: finalPay as unknown as Prisma.InputJsonValue,
				finalizedAt: new Date(),
				finalizedById: ctx.actorId
			}
		})
		if (updated.count === 0) error(409, 'Separation is already finalized')

		// The outstanding balances were offset against final pay above — settle them
		// so they don't linger as ACTIVE receivables on an offboarded employee.
		await tx.loan.updateMany({
			where: { employeeId: record.employee.id, status: 'ACTIVE' },
			data: { balance: 0, status: 'PAID' }
		})
		await tx.cashAdvance.updateMany({
			where: { employeeId: record.employee.id, status: 'ACTIVE' },
			data: { balance: 0, status: 'PAID' }
		})

		await tx.employee.update({
			where: { id: record.employee.id },
			data: { employmentStatus: 'OFFBOARDED', endDate: record.effectiveDate }
		})
		await tx.user.updateMany({
			where: { employee: { id: record.employee.id } },
			data: { isActive: false }
		})
	})

	await writeAuditLog(ctx, {
		action: 'UPDATE',
		entityType: 'SeparationRecord',
		entityId: id,
		newValue: { status: 'FINALIZED', finalPayAmount: finalPay.total }
	})

	return finalPay
}

// Separation report rows for the Reports module / CSV export.
export async function generateSeparationReport(
	organizationId: string,
	range: { startDate: Date; endDate: Date }
) {
	const records = await db.separationRecord.findMany({
		where: {
			organizationId,
			effectiveDate: { gte: range.startDate, lte: range.endDate }
		},
		orderBy: { effectiveDate: 'desc' },
		include: {
			employee: {
				select: {
					firstName: true,
					lastName: true,
					employeeNumber: true,
					department: { select: { name: true } }
				}
			},
			clearanceItems: { select: { status: true } }
		}
	})

	// TitleCase keys: the report table renders row[column] and the CSV export uses
	// the keys as headers, matching the other report generators.
	return records.map((r) => {
		const cleared = r.clearanceItems.filter((c) => c.status === 'CLEARED').length
		return {
			EmployeeNumber: r.employee.employeeNumber,
			Employee: `${r.employee.lastName}, ${r.employee.firstName}`,
			Department: r.employee.department?.name ?? '',
			Type: r.type,
			EffectiveDate: r.effectiveDate.toISOString().slice(0, 10),
			Status: r.status,
			Clearance: `${cleared}/${r.clearanceItems.length}`,
			FinalPay: r.finalPayAmount ? Number(r.finalPayAmount).toFixed(2) : ''
		}
	})
}

function round2(n: number) {
	return Math.round(n * 100) / 100
}
