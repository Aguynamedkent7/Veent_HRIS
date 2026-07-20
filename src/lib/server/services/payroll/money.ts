/**
 * Exact decimal money primitives for the payroll engine (#119).
 *
 * Payroll arithmetic must not go through IEEE-754 doubles: `0.1 + 0.2 !== 0.3` applies to every
 * peso figure the system produces, and the client's requirement is that intermediate steps carry
 * full precision so Finance/BIR never see an unexplainable centavo.
 *
 * The rules this module exists to enforce:
 *
 *  1. **Exact arithmetic.** Values are `Prisma.Decimal` (decimal.js, already a transitive dep of
 *     `@prisma/client` — no new package). No binary-float representation error anywhere.
 *  2. **No intermediate rounding.** Carry `Decimal` end to end; call `q2` exactly once per value,
 *     at the last step that produces a real payable amount.
 *  3. **Rounding mode is named, not inherited.** `ROUND_HALF_UP`, applied uniformly. `Math.round`
 *     is half-up for positives but half-*toward-zero* for negatives, which would treat a negative
 *     net pay (#103) inconsistently with a positive one.
 *
 * Reconciliation is **lines-authoritative** (#119 §4, client-confirmed): each payslip line is
 * computed exactly and quantized once at its own last step, and totals are defined as the sum of
 * the already-quantized lines. That guarantees a payslip always adds up. The per-line amounts are
 * the figures with external obligations attached — SSS/PhilHealth/Pag-IBIG remittances and BIR
 * 2316 withholding are filed per line, so the amount remitted must equal the amount deducted.
 * Use `sumQ` for any total whose parts are already quantized.
 */

import { Prisma } from '@prisma/client'

export type Money = Prisma.Decimal

/** Numeric input accepted at the engine's edges — DB `Decimal`, plain number, or string. */
export type MoneyLike = Prisma.Decimal | number | string

export const ZERO: Money = new Prisma.Decimal(0)

/** Lift any money-ish value into exact decimal. Non-finite input degrades to 0, never NaN. */
export function D(v: MoneyLike | null | undefined): Money {
	if (v === null || v === undefined) return ZERO
	if (typeof v === 'number' && !Number.isFinite(v)) return ZERO
	return new Prisma.Decimal(v)
}

/**
 * Quantize to centavos — the ONLY place scale-2 rounding happens. Call once, at the last step
 * that produces a payable amount (a payslip line, or a value about to be persisted/displayed).
 */
export function q2(v: MoneyLike): Money {
	return D(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

/** Exact sum. Use for chains of unquantized values. */
export function sum(values: MoneyLike[]): Money {
	return values.reduce<Money>((acc, v) => acc.plus(D(v)), ZERO)
}

/**
 * Sum of ALREADY-quantized parts — the lines-authoritative total. The result is exact at scale 2
 * by construction, so it needs no further rounding and always reconciles against its lines.
 */
export function sumQ(values: MoneyLike[]): Money {
	return sum(values)
}

/**
 * Convert to `number` at the very edge of the system (persistence, JSON transport, display).
 * Everything upstream of this call must stay `Decimal`.
 */
export function toNumber(v: MoneyLike): number {
	return D(v).toNumber()
}

/** Quantize and hand back a plain number — the standard engine→boundary exit. */
export function q2n(v: MoneyLike): number {
	return q2(v).toNumber()
}
