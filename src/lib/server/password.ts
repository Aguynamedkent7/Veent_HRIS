import { randomInt } from 'node:crypto'

// Unambiguous alphabet (no 0/O/1/I/l) so an emailed temporary password is easy to type.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

/**
 * Cryptographically secure temporary password. Uses crypto `randomInt` (rejection sampling — no
 * modulo bias) over the unambiguous alphabet above. Intended to be emailed and reset on first
 * login, never `Math.random()` (which is predictable and unsafe for secrets).
 */
export function generateTempPassword(length = 14): string {
	let out = ''
	for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)]
	return out
}
