<script lang="ts">
	import { enhance } from '$app/forms'
	import type { SubmitFunction } from '@sveltejs/kit'
	import { formatShortDate } from '$lib/utils/format'
	import TableSkeleton from '$lib/components/ui/TableSkeleton.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showCreate = $state(false)

	// ─── Review modal ─────────────────────────────────────────────────────────
	type Timesheet = Awaited<PageData['timesheets']>[number]
	type Row = { date: string; hoursWorked: number; notes: string }
	let openTs = $state<Timesheet | null>(null)
	let entries = $state<Row[]>([])
	let rejecting = $state(false)

	const total = $derived(entries.reduce((s, e) => s + (Number(e.hoursWorked) || 0), 0))
	const canEdit = $derived(data.isManager && openTs && openTs.status !== 'APPROVED')
	const canReview = $derived(data.isManager && openTs && openTs.status === 'SUBMITTED')
	const canSubmit = $derived(
		openTs && openTs.employeeId === data.myEmployeeId && openTs.status === 'DRAFT'
	)

	function toDateKey(d: string | Date) {
		return new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
	}
	function openReview(ts: Timesheet) {
		openTs = ts
		rejecting = false
		entries = ts.entries.map((e) => ({
			date: toDateKey(e.date),
			hoursWorked: Number(e.hoursWorked),
			notes: e.notes ?? ''
		}))
	}
	function close() {
		openTs = null
	}
	function addRow() {
		const last = entries.at(-1)
		entries = [...entries, { date: last?.date ?? toDateKey(new Date()), hoursWorked: 0, notes: '' }]
	}
	function removeRow(i: number) {
		entries = entries.filter((_, idx) => idx !== i)
	}

	// Keep the modal's local entry state on save; close it after a review/submit succeeds.
	const keepOpen: SubmitFunction =
		() =>
		async ({ update }) =>
			update({ reset: false })
	const closeOnSuccess: SubmitFunction =
		() =>
		async ({ result, update }) => {
			await update({ reset: false })
			if (result.type === 'success') close()
		}

	const statusClass: Record<string, string> = {
		APPROVED: 'bg-green-100 text-green-700',
		REJECTED: 'bg-red-100 text-red-700',
		SUBMITTED: 'bg-blue-100 text-blue-700',
		DRAFT: 'bg-gray-100 text-gray-600'
	}
	const inputClass =
		'h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
</script>

<svelte:head>
	<title>Timesheets — Veent HRIS</title>
</svelte:head>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

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
		<TableSkeleton rows={5} cols={data.isManager ? 5 : 4} />
	{:then timesheets}
		<div class="rounded-lg border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						{#if data.isManager}<th class="px-4 py-3 text-left font-medium text-muted-foreground"
								>Employee</th
							>{/if}
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Period</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Total Hours</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
						<th class="w-[1%] px-4 py-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each timesheets as ts (ts.id)}
						<tr class="hover:bg-muted/30">
							{#if data.isManager}
								<td class="px-4 py-3">{ts.employee.lastName}, {ts.employee.firstName}</td>
							{/if}
							<td class="px-4 py-3 whitespace-nowrap"
								>{formatShortDate(ts.periodStart)} – {formatShortDate(ts.periodEnd)}</td
							>
							<td class="px-4 py-3">{Number(ts.totalHours).toFixed(2)} hrs</td>
							<td class="px-4 py-3">
								<span
									class="rounded-full px-2 py-0.5 text-xs font-medium {statusClass[ts.status] ??
										'bg-gray-100 text-gray-600'}"
								>
									{ts.status}
								</span>
							</td>
							<td class="px-4 py-3 text-right">
								<button
									onclick={() => openReview(ts)}
									class="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent"
								>
									{data.isManager && ts.status === 'SUBMITTED' ? 'Review' : 'Open'}
								</button>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="5" class="px-4 py-8 text-center text-muted-foreground"
								>No timesheets found</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/await}
</div>

<!-- ─── Floating review window ──────────────────────────────────────────────── -->
{#if openTs}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={close}
		role="presentation"
	>
		<div
			class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card p-6 shadow-xl"
			onclick={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<div class="mb-4 flex items-start justify-between gap-4">
				<div>
					<h2 class="text-xl font-bold tracking-tight">
						{openTs.employee.lastName}, {openTs.employee.firstName}
					</h2>
					<p class="text-sm text-muted-foreground">
						{formatShortDate(openTs.periodStart)} – {formatShortDate(openTs.periodEnd)}
					</p>
				</div>
				<div class="flex items-center gap-3">
					<span
						class="rounded-full px-3 py-1 text-sm font-medium {statusClass[openTs.status] ??
							'bg-gray-100 text-gray-600'}">{openTs.status}</span
					>
					<button
						onclick={close}
						aria-label="Close"
						class="rounded-md border p-1.5 hover:bg-accent"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="1.75"
							aria-hidden="true"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
			</div>

			{#if form?.error}
				<div
					class="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive"
				>
					{form.error}
				</div>
			{/if}

			{#if openTs.status === 'REJECTED' && openTs.rejectionReason}
				<div class="mb-3 rounded-md border border-red-500/20 bg-red-500/5 px-4 py-2 text-sm">
					<span class="font-medium text-red-600">Rejection reason:</span>
					{openTs.rejectionReason}
				</div>
			{/if}

			<!-- Entries -->
			<div class="mb-2 flex items-center justify-between">
				<h3 class="font-semibold">Entries</h3>
				<p class="text-sm text-muted-foreground">
					Total: <span class="font-mono font-medium">{total.toFixed(2)}</span> hrs
				</p>
			</div>

			<div class="overflow-x-auto rounded-lg border">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/50">
						<tr>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
							<th class="px-3 py-2 text-right font-medium text-muted-foreground">Hours</th>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Notes</th>
							{#if canEdit}<th class="w-[1%] px-3 py-2"></th>{/if}
						</tr>
					</thead>
					<tbody class="divide-y">
						{#if canEdit}
							{#each entries as row, i (i)}
								<tr>
									<td class="px-3 py-1.5"
										><input type="date" bind:value={row.date} class={inputClass} /></td
									>
									<td class="px-3 py-1.5"
										><input
											type="number"
											step="0.25"
											min="0"
											max="24"
											bind:value={row.hoursWorked}
											class="{inputClass} text-right"
										/></td
									>
									<td class="px-3 py-1.5"
										><input
											type="text"
											bind:value={row.notes}
											placeholder="—"
											class={inputClass}
										/></td
									>
									<td class="px-3 py-1.5 text-right">
										<button
											type="button"
											onclick={() => removeRow(i)}
											class="rounded-md border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
											>Remove</button
										>
									</td>
								</tr>
							{:else}
								<tr
									><td colspan="4" class="px-3 py-6 text-center text-muted-foreground"
										>No entries — add a row.</td
									></tr
								>
							{/each}
						{:else}
							{#each openTs.entries as e (e.id)}
								<tr>
									<td class="px-3 py-1.5 whitespace-nowrap">{formatShortDate(e.date)}</td>
									<td class="px-3 py-1.5 text-right font-mono"
										>{Number(e.hoursWorked).toFixed(2)}</td
									>
									<td class="px-3 py-1.5 text-muted-foreground">{e.notes ?? '—'}</td>
								</tr>
							{:else}
								<tr
									><td colspan="3" class="px-3 py-6 text-center text-muted-foreground"
										>No entries recorded.</td
									></tr
								>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>

			{#if canEdit}
				<div class="mt-3 flex items-center gap-2">
					<button
						type="button"
						onclick={addRow}
						class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Add row</button
					>
					<form method="POST" action="?/saveEntries" use:enhance={keepOpen}>
						<input type="hidden" name="id" value={openTs.id} />
						<input type="hidden" name="entries" value={JSON.stringify(entries)} />
						<button
							class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
							>Save entries</button
						>
					</form>
				</div>
			{/if}

			<!-- Actions -->
			{#if canReview}
				<div class="mt-5 border-t pt-4">
					<div class="flex flex-wrap items-start gap-2">
						<form method="POST" action="?/review" use:enhance={closeOnSuccess}>
							<input type="hidden" name="id" value={openTs.id} />
							<input type="hidden" name="approved" value="true" />
							<button
								class="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
								>Approve</button
							>
						</form>
						{#if rejecting}
							<form
								method="POST"
								action="?/review"
								use:enhance={closeOnSuccess}
								class="flex flex-col gap-2"
							>
								<input type="hidden" name="id" value={openTs.id} />
								<input type="hidden" name="approved" value="false" />
								<textarea
									name="rejectionReason"
									required
									rows="2"
									placeholder="Reason for rejection"
									class="w-72 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								></textarea>
								<div class="flex gap-2">
									<button
										class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
										>Confirm reject</button
									>
									<button
										type="button"
										onclick={() => (rejecting = false)}
										class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button
									>
								</div>
							</form>
						{:else}
							<button
								type="button"
								onclick={() => (rejecting = true)}
								class="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
								>Reject</button
							>
						{/if}
					</div>
				</div>
			{/if}

			{#if canSubmit}
				<div class="mt-5 border-t pt-4">
					<form method="POST" action="?/submit" use:enhance={closeOnSuccess}>
						<input type="hidden" name="id" value={openTs.id} />
						<button
							class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
							>Submit for review</button
						>
					</form>
				</div>
			{/if}
		</div>
	</div>
{/if}
