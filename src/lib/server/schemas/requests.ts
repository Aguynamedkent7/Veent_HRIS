import { z } from 'zod'

// Per-type request payloads. `type` is the discriminator; type-specific detail is
// validated here and stored in `Request.payload`. `deriveRequestColumns` projects
// the promoted top-level columns (dateFrom/dateTo/hours/reason) from each payload.

const dayHours = z.coerce.number().positive().max(24).multipleOf(0.25)

export const leaveRequestSchema = z.object({
	type: z.literal('LEAVE'),
	leaveTypeId: z.string().min(1),
	startDate: z.coerce.date(),
	endDate: z.coerce.date(),
	reason: z.string().max(500).optional()
})

export const overtimeRequestSchema = z.object({
	type: z.literal('OVERTIME'),
	date: z.coerce.date(),
	hours: dayHours,
	reason: z.string().max(500).optional()
})

export const undertimeRequestSchema = z.object({
	type: z.literal('UNDERTIME'),
	date: z.coerce.date(),
	hours: dayHours,
	reason: z.string().max(500).optional()
})

export const officialBusinessRequestSchema = z.object({
	type: z.literal('OFFICIAL_BUSINESS'),
	startDate: z.coerce.date(),
	endDate: z.coerce.date(),
	location: z.string().min(1).max(200),
	purpose: z.string().min(1).max(500)
})

export const restDayWorkRequestSchema = z.object({
	type: z.literal('REST_DAY_WORK'),
	date: z.coerce.date(),
	hours: dayHours,
	reason: z.string().max(500).optional()
})

export const holidayWorkRequestSchema = z.object({
	type: z.literal('HOLIDAY_WORK'),
	date: z.coerce.date(),
	hours: dayHours,
	reason: z.string().max(500).optional()
})

export const infoUpdateRequestSchema = z.object({
	type: z.literal('INFO_UPDATE'),
	field: z.string().min(1).max(100),
	currentValue: z.string().max(500).optional(),
	requestedValue: z.string().min(1).max(500),
	reason: z.string().max(500).optional()
})

export const requestSchema = z.discriminatedUnion('type', [
	leaveRequestSchema,
	overtimeRequestSchema,
	undertimeRequestSchema,
	officialBusinessRequestSchema,
	restDayWorkRequestSchema,
	holidayWorkRequestSchema,
	infoUpdateRequestSchema
])

export type RequestInput = z.infer<typeof requestSchema>

export interface RequestColumns {
	dateFrom: Date | null
	dateTo: Date | null
	hours: number | null
	reason: string | null
}

// Project the promoted columns from a validated payload so the service and the
// downstream engines (approval inbox, OT lookup) never have to parse JSON.
export function deriveRequestColumns(input: RequestInput): RequestColumns {
	switch (input.type) {
		case 'LEAVE':
			return {
				dateFrom: input.startDate,
				dateTo: input.endDate,
				hours: null,
				reason: input.reason ?? null
			}
		case 'OFFICIAL_BUSINESS':
			return {
				dateFrom: input.startDate,
				dateTo: input.endDate,
				hours: null,
				reason: input.purpose
			}
		case 'OVERTIME':
		case 'UNDERTIME':
		case 'REST_DAY_WORK':
		case 'HOLIDAY_WORK':
			return {
				dateFrom: input.date,
				dateTo: input.date,
				hours: input.hours,
				reason: input.reason ?? null
			}
		case 'INFO_UPDATE':
			return { dateFrom: null, dateTo: null, hours: null, reason: input.reason ?? null }
	}
}
