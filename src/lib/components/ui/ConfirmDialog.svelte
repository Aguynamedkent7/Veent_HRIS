<script lang="ts">
	import { fade, scale } from 'svelte/transition'

	interface Props {
		open: boolean
		title?: string
		message?: string
		confirmText?: string
		cancelText?: string
		onconfirm?: () => void
	}

	let {
		open = $bindable(),
		title = 'Are you sure?',
		message = '',
		confirmText = 'Delete',
		cancelText = 'Cancel',
		onconfirm
	}: Props = $props()

	let cardEl = $state<HTMLElement>()

	function cancel() {
		open = false
	}
	function confirm() {
		open = false
		onconfirm?.()
	}

	// Focus the dialog on open so Escape is handled here (and stopped from bubbling to a
	// parent modal's window handler — keeps nested modals from both closing at once).
	$effect(() => {
		if (open) cardEl?.focus()
	})

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation()
			cancel()
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		onclick={cancel}
		role="presentation"
		transition:fade={{ duration: 100 }}
	>
		<div
			bind:this={cardEl}
			class="w-full max-w-sm rounded-xl border bg-card p-6 shadow-2xl focus:outline-none"
			onclick={(e) => e.stopPropagation()}
			onkeydown={onKeydown}
			role="alertdialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
			transition:scale={{ duration: 120, start: 0.96 }}
		>
			<h2 class="text-lg font-semibold">{title}</h2>
			{#if message}
				<p class="mt-2 text-sm text-muted-foreground">{message}</p>
			{/if}
			<div class="mt-6 flex justify-end gap-2">
				<button
					type="button"
					onclick={cancel}
					class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
					>{cancelText}</button
				>
				<button
					type="button"
					onclick={confirm}
					class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
					>{confirmText}</button
				>
			</div>
		</div>
	</div>
{/if}
