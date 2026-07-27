import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { login, USERS } from './helpers'

// #97: GET /api/v1/payroll/payslips/[id] looked the entry up by id alone and only
// enforced ownership for the EMPLOYEE role, so every privileged role (MANAGER, HR_ADMIN,
// PAYROLL_OFFICER, FINANCE, SUPER_ADMIN) could read another organization's payslip —
// full salary breakdown plus employee PII — just by knowing an id.
//
// The seed ships a single org, so this spec builds a second one to have something
// genuinely foreign to reach for, and removes it afterwards.
//
// Serial — beforeAll runs once per worker under fullyParallel, so without this the file's
// tests land on different workers and race to create the same hard-coded FOREIGN org id
// (Prisma unique-constraint failure in setup). Same reason pii/timesheet-punch are serial.
test.describe.configure({ mode: 'serial' })

const FOREIGN = 'e2e-tenancy-97'
// Distinct period so it can't collide with @@unique([organizationId, periodStart, periodEnd]).
const OWN_PERIOD = { start: new Date('2025-03-01'), end: new Date('2025-03-15') }

let foreignEntryId: string
let ownEntryId: string

test.beforeAll(async () => {
	const db = new PrismaClient()
	try {
		const org = await db.organization.create({
			data: { id: FOREIGN, name: 'Rival Corp' }
		})
		const dept = await db.department.create({
			data: { organizationId: org.id, name: 'Rival Dept' }
		})
		const user = await db.user.create({
			data: {
				organizationId: org.id,
				email: `${FOREIGN}@rival.test`,
				passwordHash: 'not-a-real-hash',
				role: 'EMPLOYEE'
			}
		})
		const employee = await db.employee.create({
			data: {
				userId: user.id,
				organizationId: org.id,
				employeeNumber: 'RIV-0001',
				firstName: 'Rival',
				lastName: 'Employee',
				departmentId: dept.id,
				jobTitle: 'Analyst',
				employmentType: 'FULL_TIME',
				startDate: new Date('2025-01-01'),
				basicMonthlySalary: 99999
			}
		})
		// APPROVED so the payslip is genuinely visible — otherwise a 403 could come from
		// the visibility gate and the tenancy check would go untested.
		const run = await db.payrollRun.create({
			data: {
				organizationId: org.id,
				periodStart: new Date('2025-02-01'),
				periodEnd: new Date('2025-02-15'),
				status: 'APPROVED'
			}
		})
		const entry = await db.payrollEntry.create({
			data: {
				payrollRunId: run.id,
				employeeId: employee.id,
				hoursWorked: 80,
				basicPay: 50000,
				grossPay: 50000,
				sssEe: 0,
				sssEr: 0,
				philhealthEe: 0,
				philhealthEr: 0,
				pagibigEe: 0,
				pagibigEr: 0,
				withholdingTax: 0,
				totalDeductions: 0,
				netPay: 50000
			}
		})
		foreignEntryId = entry.id

		// A matching payslip inside the seeded org, so the positive control below is a
		// real assertion rather than a skip: the scope must block the foreign row and
		// still return this one.
		const own = await db.employee.findFirstOrThrow({
			where: { user: { email: 'employee@veent.ph' } },
			select: { id: true, organizationId: true }
		})
		const ownRun = await db.payrollRun.create({
			data: {
				organizationId: own.organizationId,
				periodStart: OWN_PERIOD.start,
				periodEnd: OWN_PERIOD.end,
				status: 'APPROVED'
			}
		})
		const ownEntry = await db.payrollEntry.create({
			data: {
				payrollRunId: ownRun.id,
				employeeId: own.id,
				hoursWorked: 80,
				basicPay: 30000,
				grossPay: 30000,
				sssEe: 0,
				sssEr: 0,
				philhealthEe: 0,
				philhealthEr: 0,
				pagibigEe: 0,
				pagibigEr: 0,
				withholdingTax: 0,
				totalDeductions: 0,
				netPay: 30000
			}
		})
		ownEntryId = ownEntry.id
	} finally {
		await db.$disconnect()
	}
})

test.afterAll(async () => {
	const db = new PrismaClient()
	try {
		// Children first — these relations are all RESTRICT on delete.
		await db.payrollEntry.deleteMany({
			where: { payrollRun: { periodStart: OWN_PERIOD.start, periodEnd: OWN_PERIOD.end } }
		})
		await db.payrollRun.deleteMany({
			where: { periodStart: OWN_PERIOD.start, periodEnd: OWN_PERIOD.end }
		})
		await db.payrollEntry.deleteMany({ where: { payrollRun: { organizationId: FOREIGN } } })
		await db.payrollRun.deleteMany({ where: { organizationId: FOREIGN } })
		await db.employee.deleteMany({ where: { organizationId: FOREIGN } })
		await db.user.deleteMany({ where: { organizationId: FOREIGN } })
		await db.department.deleteMany({ where: { organizationId: FOREIGN } })
		await db.organization.deleteMany({ where: { id: FOREIGN } })
	} finally {
		await db.$disconnect()
	}
})

// Every privileged role, not just one: the bug was that the ownership branch ran for
// EMPLOYEE only, so each of these had an unguarded path to the row.
for (const role of ['admin', 'manager'] as const) {
	test(`${role} cannot read another organization's payslip`, async ({ page }) => {
		await login(page, USERS[role])
		const response = await page.request.get(`/api/v1/payroll/payslips/${foreignEntryId}`)

		// 404, not 403: a foreign id must be indistinguishable from one that doesn't exist.
		expect(response.status()).toBe(404)

		// And none of the payslip's contents leak through the error body.
		const body = await response.text()
		expect(body).not.toContain('Rival')
		expect(body).not.toContain('50000')
		expect(body).not.toContain('RIV-0001')
	})
}

test('an in-org payslip is still readable — the scope did not over-block', async ({ page }) => {
	await login(page, USERS.admin)
	const response = await page.request.get(`/api/v1/payroll/payslips/${ownEntryId}`)
	expect(response.status()).toBe(200)
})

// IDOR: the ownership branch used to run for EMPLOYEE only, so an in-org, non-owner role
// without payroll-view access (a pure sign-off Verifier) could read someone else's payslip.
// It must now be denied — only payroll-report viewers see payslips they don't own.
test('an in-org non-owner without payroll access cannot read another employee’s payslip', async ({
	page
}) => {
	await login(page, USERS.verifier)
	const response = await page.request.get(`/api/v1/payroll/payslips/${ownEntryId}`)
	expect(response.status()).toBe(403)

	const body = await response.text()
	expect(body).not.toContain('philhealthEe')
	expect(body).not.toContain('grossPay')
})
