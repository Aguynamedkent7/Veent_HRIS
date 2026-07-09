import type { Transport } from '@sveltejs/kit'

function isDecimal(value: unknown): boolean {
	return (
		value !== null &&
		typeof value === 'object' &&
		'd' in (value as object) &&
		'e' in (value as object) &&
		's' in (value as object) &&
		typeof (value as { toNumber?: unknown }).toNumber === 'function'
	)
}

// Serialize Prisma Decimal objects (decimal.js) as plain numbers across the
// server→client boundary. Wrapping in an array avoids the 0-is-falsy edge case.
export const transport: Transport = {
	Decimal: {
		encode: (value) => isDecimal(value) && [(value as { toNumber: () => number }).toNumber()],
		decode: (value) => (value as [number])[0]
	}
}
