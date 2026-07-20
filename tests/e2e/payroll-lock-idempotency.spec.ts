import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { login, USERS } from './helpers'

// #102: locking a period commits loan/cash-advance amortization. The status check
// guarding it was a read outside the transaction, so two locks (double-click, retried
// request) both passed it and both subtracted — negative balances, duplicate
// LoanPayment rows, and a voidPeriod that only credits back once.
//
// Drives the real POST /api/v1/payroll/periods/[id]?action=lock rather than calling
// the service directly, so the route, the transaction and the DB constraint are all
// in the path under test.
test.describe.configure({ mode: 'serial' })

const TAG = 'e2e-lock-102'
const PRINCIPAL = 10000
const INSTALLMENT = 2500

let periodId: string
let loanId: string
let entryId: string

async function seed() {
	const db = new PrismaClient()
	try {
		const employee = await db.employee.findFirstOrThrow({
			where: { user: { email: 'employee@veent.ph' } },
			select: { id: true, organizationId: true }
		})

		const loan = await db.loan.create({
			data: {
				employeeId: employee.id,
				type: TAG,
				principal: PRINCIPAL,
				balance: PRINCIPAL,
				installment: INSTALLMENT,
				status: 'ACTIVE'
			}
		})

		const period = await db.payrollPeriod.create({
			data: {
				organizationId: employee.organizationId,
				name: TAG,
				startDate: new Date('2026-01-01'),
				endDate: new Date('2026-01-15'),
				status: 'GENERATED'
			}
		})

		const run = await db.payrollRun.create({
			data: {
				organizationId: employee.organizationId,
				periodId: period.id,
				periodStart: period.startDate,
				periodEnd: period.endDate,
				status: 'COMPUTED'
			}
		})

		const entry = await db.payrollEntry.create({
			data: {
				payrollRunId: run.id,
				employeeId: employee.id,
				hoursWorked: 80,
				basicPay: 20000,
				grossPay: 20000,
				sssEe: 0,
				sssEr: 0,
				philhealthEe: 0,
				philhealthEr: 0,
				pagibigEe: 0,
				pagibigEr: 0,
				withholdingTax: 0,
				totalDeductions: INSTALLMENT,
				netPay: 20000 - INSTALLMENT,
				// The frozen amortization line lock() reads.
				deductions: {
					create: { code: 'LOAN', label: 'Loan', amount: INSTALLMENT, refId: loan.id }
				}
			}
		})

		periodId = period.id
		loanId = loan.id
		entryId = entry.id
	} finally {
		await db.$disconnect()
	}
}

async function cleanup() {
	const db = new PrismaClient()
	try {
		const periods = await db.payrollPeriod.findMany({ where: { name: TAG }, select: { id: true } })
		const runs = await db.payrollRun.findMany({
			where: { periodId: { in: periods.map((p) => p.id) } },
			select: { id: true }
		})
		const runIds = runs.map((r) => r.id)
		await db.loanPayment.deleteMany({ where: { loan: { type: TAG } } })
		await db.payrollDeduction.deleteMany({ where: { entry: { payrollRunId: { in: runIds } } } })
		await db.payrollEntry.deleteMany({ where: { payrollRunId: { in: runIds } } })
		await db.payrollRun.deleteMany({ where: { id: { in: runIds } } })
		await db.payrollPeriod.deleteMany({ where: { name: TAG } })
		await db.loan.deleteMany({ where: { type: TAG } })
	} finally {
		await db.$disconnect()
	}
}

// Clean first: PayrollRun is unique on (organizationId, periodStart, periodEnd), so a
// previous aborted run would otherwise block seeding and the suite could never recover.
test.beforeAll(async () => {
	await cleanup()
	await seed()
})
test.afterAll(cleanup)

test('concurrent period locks decrement the loan exactly once', async ({ page }) => {
	await login(page, USERS.admin)
	const url = `/api/v1/payroll/periods/${periodId}?action=lock`

	// Fired together, deliberately. A sequential replay proves nothing here: the status
	// check at the top of lock() already rejected that before this fix. The bug only
	// appears when both requests read GENERATED before either writes, which is exactly
	// what a double-click or a retried request does.
	const [a, b] = await Promise.all([
		page.request.post(url, { data: {} }),
		page.request.post(url, { data: {} })
	])

	const statuses = [a.status(), b.status()].sort()
	// Exactly one winner; the loser must not have committed anything.
	expect(statuses.filter((s) => s === 200)).toHaveLength(1)

	const db = new PrismaClient()
	try {
		const loan = await db.loan.findUniqueOrThrow({ where: { id: loanId } })
		// Decremented once, not twice: 10000 - 2500, never 5000.
		expect(Number(loan.balance)).toBe(PRINCIPAL - INSTALLMENT)

		const payments = await db.loanPayment.findMany({ where: { loanId } })
		expect(payments).toHaveLength(1)
		expect(Number(payments[0].amount)).toBe(INSTALLMENT)
	} finally {
		await db.$disconnect()
	}
})

test('the unique constraint refuses a duplicate payment for the same entry', async () => {
	// Defence in depth behind the atomic claim: even if a second pass reached the
	// insert, the DB rejects it. Asserted directly because no request can now get there.
	const db = new PrismaClient()
	try {
		await expect(
			db.loanPayment.create({
				data: { loanId, payrollEntryId: entryId, amount: INSTALLMENT }
			})
		).rejects.toThrow()
	} finally {
		await db.$disconnect()
	}
})

test('voiding credits back only what was actually collected', async ({ page }) => {
	await login(page, USERS.admin)
	const response = await page.request.post(`/api/v1/payroll/periods/${periodId}?action=void`, {
		data: {}
	})
	expect(response.status(), await response.text()).toBe(200)

	const db = new PrismaClient()
	try {
		const loan = await db.loan.findUniqueOrThrow({ where: { id: loanId } })
		// Back to the full principal — not more, which is what reversing the frozen
		// deduction line instead of the recorded payments would have produced.
		expect(Number(loan.balance)).toBe(PRINCIPAL)
		expect(loan.status).toBe('ACTIVE')
		expect(await db.loanPayment.count({ where: { loanId } })).toBe(0)
	} finally {
		await db.$disconnect()
	}
})
