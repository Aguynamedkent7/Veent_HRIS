<script lang="ts">
	import { enhance } from '$app/forms'
	import { goto } from '$app/navigation'
	import { tick } from 'svelte'
	import { fade, scale } from 'svelte/transition'
	import { advanceTo } from '$lib/actions/dateRange'

	// Shared "New Timesheet" popup opened from both the dashboard quick-action and
	// the /timesheets header. Posts to the /timesheets create action (cross-route
	// from the dashboard), which seeds a DRAFT from the employee's punches and
	// redirects to /timesheets — so both entry points produce the same record.
	let { open = $bindable() }: { open: boolean } = $props()

	let error = $state('')
	let submitting = $state(false)
	let startEl = $state<HTMLInputElement>()

	const inputClass =
		'flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

	function close() {
		open = false
	}
	// Fresh state on open; focus the first field so typing starts immediately and
	// Escape (which bubbles to the dialog's handler) closes it.
	$effect(() => {
		if (open) {
			error = ''
			submitting = false
			tick().then(() => startEl?.focus())
		}
	})
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation()
			close()
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
		onclick={close}
		role="presentation"
		transition:fade={{ duration: 100 }}
	>
		<div
			class="w-full max-w-lg rounded-xl border bg-card p-8 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
			onkeydown={onKeydown}
			role="dialog"
			aria-modal="true"
			aria-label="New timesheet"
			tabindex="-1"
			transition:scale={{ duration: 120, start: 0.96 }}
		>
			<div class="space-y-2 text-center">
				<div
					class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"
				>
					<svg
						class="h-6 w-6"
						fill="none"
						viewBox="0 0 24 24"
						stroke-width="1.8"
						stroke="currentColor"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
						/>
					</svg>
				</div>
				<h2 class="text-xl font-bold tracking-tight">New Timesheet</h2>
				<p class="mx-auto max-w-md text-sm text-muted-foreground">
					Hours are seeded from your recorded attendance punches — adjust them afterward from the
					timesheet's row. The sheet is saved as a draft; submit it for review separately.
				</p>
			</div>

			{#if error}
				<div
					class="mt-4 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
				>
					{error}
				</div>
			{/if}

			<form
				method="POST"
				action="/timesheets?/create"
				use:enhance={() => {
					submitting = true
					error = ''
					return async ({ result }) => {
						submitting = false
						if (result.type === 'redirect') {
							open = false
							await goto(result.location, { invalidateAll: true })
						} else if (result.type === 'failure') {
							error = String(result.data?.error ?? 'Failed to create timesheet.')
						} else if (result.type === 'error') {
							error = 'Something went wrong. Please try again.'
						}
					}
				}}
				class="mt-6 space-y-5"
			>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-1.5">
						<label for="ts-start" class="text-sm font-medium">Period Start</label>
						<input
							bind:this={startEl}
							id="ts-start"
							name="periodStart"
							type="date"
							required
							use:advanceTo={'periodEnd'}
							class={inputClass}
						/>
					</div>
					<div class="space-y-1.5">
						<label for="ts-end" class="text-sm font-medium">Period End</label>
						<input id="ts-end" name="periodEnd" type="date" required class={inputClass} />
					</div>
				</div>
				<div class="flex gap-3">
					<button
						type="button"
						onclick={close}
						class="flex-1 rounded-md border px-4 py-2.5 text-sm font-medium hover:bg-accent"
						>Cancel</button
					>
					<button
						type="submit"
						disabled={submitting}
						class="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						>{submitting ? 'Creating…' : 'Create timesheet'}</button
					>
				</div>
			</form>
		</div>
	</div>
{/if}
