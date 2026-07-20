/**
 * PDF renderer for the payslip. Consumes a PayslipDocument (all display strings
 * already formatted) and produces a single-page landscape PDF that mirrors the
 * legacy paper template:
 *   [ COMPANY name/address | PERIOD/DAILY-RATE/PAYDATE | DoW/DoP/BASIC-PAY ]
 *   [ EMPLOYEE / POSITION | STATUS / EMPLOYEE NO      | OT / 13TH / ALLOWANCE ]
 *   [ OVERTIME | ADJUSTMENTS | DEDUCTION | GROSS/DED/NET + Received-By ]
 *
 * pdfkit gives us cell-level x/y control, which is what a hand-drawn
 * template like this needs (pdfmake's table auto-layout drifts off-grid).
 */

import PDFDocument from 'pdfkit'
import type { PayslipDocument } from './payslip-document'

// Fetch a remote image into a Buffer for pdfkit.image(). Returns null on any
// failure (bad URL, non-image, network error) so a broken logoUrl never breaks
// the whole PDF render. Only http(s) URLs are honored.
async function fetchImageBuffer(url: string | null): Promise<Buffer | null> {
	if (!url || !/^https?:\/\//i.test(url)) return null
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
		if (!res.ok) return null
		const ct = res.headers.get('content-type') ?? ''
		if (!/^image\/(png|jpe?g)/i.test(ct)) return null
		return Buffer.from(await res.arrayBuffer())
	} catch {
		return null
	}
}

// ─── Layout constants (all values in PDF points; 1pt = 1/72") ─────────────────
const PAGE_WIDTH = 792 // A4 landscape width
const PAGE_HEIGHT = 480 // capped short: the paper template is landscape-half
const MARGIN = 24
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

const FONT_REG = 'Helvetica'
const FONT_BOLD = 'Helvetica-Bold'

const HEADER_H = 78 // top row: company/period/basic-pay
const IDENTITY_H = 60 // employee identity band
const BODY_H = 220 // OT + adjustments + deductions + totals

// Column split for the body row (left → right).
const COL_OT_W = 195
const COL_ADJ_W = 175
const COL_DED_W = 200
const COL_TOT_W = CONTENT_WIDTH - COL_OT_W - COL_ADJ_W - COL_DED_W

// ─── Primitives ───────────────────────────────────────────────────────────────

type Doc = PDFKit.PDFDocument

function box(doc: Doc, x: number, y: number, w: number, h: number) {
	doc.lineWidth(0.5).rect(x, y, w, h).stroke()
}

function textAt(
	doc: Doc,
	txt: string,
	x: number,
	y: number,
	opts: {
		width?: number
		align?: 'left' | 'right' | 'center'
		font?: string
		size?: number
	} = {}
) {
	doc
		.font(opts.font ?? FONT_REG)
		.fontSize(opts.size ?? 8)
		.text(txt, x, y, {
			width: opts.width,
			align: opts.align ?? 'left',
			lineBreak: false
		})
}

// One "label: value" pair on a single line inside a fixed-width column.
function labelValue(
	doc: Doc,
	label: string,
	value: string,
	x: number,
	y: number,
	w: number,
	opts: { valueBold?: boolean; size?: number } = {}
) {
	const size = opts.size ?? 8
	textAt(doc, label, x + 4, y, { width: w * 0.55, font: FONT_BOLD, size })
	textAt(doc, value, x + w * 0.55, y, {
		width: w * 0.45 - 4,
		align: 'right',
		font: opts.valueBold ? FONT_BOLD : FONT_REG,
		size
	})
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function drawHeader(
	doc: Doc,
	d: PayslipDocument,
	x: number,
	y: number,
	w: number,
	h: number,
	logo: Buffer | null
) {
	box(doc, x, y, w, h)
	const colLeftW = w * 0.42
	const colMidW = w * 0.32
	const colRightW = w - colLeftW - colMidW

	// Column separators.
	doc
		.lineWidth(0.5)
		.moveTo(x + colLeftW, y)
		.lineTo(x + colLeftW, y + h)
		.stroke()
	doc
		.moveTo(x + colLeftW + colMidW, y)
		.lineTo(x + colLeftW + colMidW, y + h)
		.stroke()

	// Left: optional logo + company block.
	const logoSize = 48
	let textX = x + 8
	if (logo) {
		try {
			doc.image(logo, x + 8, y + (h - logoSize) / 2, {
				fit: [logoSize, logoSize]
			})
			textX = x + 8 + logoSize + 8
		} catch {
			// Corrupt image bytes — ignore and fall back to name-only header.
		}
	}
	textAt(doc, d.company.name, textX, y + 10, {
		width: colLeftW - (textX - x) - 8,
		font: FONT_BOLD,
		size: 20
	})
	textAt(doc, d.company.address, textX, y + 42, {
		width: colLeftW - (textX - x) - 8,
		font: FONT_BOLD,
		size: 8
	})

	// Middle: period/daily-rate/paydate.
	const midX = x + colLeftW
	labelValue(doc, 'PERIOD :', d.period.periodLabel, midX, y + 14, colMidW)
	labelValue(doc, 'DAILY RATE:', d.period.dailyRate, midX, y + 34, colMidW)
	labelValue(doc, 'PAYDATE:', d.period.payDate, midX, y + 54, colMidW)

	// Right: days-of-work/days-of-present/basic-pay.
	const rightX = x + colLeftW + colMidW
	labelValue(doc, 'Days of Work', d.period.daysOfWork, rightX, y + 14, colRightW, {
		valueBold: true
	})
	labelValue(doc, 'Days of Present', d.period.daysOfPresent, rightX, y + 34, colRightW, {
		valueBold: true
	})
	labelValue(doc, 'BASIC PAY:', d.period.basicPay, rightX, y + 54, colRightW, {
		valueBold: true
	})
}

function drawIdentity(doc: Doc, d: PayslipDocument, x: number, y: number, w: number, h: number) {
	box(doc, x, y, w, h)
	const rowH = h / 3
	// Horizontal separators between the 3 sub-rows.
	for (let i = 1; i < 3; i++) {
		doc
			.lineWidth(0.5)
			.moveTo(x, y + rowH * i)
			.lineTo(x + w, y + rowH * i)
			.stroke()
	}

	// Layout: two "label|value" pairs on the left + right, plus a summary block on the far right.
	const leftLabelW = 70
	const leftValueW = 175
	const rightLabelW = 90
	const rightValueW = 110
	const summaryX = x + leftLabelW + leftValueW + rightLabelW + rightValueW
	const summaryW = w - (summaryX - x)

	// Vertical separator before the summary column.
	doc
		.lineWidth(0.5)
		.moveTo(summaryX, y)
		.lineTo(summaryX, y + h)
		.stroke()

	// Row 1: EMPLOYEE / STATUS / OVERTIME
	textAt(doc, 'EMPLOYEE:', x + 4, y + 6, { font: FONT_BOLD, size: 8, width: leftLabelW })
	textAt(doc, d.employee.fullName, x + leftLabelW, y + 6, {
		font: FONT_BOLD,
		size: 8,
		width: leftValueW
	})
	textAt(doc, 'STATUS:', x + leftLabelW + leftValueW, y + 6, {
		font: FONT_BOLD,
		size: 8,
		width: rightLabelW,
		align: 'right'
	})
	textAt(doc, d.employee.status, x + leftLabelW + leftValueW + rightLabelW + 4, y + 6, {
		size: 8,
		width: rightValueW - 8,
		align: 'left'
	})
	labelValue(doc, 'OVERTIME :', d.summary.overtime, summaryX, y + 6, summaryW, {
		valueBold: true
	})

	// Row 2: POSITION / EMPLOYEE NO / 13TH MONTH
	textAt(doc, 'POSITION:', x + 4, y + rowH + 6, { font: FONT_BOLD, size: 8, width: leftLabelW })
	textAt(doc, d.employee.position, x + leftLabelW, y + rowH + 6, {
		font: FONT_BOLD,
		size: 8,
		width: leftValueW
	})
	textAt(doc, 'EMPLOYEE NO:', x + leftLabelW + leftValueW, y + rowH + 6, {
		font: FONT_BOLD,
		size: 8,
		width: rightLabelW,
		align: 'right'
	})
	textAt(
		doc,
		d.employee.employeeNumber,
		x + leftLabelW + leftValueW + rightLabelW + 4,
		y + rowH + 6,
		{ size: 8, width: rightValueW - 8 }
	)
	labelValue(doc, '13TH MONTH :', d.summary.thirteenthMonth, summaryX, y + rowH + 6, summaryW)

	// Row 3: (empty | empty | ALLOWANCE)
	labelValue(doc, 'ALLOWANCE :', d.summary.allowance, summaryX, y + rowH * 2 + 6, summaryW)
}

// A generic column that draws a bordered box with a header row and data rows.
function drawTableColumn(
	doc: Doc,
	x: number,
	y: number,
	w: number,
	h: number,
	headers: string[],
	widths: number[],
	rows: string[][]
) {
	box(doc, x, y, w, h)
	const rowH = 18
	// Header
	let cx = x
	headers.forEach((label, i) => {
		const colW = widths[i] ?? 0
		textAt(doc, label, cx + 4, y + 5, {
			font: FONT_BOLD,
			size: 8,
			width: colW - 8,
			align: i === 0 ? 'left' : 'right'
		})
		cx += colW
	})
	// Underline the header
	doc
		.lineWidth(0.5)
		.moveTo(x, y + rowH)
		.lineTo(x + w, y + rowH)
		.stroke()
	// Vertical separators
	cx = x
	for (let i = 0; i < widths.length - 1; i++) {
		cx += widths[i] ?? 0
		doc
			.lineWidth(0.5)
			.moveTo(cx, y)
			.lineTo(cx, y + h)
			.stroke()
	}
	// Body
	rows.forEach((cells, ri) => {
		const rowY = y + rowH + ri * rowH
		let colX = x
		cells.forEach((cell, ci) => {
			const colW = widths[ci] ?? 0
			textAt(doc, cell, colX + 4, rowY + 5, {
				size: 8,
				width: colW - 8,
				align: ci === 0 ? 'left' : 'right'
			})
			colX += colW
		})
	})
}

function drawOvertime(doc: Doc, d: PayslipDocument, x: number, y: number, w: number, h: number) {
	drawTableColumn(
		doc,
		x,
		y,
		w,
		h,
		['OVERTIME', 'HRS', 'PAY'],
		[w * 0.4, w * 0.25, w * 0.35],
		d.overtimeRows.map((r) => [r.label, r.hours, r.pay])
	)
}

function drawAdjustments(doc: Doc, d: PayslipDocument, x: number, y: number, w: number, h: number) {
	drawTableColumn(
		doc,
		x,
		y,
		w,
		h,
		['ADJUSTMENTS', 'AMOUNT'],
		[w * 0.55, w * 0.45],
		d.adjustments.map((r) => [r.label, r.amount])
	)
}

function drawDeductions(doc: Doc, d: PayslipDocument, x: number, y: number, w: number, h: number) {
	drawTableColumn(
		doc,
		x,
		y,
		w,
		h,
		['DEDUCTION', 'AMOUNT'],
		[w * 0.55, w * 0.45],
		d.deductions.map((r) => [r.label, r.amount])
	)
}

function drawTotals(doc: Doc, d: PayslipDocument, x: number, y: number, w: number, h: number) {
	box(doc, x, y, w, h)
	const rowH = 16
	let cursor = y

	// Small "SUMMARY" caption so the column has a header matching the neighbors.
	textAt(doc, 'SUMMARY', x + 4, cursor + 5, {
		font: FONT_BOLD,
		size: 8,
		width: w - 8
	})
	cursor += rowH
	doc
		.lineWidth(0.5)
		.moveTo(x, cursor)
		.lineTo(x + w, cursor)
		.stroke()

	// Arithmetic breakdown lead-in: BASIC + OVERTIME = GROSS.
	labelValue(doc, '  Basic Pay', d.period.basicPay, x, cursor + 5, w)
	cursor += rowH
	labelValue(doc, '+ Overtime', d.summary.overtime, x, cursor + 5, w)
	cursor += rowH

	// Sum-underline that runs from the middle to the right edge (accountant style).
	doc
		.lineWidth(0.5)
		.moveTo(x + w * 0.45, cursor)
		.lineTo(x + w - 4, cursor)
		.stroke()
	cursor += 2

	// GROSS PAY row — bold to mark the subtotal.
	labelValue(doc, 'GROSS PAY', d.totals.grossPay, x, cursor + 5, w, { valueBold: true })
	cursor += rowH

	// DEDUCTION row — shown in red parentheses so it reads as "subtract this".
	textAt(doc, '− Deduction', x + 4, cursor + 5, {
		font: FONT_BOLD,
		size: 8,
		width: w * 0.55
	})
	doc.fillColor('#b91c1c') // tailwind red-700
	textAt(doc, `(${d.totals.deduction})`, x + w * 0.55, cursor + 5, {
		font: FONT_BOLD,
		size: 8,
		width: w * 0.45 - 4,
		align: 'right'
	})
	doc.fillColor('black')
	cursor += rowH

	// Full horizontal divider before the emphasized NET PAY row.
	doc.lineWidth(0.75).moveTo(x, cursor).lineTo(x + w, cursor).stroke()

	// NET PAY row — shaded background, larger bold text, sits taller for emphasis.
	const netH = 30
	doc
		.save()
		.rect(x, cursor, w, netH)
		.fillOpacity(0.08)
		.fillColor('#000')
		.fill()
		.restore()
	textAt(doc, 'NET PAY', x + 6, cursor + 9, {
		font: FONT_BOLD,
		size: 12,
		width: w * 0.4
	})
	textAt(doc, d.totals.netPay, x + w * 0.4, cursor + 7, {
		font: FONT_BOLD,
		size: 14,
		width: w * 0.6 - 6,
		align: 'right'
	})
	cursor += netH
	doc.lineWidth(0.75).moveTo(x, cursor).lineTo(x + w, cursor).stroke()

	// Received-by / date footer block. Signature lines are drawn just above the
	// labels so employees sign ON the line, not below the box.
	const footerY = cursor
	const footerH = y + h - footerY
	const midY = footerY + footerH / 2
	const bottomY = footerY + footerH - 14

	// Signature line + "Received By" caption below it.
	doc
		.lineWidth(0.5)
		.moveTo(x + 8, midY)
		.lineTo(x + w - 8, midY)
		.stroke()
	textAt(doc, 'Received By (Signature over Printed Name)', x, midY + 3, {
		size: 7,
		width: w,
		align: 'center'
	})

	// Date line at the bottom, same layout.
	doc
		.lineWidth(0.5)
		.moveTo(x + 8, bottomY)
		.lineTo(x + w - 8, bottomY)
		.stroke()
	textAt(doc, 'Date Received', x, bottomY + 3, { size: 7, width: w, align: 'center' })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function renderPayslipPdf(d: PayslipDocument): Promise<Buffer> {
	// Best-effort logo fetch before we start streaming the PDF, so a slow image
	// server doesn't block or interleave with pdfkit's writes.
	const logo = await fetchImageBuffer(d.company.logoUrl)

	return new Promise((resolve, reject) => {
		try {
			const doc = new PDFDocument({
				size: [PAGE_WIDTH, PAGE_HEIGHT],
				margin: 0
			})
			const chunks: Buffer[] = []
			doc.on('data', (c: Buffer) => chunks.push(c))
			doc.on('end', () => resolve(Buffer.concat(chunks)))
			doc.on('error', reject)

			// Draw the whole document at fixed offsets.
			const x = MARGIN
			let y = MARGIN
			drawHeader(doc, d, x, y, CONTENT_WIDTH, HEADER_H, logo)
			y += HEADER_H
			drawIdentity(doc, d, x, y, CONTENT_WIDTH, IDENTITY_H)
			y += IDENTITY_H
			drawOvertime(doc, d, x, y, COL_OT_W, BODY_H)
			drawAdjustments(doc, d, x + COL_OT_W, y, COL_ADJ_W, BODY_H)
			drawDeductions(doc, d, x + COL_OT_W + COL_ADJ_W, y, COL_DED_W, BODY_H)
			drawTotals(doc, d, x + COL_OT_W + COL_ADJ_W + COL_DED_W, y, COL_TOT_W, BODY_H)

			doc.end()
		} catch (e) {
			reject(e as Error)
		}
	})
}
