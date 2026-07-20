import { describe, it, expect } from 'vitest'
import { renderPayslipPdf } from '../../src/lib/server/services/payroll/payslip-pdf'
import type { PayslipDocument } from '../../src/lib/server/services/payroll/payslip-document'

const doc: PayslipDocument = {
	company: { name: 'MR. LIEMPO', address: '58 Ortigas Extension Pasig City', logoUrl: null },
	employee: {
		fullName: 'MANZANO, LANIE O.',
		employeeNumber: '0005',
		position: 'GRILLWOMAN',
		status: 'REGULAR'
	},
	period: {
		periodLabel: '5/11/22 to  5/25/22',
		payDate: '5/30/22',
		dailyRate: '540.00',
		daysOfWork: '13',
		daysOfPresent: '13',
		basicPay: '7,020.00'
	},
	summary: { overtime: '2,246.40', thirteenthMonth: '0.00', allowance: '0.00' },
	overtimeRows: [{ label: 'REGULAR', hours: '26', pay: '2,246.40' }],
	adjustments: [
		{ label: '13TH MONTH', amount: '0.00' },
		{ label: 'INCENTIVE', amount: '0.00' },
		{ label: 'PAID LEAVES', amount: '0.00' },
		{ label: 'HOLIDAY PAY', amount: '0.00' },
		{ label: 'OTHERS', amount: '0.00' }
	],
	deductions: [
		{ label: 'W/H TAX', amount: '0.00' },
		{ label: 'SSS', amount: '350.00' },
		{ label: 'PHILHEALTH', amount: '150.00' },
		{ label: 'PAG-IBIG', amount: '100.00' },
		{ label: 'TARDINESS', amount: '0.00' },
		{ label: 'LOAN', amount: '0.00' },
		{ label: 'OTHERS', amount: '0.00' }
	],
	totals: { grossPay: '9,266.40', deduction: '600.00', netPay: '8,666.40' }
}

describe('renderPayslipPdf', () => {
	it('produces non-empty PDF bytes', async () => {
		const buf = await renderPayslipPdf(doc)
		expect(buf.byteLength).toBeGreaterThan(1000)
	})

	it('starts with the PDF magic bytes (%PDF-)', async () => {
		const buf = await renderPayslipPdf(doc)
		expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
	})

	it('ends with the PDF EOF marker (%%EOF)', async () => {
		const buf = await renderPayslipPdf(doc)
		const tail = buf.subarray(-6).toString('ascii')
		expect(tail).toContain('%%EOF')
	})
})
