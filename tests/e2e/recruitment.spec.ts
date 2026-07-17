import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { login, USERS } from './helpers'

// #52: moving a Kanban card opens a note dialog; the note lands on the
// applicant's stage-history timeline with actor and date.
test.describe.configure({ mode: 'serial' })

const POSTING_TITLE = 'E2E Stage-Notes Posting'
const APPLICANT_FIRST = 'Notedia'
const APPLICANT_LAST = 'Stagemove'
const NOTE_TEXT = 'E2E note: strong portfolio, fast-tracking to screening'

let postingId: string
let applicantId: string

test.beforeAll(async () => {
	const db = new PrismaClient()
	try {
		const admin = await db.user.findFirstOrThrow({
			where: { email: 'admin@veent.ph' },
			select: { id: true, organizationId: true }
		})
		const department = await db.department.findFirstOrThrow({
			where: { organizationId: admin.organizationId },
			select: { id: true }
		})
		const posting = await db.jobPosting.create({
			data: {
				organizationId: admin.organizationId,
				departmentId: department.id,
				title: POSTING_TITLE,
				description: 'Temporary posting created by the e2e suite.',
				status: 'OPEN',
				postedAt: new Date(),
				createdById: admin.id
			}
		})
		postingId = posting.id
		const applicant = await db.applicant.create({
			data: {
				jobPostingId: posting.id,
				firstName: APPLICANT_FIRST,
				lastName: APPLICANT_LAST,
				email: 'notedia.stagemove@example.test'
			}
		})
		applicantId = applicant.id
	} finally {
		await db.$disconnect()
	}
})

test.afterAll(async () => {
	// Remove the driver-created rows (audit entries are append-only and stay).
	const db = new PrismaClient()
	try {
		await db.applicantStageHistory.deleteMany({ where: { applicantId } })
		await db.applicant.delete({ where: { id: applicantId } })
		await db.jobPosting.delete({ where: { id: postingId } })
	} finally {
		await db.$disconnect()
	}
})

test('stage move with a note shows on the applicant timeline', async ({ page }) => {
	await login(page, USERS.admin)
	await page.goto(`/recruitment/${postingId}`, { waitUntil: 'domcontentloaded' })

	const card = page.locator('div.rounded-md.border-l-4', {
		hasText: `${APPLICANT_FIRST} ${APPLICANT_LAST}`
	})
	await expect(card).toBeVisible()

	// The move button only toggles client state — retry until hydration makes the
	// dialog actually appear (verify-skill hydration gotcha).
	await expect(async () => {
		await card.getByRole('button', { name: 'Move to Screening' }).click()
		await expect(page.getByRole('dialog', { name: 'Confirm stage move' })).toBeVisible({
			timeout: 1000
		})
	}).toPass()

	const dialog = page.getByRole('dialog', { name: 'Confirm stage move' })
	await expect(dialog.getByText('Applied → Screening')).toBeVisible()
	await dialog.getByLabel(/Note/).fill(NOTE_TEXT)
	await dialog.getByRole('button', { name: 'Confirm move' }).click()
	await expect(dialog).not.toBeVisible()

	// The card is now in Screening; open the applicant detail timeline.
	await page.goto(`/recruitment/applicant/${applicantId}`, { waitUntil: 'domcontentloaded' })
	const history = page.locator('section', { hasText: 'Stage History' })
	const entry = history.locator('li', { hasText: 'Screening' })
	await expect(entry).toBeVisible()
	await expect(entry).toContainText(NOTE_TEXT)
	await expect(entry).toContainText(USERS.admin.email)
})
