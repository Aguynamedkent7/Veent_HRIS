<script lang="ts">
	import { enhance } from '$app/forms'
	import type { SubmitFunction } from '@sveltejs/kit'
	import { slide } from 'svelte/transition'
	import { formatShortDate } from '$lib/utils/format'
	import TableSkeleton from '$lib/components/ui/TableSkeleton.svelte'
	import TimesheetModal from '$lib/components/timesheets/TimesheetModal.svelte'
	import ConfirmButton from '$lib/components/ui/ConfirmButton.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showCreate = $state(false)

	// ─── Review modal ─────────────────────────────────────────────────────────
	// /timesheets is read/modify only — the modal runs in "edit" mode (no approve/reject).
	type Timesheet = Awaited<PageData['timesheets']>[number]
	let openTs = $state<Timesheet | null>(null)
	let busy = $state(false)

	// ─── Bulk selection ─────────────────────────────────────────────────────────
	let selected = $state<string[]>([])
	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
	}
	function toggleAll(ids: string[], on: boolean) {
		selected = on ? ids : []
	}
	// Clear the selection after a successful bulk delete/submit.
	const clearOnSuccess: SubmitFunction = () => {
		busy = true
		return async ({ result, update }) => {
			await update()
			busy = false
			if (result.type === 'success') selected = []
		}
	}

	function openReview(ts: Timesheet) {
		openTs = ts
	}

	const statusClass: Record<string, string> = {
		APPROVED: 'bg-green-100 text-green-700',
		REJECTED: 'bg-red-100 text-red-700',
		SUBMITTED: 'bg-blue-100 text-blue-700',
		DRAFT: 'bg-gray-100 text-gray-600'
	}
	const inputClass =
		'h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
	const btnPrimary =
		'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
</script>

<svelte:head>
	<title>Timesheets — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Timesheets</h1>
		{#if data.myEmployeeId}
			<button
				onclick={() => (showCreate = !showCreate)}
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				New Timesheet
			</button>
		{/if}
	</div>

	{#if form?.saved}
		<div
			class="rounded-md border border-green-500/20 bg-green-500/10 px-4 py-2 text-sm text-green-600"
		>
			{form.saved}
		</div>
	{/if}

	{#if showCreate}
		<form method="POST" action="?/create" use:enhance class="rounded-lg border p-4 space-y-3">
			<h2 class="font-semibold">Create Timesheet</h2>
			<div class="flex items-end gap-4">
				<div>
					<label class="text-sm font-medium">Period Start</label>
					<input name="periodStart" type="date" required class="mt-1 {inputClass} h-9" />
				</div>
				<div>
					<label class="text-sm font-medium">Period End</label>
					<input name="periodEnd" type="date" required class="mt-1 {inputClass} h-9" />
				</div>
				<button
					type="submit"
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>Create</button
				>
				<button
					type="button"
					onclick={() => (showCreate = false)}
					class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button
				>
			</div>
		</form>
	{/if}

	{#await data.timesheets}
		<TableSkeleton rows={5} cols={data.isManager ? 4 : 3} />
	{:then timesheets}
		{@const allIds = timesheets.map((t) => t.id)}
		{@const allSelected = allIds.length > 0 && allIds.every((id) => selected.includes(id))}
		{@const cols = data.isManager ? 5 : 4}

		<!-- Bulk actions (top-right of the table); appear when rows are selected -->
		{#if selected.length}
			<div
				class="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-2"
				transition:slide={{ duration: 120 }}
			>
				<span class="text-sm font-medium">{selected.length} selected</span>
				<div class="flex items-center gap-2">
					<button
						onclick={() => (selected = [])}
						class="mr-1 text-sm text-muted-foreground hover:underline">Clear</button
					>
					{#if data.isManager}
						<ConfirmButton
							action="?/deleteMany"
							title="Delete selected timesheets?"
							message="{selected.length} timesheet{selected.length === 1
								? ''
								: 's'} will be permanently deleted."
							triggerLabel="Delete selected"
							triggerClass="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
							disabled={busy}
							submit={clearOnSuccess}
						>
							<input type="hidden" name="ids" value={selected.join(',')} />
						</ConfirmButton>
					{:else}
						<form method="POST" action="?/submitMany" use:enhance={clearOnSuccess}>
							<input type="hidden" name="ids" value={selected.join(',')} />
							<button disabled={busy} class={btnPrimary}>Submit selected</button>
						</form>
					{/if}
				</div>
			</div>
		{/if}

		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="w-[1%] px-4 py-3">
							<input
								type="checkbox"
								checked={allSelected}
								onchange={(e) => toggleAll(allIds, e.currentTarget.checked)}
								aria-label="Select all"
								class="align-middle"
							/>
						</th>
						{#if data.isManager}
							<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>
						{/if}
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Period</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Total Hours</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each timesheets as ts (ts.id)}
						<tr
							onclick={() => openReview(ts)}
							onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && openReview(ts)}
							tabindex="0"
							class={`cursor-pointer hover:bg-muted/30 focus:bg-muted/40 focus:outline-none ${selected.includes(ts.id) ? 'bg-primary/5' : ''}`}
						>
							<td class="px-4 py-3" onclick={(e) => e.stopPropagation()}>
								<input
									type="checkbox"
									checked={selected.includes(ts.id)}
									onchange={() => toggle(ts.id)}
									aria-label="Select timesheet"
									class="align-middle"
								/>
							</td>
							{#if data.isManager}
								<td class="px-4 py-3">{ts.employee.lastName}, {ts.employee.firstName}</td>
							{/if}
							<td class="px-4 py-3 whitespace-nowrap"
								>{formatShortDate(ts.periodStart)} – {formatShortDate(ts.periodEnd)}</td
							>
							<td class="px-4 py-3">{Number(ts.totalHours).toFixed(2)} hrs</td>
							<td class="px-4 py-3"
								><span
									class={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass[ts.status] ?? 'bg-gray-100 text-gray-600'}`}
									>{ts.status}</span
								></td
							>
						</tr>
					{:else}
						<tr>
							<td colspan={cols} class="px-4 py-8 text-center text-muted-foreground"
								>No timesheets found</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/await}
</div>

<TimesheetModal
	bind:ts={openTs}
	mode="edit"
	isManager={data.isManager}
	myEmployeeId={data.myEmployeeId}
	{form}
/>
