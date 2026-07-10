import { json } from '@sveltejs/kit'
import { z } from 'zod'
import { verifyHmac } from '$lib/server/hmac'
import { recordPunch } from '$lib/server/services/timelog'
import { apiError, badRequest } from '$lib/server/api-error'
import type { RequestHandler } from './$types'

/**
 * POST /api/v1/timesheets/log
 *
 * Server-to-server punch ingestion for the Discord bot. NOT session-authenticated —
 * the request is verified with an HMAC signature over `${timestamp}.${rawBody}`
 * (headers `x-hris-signature`, `x-hris-timestamp`) using TIMELOG_API_SECRET, with a
 * ±5-minute replay window. The employee is resolved by `discordId`.
 */

const punchSchema = z.object({
	discordId: z.string().min(1),
	punchType: z.enum(['IN', 'OUT']),
	timestamp: z.string().datetime().optional(),
	messageId: z.string().optional()
})

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const rawBody = await request.text()

	const verification = verifyHmac({
		rawBody,
		signature: request.headers.get('x-hris-signature'),
		timestamp: request.headers.get('x-hris-timestamp'),
		secret: process.env.TIMELOG_API_SECRET
	})
	if (!verification.valid) return apiError(401, 'Invalid or missing signature', verification.reason)

	let body: unknown
	try {
		body = JSON.parse(rawBody)
	} catch {
		return badRequest('Invalid JSON body')
	}

	const parsed = punchSchema.safeParse(body)
	if (!parsed.success) return badRequest('Invalid input', parsed.error.flatten())

	try {
		const result = await recordPunch(
			{
				discordId: parsed.data.discordId,
				punchType: parsed.data.punchType,
				timestamp: parsed.data.timestamp ? new Date(parsed.data.timestamp) : new Date(),
				discordMessageId: parsed.data.messageId,
				source: 'DISCORD'
			},
			{ ipAddress: getClientAddress() }
		)

		return json(
			{
				data: {
					id: result.timeLog.id,
					punchType: result.timeLog.punchType,
					timestamp: result.timeLog.timestamp,
					employee: result.employee,
					previousType: result.previousType
				}
			},
			{ status: 201 }
		)
	} catch (e: unknown) {
		const err = e as { status?: number; body?: { message?: string } }
		if (err?.status === 404) return apiError(404, err.body?.message ?? 'Employee not found')
		if (err?.status === 409) return apiError(409, err.body?.message ?? 'Conflict')
		throw e
	}
}
