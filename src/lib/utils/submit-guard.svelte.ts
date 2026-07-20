import type { SubmitFunction } from '@sveltejs/kit'

/**
 * Double-submit guard for `use:enhance` forms (#108).
 *
 * A fast double-click on a state-mutating form submits it twice and creates duplicate rows —
 * duplicate employees, requests, approvals, loans, cash advances, enrollments. Disabling the
 * button on the second click is not sufficient on its own: Enter-key submits and
 * `form.requestSubmit()` (used by `ConfirmButton`) bypass the button entirely. So this guard does
 * both — it `cancel()`s any submit that arrives while one is already in flight, and exposes
 * `busy` for the button's `disabled` state and spinner.
 *
 * Usage:
 * ```svelte
 * const save = createSubmitGuard()
 * <form method="POST" action="?/create" use:enhance={save.enhance}>
 *   <button disabled={save.busy}>{save.busy ? 'Saving…' : 'Save'}</button>
 * </form>
 * ```
 *
 * Composes with an existing handler — pass it in and it still runs, wrapped:
 * ```svelte
 * const save = createSubmitGuard(() => async ({ update }) => { await update(); open = false })
 * ```
 */
export function createSubmitGuard(inner?: SubmitFunction) {
	let busy = $state(false)

	const enhance: SubmitFunction = async (input) => {
		// A submit is already in flight — drop this one rather than racing it.
		if (busy) return input.cancel()
		busy = true

		// A wrapped handler is allowed to abort the submit (a `confirm()` the user declines, a
		// validation bail). When it does, no request goes out and our response callback never
		// runs — so the lock must be released here or the form stays wedged for the life of the
		// page. Intercept `cancel` to notice.
		let cancelled = false
		const cancel = input.cancel
		input.cancel = () => {
			cancelled = true
			cancel()
		}

		let after: Awaited<ReturnType<SubmitFunction>>
		try {
			after = await inner?.(input)
		} catch (e) {
			// The wrapped handler threw before the request went out — same reasoning as above.
			busy = false
			throw e
		}

		if (cancelled) {
			busy = false
			return
		}

		return async (opts) => {
			try {
				// When the wrapped handler returns its own callback it owns the response — including
				// whether to call `update()`. Only apply the default when it doesn't.
				if (after) await after(opts)
				else await opts.update()
			} finally {
				busy = false
			}
		}
	}

	return {
		get busy() {
			return busy
		},
		enhance
	}
}
