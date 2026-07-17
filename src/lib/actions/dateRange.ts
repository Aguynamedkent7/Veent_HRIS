/**
 * Attach to a start-date `<input type="date">`. When the user picks a date, focus
 * the paired end-date input (found by `name` within the same form) and open its
 * native picker, so a date range can be entered in one uninterrupted flow.
 *
 *   <input type="date" name="periodStart" use:advanceTo={'periodEnd'} />
 *   <input type="date" name="periodEnd" />
 *
 * If the end input is empty or now earlier than the chosen start, it's primed to
 * the start date first. `showPicker()` needs transient user activation — the
 * `change` event provides it, but some browsers still throw, so we fall back to
 * a plain focus.
 */
export function advanceTo(node: HTMLInputElement, targetName: string) {
	function onChange() {
		if (!node.value) return
		const target = node.form?.querySelector<HTMLInputElement>(`input[name="${targetName}"]`)
		if (!target) return

		if (!target.value || target.value < node.value) {
			target.value = node.value
			// Dispatch input so a Svelte `bind:value` on the end input stays in sync.
			target.dispatchEvent(new Event('input', { bubbles: true }))
		}

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
