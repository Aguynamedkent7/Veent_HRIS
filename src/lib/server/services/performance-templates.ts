import { error } from '@sveltejs/kit'
import { Prisma } from '@prisma/client'
import { db } from '$lib/server/db'
import { writeAuditLog } from '$lib/server/audit'
import type { TemplateStructure } from '$lib/server/performance/types'
import type { AuditContext } from './types'

/**
 * Evaluation-template CRUD (#178).
 *
 * A NEW service file rather than an addition to `performance.ts`: that module's export list is
 * mocked VERBATIM by `tests/unit/review-privacy.test.ts`, so every export added to it breaks an
 * unrelated test. Keeping templates here also keeps the review lifecycle and the form definition
 * apart, which is the whole point of the JSON template design.
 *
 * Two repo-wide defect classes this file deliberately avoids adding an instance of:
 *   • #323 — every query org-scopes on the model's OWN `organizationId` column, never through a
 *     `where: { organization: { … } }` join.
 *   • #324 — every audit write happens INSIDE the `$transaction` that carries the mutation and is
 *     passed the `tx` client, so the audit row commits or rolls back with the write it records.
 *
 * NO ARITHMETIC ON SCORES lives here or anywhere in this feature. `sectionCount` below counts
 * array entries; it is not a score and nothing derived from a template's weights, maxima or bands
 * is ever computed.
 */

const ENTITY = 'PerformanceTemplate'

/** Array length only — never a sum. Malformed JSON reports 0 rather than throwing on a list page. */
function sectionCountOf(structure: Prisma.JsonValue): number {
	const sections = (structure as { sections?: unknown } | null)?.sections
	return Array.isArray(sections) ? sections.length : 0
}

/**
 * Prisma types a Json column's input as an index-signature object, which a named interface never
 * satisfies. The value has already been through `templateStructureSchema` by the time it reaches
 * here, so this widens a proven-valid structure rather than hiding an unchecked one.
 */
function asJson(structure: TemplateStructure): Prisma.InputJsonValue {
	return structure as unknown as Prisma.InputJsonValue
}

export async function listTemplates(organizationId: string) {
	const rows = await db.performanceTemplate.findMany({
		where: { organizationId },
		orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
		select: { id: true, name: true, isActive: true, structure: true }
	})
	return rows.map(({ structure, ...t }) => ({ ...t, sectionCount: sectionCountOf(structure) }))
}

export async function getTemplate(id: string, organizationId: string) {
	const template = await db.performanceTemplate.findFirst({ where: { id, organizationId } })
	if (!template) error(404, 'Template not found')
	return template
}

export async function createTemplate(
	organizationId: string,
	data: { name: string; structure: TemplateStructure },
	ctx: AuditContext
) {
	try {
		return await db.$transaction(async (tx) => {
			const template = await tx.performanceTemplate.create({
				data: { organizationId, name: data.name, structure: asJson(data.structure) }
			})
			await writeAuditLog(
				ctx,
				{
					action: 'CREATE',
					entityType: ENTITY,
					entityId: template.id,
					// The structure itself is deliberately not copied into the audit row: it is a
					// multi-kilobyte document, and the template row is the record of it.
					newValue: {
						name: template.name,
						isActive: template.isActive,
						sectionCount: sectionCountOf(template.structure)
					}
				},
				tx
			)
			return template
		})
	} catch (e) {
		if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
			error(409, 'A template with that name already exists')
		throw e
	}
}

export async function updateTemplate(
	id: string,
	organizationId: string,
	data: { name: string; isActive: boolean; structure: TemplateStructure },
	ctx: AuditContext
) {
	const before = await getTemplate(id, organizationId)
	try {
		return await db.$transaction(async (tx) => {
			const template = await tx.performanceTemplate.update({
				where: { id: before.id },
				data: { name: data.name, isActive: data.isActive, structure: asJson(data.structure) }
			})
			await writeAuditLog(
				ctx,
				{
					action: 'UPDATE',
					entityType: ENTITY,
					entityId: template.id,
					oldValue: {
						name: before.name,
						isActive: before.isActive,
						sectionCount: sectionCountOf(before.structure)
					},
					newValue: {
						name: template.name,
						isActive: template.isActive,
						sectionCount: sectionCountOf(template.structure)
					}
				},
				tx
			)
			return template
		})
	} catch (e) {
		if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
			error(409, 'A template with that name already exists')
		throw e
	}
}

export async function setTemplateActive(
	id: string,
	organizationId: string,
	isActive: boolean,
	ctx: AuditContext
) {
	const before = await getTemplate(id, organizationId)
	return db.$transaction(async (tx) => {
		const template = await tx.performanceTemplate.update({
			where: { id: before.id },
			data: { isActive }
		})
		await writeAuditLog(
			ctx,
			{
				action: 'UPDATE',
				entityType: ENTITY,
				entityId: template.id,
				oldValue: { isActive: before.isActive },
				newValue: { isActive: template.isActive }
			},
			tx
		)
		return template
	})
}

/**
 * SPEC AC3 readiness count: how many ACTIVE employees still have no template assigned. Purely
 * informational — nothing gates on it.
 */
export async function countEmployeesWithoutTemplate(organizationId: string) {
	return db.employee.count({
		where: { organizationId, employmentStatus: 'ACTIVE', assignedTemplateId: null }
	})
}

/**
 * How many reviews already snapshotted this template. The builder uses it to warn that opened
 * reviews are unaffected by an edit. Scoped by `templateId` alone on purpose — the caller has
 * already proven the template belongs to the org, and `PerformanceReview` has no direct
 * `organizationId` column to scope on without a join (#323).
 */
export async function countReviewsUsingTemplate(templateId: string) {
	return db.performanceReview.count({ where: { templateId } })
}
