<script lang="ts">
	import { enhance } from '$app/forms'
	import type { SubmitFunction } from '@sveltejs/kit'
	import { slide } from 'svelte/transition'
	import { formatShortDate } from '$lib/utils/format'
	import TimesheetModal from '$lib/components/timesheets/TimesheetModal.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	// Read-only review modal (approve/reject only).
	type Timesheet = PageData['pendingTimesheets'][number]
	let openTs = $state<Timesheet | null>(null)

	// ─── Bulk selection ─────────────────────────────────────────────────────────
	let selected = $state<string[]>([])
	let bulkReason = $state('')
	let busy = $state(false)
	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
	}
	function toggleAll(ids: string[], on: boolean) {
		selected = on ? ids : []
	}
	const clearOnSuccess: SubmitFunction = () => {
		busy = true
		return async ({ result, update }) => {
			await update()
			busy = false
			if (result.type === 'success') {
				selected = []
				bulkReason = ''
			}
		}
	}

	const allIds = $derived(data.pendingTimesheets.map((t) => t.id))
	const allSelected = $derived(allIds.length > 0 && allIds.every((id) => selected.includes(id)))
</script>

<svelte:head>
	<title>Timesheet Approvals — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight">Timesheet Approvals</h1>
		<p class="text-sm text-muted-foreground">Review and approve submitted timesheets.</p>
	</div>

	{#if form?.error}
		<div class="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
			{form.error}
		</div>
	{/if}

	{#if form?.saved}
		<div
			class="rounded-md border border-green-500/20 bg-green-500/10 px-4 py-2 text-sm text-green-600"
		>
			{form.saved}
		</div>
	{/if}

	{#if data.pendingTimesheets.length === 0}
		<div class="rounded-md border bg-muted/50 px-6 py-12 text-center text-muted-foreground text-sm">
			No pending timesheets to review.
		</div>
	{:else}
		<!-- Bulk bar: appears when cards are selected -->
		<label class="flex w-fit items-center gap-2 text-sm text-muted-foreground">
			<input
				type="checkbox"
				checked={allSelected}
				onchange={(e) => toggleAll(allIds, e.currentTarget.checked)}
				class="align-middle"
			/>
			Select all
		</label>

		{#if selected.length}
			<div
				class="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3"
				transition:slide={{ duration: 120 }}
			>
				<div class="flex-1 space-y-1">
					<span class="text-sm font-medium">{selected.length} selected</span>
					<textarea
						rows="1"
						placeholder="Rejection reason (required to reject — applied to all selected)"
						class="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
						bind:value={bulkReason}
					></textarea>
				</div>
				<div class="flex items-center gap-2">
					<button
						onclick={() => (selected = [])}
						class="text-sm text-muted-foreground hover:underline">Clear</button
					>
					<form method="POST" action="?/approveMany" use:enhance={clearOnSuccess}>
						<input type="hidden" name="ids" value={selected.join(',')} />
						<button
							disabled={busy}
							class="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
							>Approve selected</button
						>
					</form>
					<form method="POST" action="?/rejectMany" use:enhance={clearOnSuccess}>
						<input type="hidden" name="ids" value={selected.join(',')} />
						<input type="hidden" name="rejectionReason" value={bulkReason} />
						<button
							disabled={busy || bulkReason.trim() === ''}
							class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
							>Reject selected</button
						>
					</form>
				</div>
			</div>
		{/if}

		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.pendingTimesheets as ts (ts.id)}
				<div
					role="button"
					tabindex="0"
					onclick={() => (openTs = ts)}
					onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (openTs = ts)}
					class="cursor-pointer space-y-3 rounded-md border bg-card p-4 hover:border-primary/40 hover:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring {selected.includes(
						ts.id
					)
						? 'border-primary/50 ring-1 ring-primary/40'
						: ''}"
				>
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="truncate text-sm font-semibold">
								{ts.employee.lastName}, {ts.employee.firstName}
							</p>
							<p class="mt-0.5 text-xs text-muted-foreground">
								{formatShortDate(ts.periodStart)} – {formatShortDate(ts.periodEnd)}
							</p>
						</div>
						<input
							type="checkbox"
							checked={selected.includes(ts.id)}
							onchange={() => toggle(ts.id)}
							onclick={(e) => e.stopPropagation()}
							aria-label="Select timesheet"
							class="align-middle"
						/>
					</div>
					<div class="rounded-md bg-muted/50 px-3 py-2 text-sm">
						{Number(ts.totalHours).toFixed(1)} hrs · {ts.entries.length} entries
					</div>
					<p class="text-xs text-primary">Review →</p>
				</div>
			{/each}
		</div>
	{/if}
</div>

<TimesheetModal bind:ts={openTs} mode="review" isManager={true} {form} />
