<script lang="ts">
	import { fade, scale } from 'svelte/transition'

	// Popup for decision notes (reject/return reasons). Replaces the inline
	// textareas on approval cards/bars so the layout stays put — the box here is
	// fixed-size and non-resizable. The reason is required; Confirm stays
	// disabled until something is typed.

	interface Props {
		open: boolean
		title?: string
		message?: string
		placeholder?: string
		confirmText?: string
		cancelText?: string
		/** Confirm button classes — defaults to the destructive red. */
		confirmClass?: string
		onconfirm?: (_reason: string) => void
	}

	let {
		open = $bindable(),
		title = 'Add a reason',
		message = '',
		placeholder = 'Explain the decision…',
		confirmText = 'Confirm',
		cancelText = 'Cancel',
		confirmClass = 'bg-red-600 text-white hover:bg-red-700',
		onconfirm
	}: Props = $props()

	let reason = $state('')
	let boxEl = $state<HTMLTextAreaElement>()

	// Fresh note each time the dialog opens; focus the box so typing can start
	// immediately and Escape is handled here (stopped from bubbling to a parent
	// modal's window handler — keeps nested modals from both closing at once).
	$effect(() => {
		if (open) {
			reason = ''
			boxEl?.focus()
		}
	})

	function cancel() {
		open = false
	}
	function confirm() {
		const r = reason.trim()
		if (!r) return
		open = false
		onconfirm?.(r)
	}
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation()
			cancel()
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		onclick={cancel}
		role="presentation"
		transition:fade={{ duration: 100 }}
	>
		<div
			class="w-full max-w-md rounded-xl border bg-card p-6 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			onkeydown={onKeydown}
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
			transition:scale={{ duration: 120, start: 0.96 }}
		>
			<h2 class="text-lg font-semibold">{title}</h2>
			{#if message}
				<p class="mt-1 text-sm text-muted-foreground">{message}</p>
			{/if}
			<textarea
				bind:this={boxEl}
				bind:value={reason}
				rows="4"
				{placeholder}
				class="mt-4 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			></textarea>
			<div class="mt-4 flex justify-end gap-2">
				<button
					type="button"
					onclick={cancel}
					class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
					>{cancelText}</button
				>
				<button
					type="button"
					onclick={confirm}
					disabled={reason.trim() === ''}
					class="rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 {confirmClass}"
					>{confirmText}</button
				>
			</div>
		</div>
	</div>
{/if}
