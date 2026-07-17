<script lang="ts">
	import { enhance } from '$app/forms'
	import type { SubmitFunction } from '@sveltejs/kit'
	import { slide } from 'svelte/transition'
	import { formatShortDate } from '$lib/utils/format'
	import TableSkeleton from '$lib/components/ui/TableSkeleton.svelte'
	import Pagination from '$lib/components/Pagination.svelte'
	import TimesheetModal from '$lib/components/timesheets/TimesheetModal.svelte'
	import NewTimesheetDialog from '$lib/components/timesheets/NewTimesheetDialog.svelte'
	import AggregatePanel from '$lib/components/timesheets/AggregatePanel.svelte'
	import ConfirmButton from '$lib/components/ui/ConfirmButton.svelte'
	import { addToast } from '$lib/stores/toast.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showCreate = $state(false)

	// ─── Review modal ─────────────────────────────────────────────────────────
	// /timesheets is read/modify only — the modal runs in "edit" mode (no approve/reject).
	type Timesheet = Awaited<PageData['myTimesheets']>[number]
	let openTs = $state<Timesheet | null>(null)
	let busy = $state(false)

	// ─── Bulk selection ─────────────────────────────────────────────────────────
	// Managers see two tables (their own timesheets vs. the team's); each keeps its own
	// selection so a bulk action only ever touches the section it was triggered from.
	type Kind = 'mine' | 'team'
	let selectedMine = $state<string[]>([])
	let selectedTeam = $state<string[]>([])
	const selOf = (kind: Kind) => (kind === 'team' ? selectedTeam : selectedMine)
	function setSel(kind: Kind, v: string[]) {
		if (kind === 'team') selectedTeam = v
		else selectedMine = v
	}
	function toggle(kind: Kind, id: string) {
		const cur = selOf(kind)
		setSel(kind, cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
	}
	function toggleAll(kind: Kind, ids: string[], on: boolean) {
		setSel(kind, on ? ids : [])
	}
	// Clear that section's selection after a successful bulk delete/submit.
	const clearOnSuccess =
		(kind: Kind): SubmitFunction =>
		() => {
			busy = true
			return async ({ result, update }) => {
				await update()
				busy = false
				if (result.type === 'success') setSel(kind, [])
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
	const btnPrimary =
		'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
</script>

<svelte:head>
	<title>Timesheets — Veent HRIS</title>
</svelte:head>

{#snippet section(title: string, rows: Timesheet[], kind: Kind, showEmployee: boolean)}
	{@const ids = rows.map((t) => t.id)}
	{@const selectedIds = selOf(kind)}
	{@const allSelected = ids.length > 0 && ids.every((id) => selectedIds.includes(id))}
	{@const cols = showEmployee ? 5 : 4}
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">{title}</h2>

		<!-- Bulk actions for this section; appear when its rows are selected -->
		{#if selectedIds.length}
			<div
				class="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-2"
				transition:slide={{ duration: 120 }}
			>
				<span class="text-sm font-medium">{selectedIds.length} selected</span>
				<div class="flex items-center gap-2">
					<button
						onclick={() => setSel(kind, [])}
						class="mr-1 text-sm text-muted-foreground hover:underline">Clear</button
					>
					{#if kind === 'mine'}
						<form method="POST" action="?/submitMany" use:enhance={clearOnSuccess('mine')}>
							<input type="hidden" name="ids" value={selectedIds.join(',')} />
							<button disabled={busy} class={btnPrimary}>Submit selected</button>
						</form>
						<ConfirmButton
							action="?/deleteMany"
							title="Delete selected timesheets?"
							message="Draft and rejected timesheets you own will be permanently deleted; submitted and approved ones are skipped."
							triggerLabel="Delete selected"
							triggerClass="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
							disabled={busy}
							submit={clearOnSuccess('mine')}
						>
							<input type="hidden" name="ids" value={selectedIds.join(',')} />
						</ConfirmButton>
					{:else}
						<ConfirmButton
							action="?/deleteMany"
							title="Delete selected timesheets?"
							message="{selectedIds.length} timesheet{selectedIds.length === 1
								? ''
								: 's'} will be permanently deleted."
							triggerLabel="Delete selected"
							triggerClass="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
							disabled={busy}
							submit={clearOnSuccess('team')}
						>
							<input type="hidden" name="ids" value={selectedIds.join(',')} />
						</ConfirmButton>
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
								onchange={(e) => toggleAll(kind, ids, e.currentTarget.checked)}
								aria-label="Select all"
								class="align-middle"
							/>
						</th>
						{#if showEmployee}
							<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>
						{/if}
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Period</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Total Hours</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each rows as ts (ts.id)}
						<tr
							onclick={() => openReview(ts)}
							onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && openReview(ts)}
							tabindex="0"
							class={`cursor-pointer hover:bg-muted/30 focus:bg-muted/40 focus:outline-none ${selectedIds.includes(ts.id) ? 'bg-primary/5' : ''}`}
						>
							<td class="px-4 py-3" onclick={(e) => e.stopPropagation()}>
								<input
									type="checkbox"
									checked={selectedIds.includes(ts.id)}
									onchange={() => toggle(kind, ts.id)}
									aria-label="Select timesheet"
									class="align-middle"
								/>
							</td>
							{#if showEmployee}
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
	</section>
{/snippet}

<div class="space-y-8">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Timesheets</h1>
		{#if data.myEmployeeId}
			<button
				onclick={() => (showCreate = true)}
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

	{#if data.isHrAdmin}
		<AggregatePanel employees={data.employees} />
	{/if}

	{#if data.myEmployeeId}
		{#await data.myTimesheets}
			<TableSkeleton rows={5} cols={data.isManager ? 4 : 3} />
		{:then mine}
			{@render section('My Timesheets', mine, 'mine', false)}
			<Pagination meta={data.minePagination} />
		{/await}
	{/if}
	{#if data.isManager}
		{#await data.teamTimesheets}
			<TableSkeleton rows={5} cols={4} />
		{:then team}
			{@render section('Team Timesheets', team, 'team', true)}
			<Pagination meta={data.teamPagination} />
		{/await}
	{/if}
	{#if !data.myEmployeeId && !data.isManager}
		<p class="text-sm text-muted-foreground">No employee profile found.</p>
	{/if}
</div>

<TimesheetModal
	bind:ts={openTs}
	mode="edit"
	isManager={data.isManager}
	isHrAdmin={data.isHrAdmin}
	myEmployeeId={data.myEmployeeId}
	{form}
/>

<NewTimesheetDialog bind:open={showCreate} />
