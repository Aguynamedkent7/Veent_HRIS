/**
 * Attach to a start-date `<input type="date">`. When the user picks a date, focus
 * the paired end-date input (found by `name` within the same form) and open its
 * native picker, so a date range can be entered in one uninterrupted flow.
 *
 *   <input type="date" name="periodStart" use:advanceTo={'periodEnd'} />
 *   <input type="date" name="periodEnd" min={periodStart} />
 *
 * The end input is NOT pre-filled with the start value (#115): the paired input
 * already enforces `min={start}`, and copying the start into the end just looked
 * like the start value had been typed into the wrong field while the picker stayed
 * closed. `showPicker()` needs transient user activation — the `change` event
 * provides it, but some browsers still throw, so we fall back to a plain focus.
 */
export function advanceTo(node: HTMLInputElement, targetName: string) {
	function onChange() {
		if (!node.value) return
		const target = node.form?.querySelector<HTMLInputElement>(`input[name="${targetName}"]`)
		if (!target) return

		// Hand the user straight to the end-date picker; they choose the end themselves.
		target.focus()
		try {
			target.showPicker?.()
		} catch {
			// showPicker can throw without user activation — focus alone is enough.
		}
	}

	node.addEventListener('change', onChange)
	return {
		update(newName: string) {
			targetName = newName
		},
		destroy() {
			node.removeEventListener('change', onChange)
		}
	}
}
