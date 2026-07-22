import { fail, isHttpError, type ActionFailure } from '@sveltejs/kit'

/**
 * Convert a thrown service error into a form `fail()` so a form action returns a
 * user-facing message instead of a raw 500 error page.
 *
 * Service functions signal user-facing problems by throwing SvelteKit's
 * `error(status, 'message')`. Those become `fail(status, { error: message })`;
 * anything else (unexpected bugs) is rethrown so SvelteKit still surfaces it as
 * a 500 and real failures stand out.
 */
export function failFromError(e: unknown): ActionFailure<{ error: string }> {
	if (isHttpError(e)) return fail(e.status, { error: String(e.body.message) })
	throw e
}
