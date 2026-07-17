<script lang="ts">
	import { enhance } from '$app/forms'
	import type { SubmitFunction } from '@sveltejs/kit'
	import { slide } from 'svelte/transition'
	import { formatDateRange } from '$lib/utils/format'
	import Pagination from '$lib/components/Pagination.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	// ─── Bulk selection ───────────────────────────────────────────────────────
	// Reject many pending requests at once with one shared note (reject requires a note).
	let selected = $state<string[]>([])
	let bulkNote = $state('')
	let busy = $state(false)
	const allIds = $derived(data.pendingRequests.map((r) => r.id))
	const allSelected = $derived(allIds.length > 0 && allIds.every((id) => selected.includes(id)))
	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
	}
	function toggleAll(on: boolean) {
		selected = on ? allIds : []
	}
	const clearOnSuccess: SubmitFunction = () => {
		busy = true
		return async ({ result, update }) => {
			await update()
			busy = false
			if (result.type === 'success') {
				selected = []
				bulkNote = ''
			}
		}
	}

	const typeLabels: Record<string, string> = {
		LEAVE: 'Leave',
		OVERTIME: 'Overtime',
		UNDERTIME: 'Undertime',
		OFFICIAL_BUSINESS: 'Official Business',
		REST_DAY_WORK: 'Work on Rest Day',
		HOLIDAY_WORK: 'Holiday Work',
		INFO_UPDATE: 'Info Update'
	}
	const typeLabel = (t: string) => typeLabels[t] ?? t

	function currentStageLabel(r: {
		steps: { stageIndex: number; stageKind: string; role: string | null }[]
		currentStage: number
	}) {
		const step = r.steps.find((s) => s.stageIndex === r.currentStage)
		if (!step) return ''
		return step.stageKind === 'SUPERVISOR' ? 'Supervisor' : (step.role ?? 'Approver')
	}

	// Per-request note (keyed by request id) — each card owns its own note.
	let notes = $state<Record<string, string>>({})
	const noteEmpty = (id: string) => (notes[id] ?? '').trim() === ''

	const unverifiedCount = (docs: { verifiedAt: Date | string | null }[]) =>
		docs.filter((d) => !d.verifiedAt).length
</script>

<svelte:head>
	<title>Request Approvals — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight">Request Approvals</h1>
		<p class="text-sm text-muted-foreground">Review requests awaiting your decision.</p>
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

	{#if data.pendingRequests.length > 0}
		<label class="flex w-fit items-center gap-2 text-sm text-muted-foreground">
			<input
				type="checkbox"
				checked={allSelected}
				onchange={(e) => toggleAll(e.currentTarget.checked)}
				class="align-middle"
			/>
			Select all
		</label>
	{/if}

	{#if selected.length}
		<div
			class="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3"
			transition:slide={{ duration: 120 }}
		>
			<div class="flex-1 space-y-1">
				<span class="text-sm font-medium">{selected.length} selected</span>
				<textarea
					rows="1"
					placeholder="Rejection note (required — applied to all selected)"
					class="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
					bind:value={bulkNote}
				></textarea>
			</div>
			<div class="flex items-center gap-2">
				<button
					onclick={() => (selected = [])}
					class="text-sm text-muted-foreground hover:underline">Clear</button
				>
				<form method="POST" action="?/rejectMany" use:enhance={clearOnSuccess}>
					<input type="hidden" name="ids" value={selected.join(',')} />
					<input type="hidden" name="note" value={bulkNote} />
					<button
						disabled={busy || bulkNote.trim() === ''}
						class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
						>Reject selected</button
					>
				</form>
			</div>
		</div>
	{/if}

	{#if data.pendingRequests.length === 0}
		<div class="rounded-md border bg-muted/50 px-6 py-12 text-center text-muted-foreground text-sm">
			No requests awaiting your decision.
		</div>
	{:else}
		<div class="flex flex-wrap gap-4">
			{#each data.pendingRequests as req (req.id)}
				<div
					class="flex h-[38vh] min-h-[18rem] w-full min-w-[18rem] flex-col rounded-lg border bg-card p-4 sm:w-[22vw]"
				>
					<div class="flex flex-1 flex-col gap-2 overflow-hidden">
						<div class="flex items-center justify-between gap-2">
							<div class="flex min-w-0 items-center gap-2">
								<input
									type="checkbox"
									checked={selected.includes(req.id)}
									onchange={() => toggle(req.id)}
									aria-label="Select request"
									class="align-middle"
								/>
								<span class="truncate font-medium">{typeLabel(req.type)}</span>
							</div>
							<span class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
								>{currentStageLabel(req)}</span
							>
						</div>
						<p class="text-sm text-muted-foreground">
							{req.employee.lastName}, {req.employee.firstName}
						</p>
						<p class="text-sm">
							{#if req.dateFrom}{formatDateRange(req.dateFrom, req.dateTo)}{/if}
							{#if req.hours}
								· {req.hours} hrs{/if}
						</p>
						{#if req.reason}
							<p class="line-clamp-3 text-xs text-muted-foreground">{req.reason}</p>
						{/if}
						{#if req.documents.length}
							{@const unverified = unverifiedCount(req.documents)}
							<p class="text-xs">
								<span class="text-muted-foreground"
									>📎 {req.documents.length} document{req.documents.length === 1 ? '' : 's'}</span
								>
								{#if unverified}
									<span
										class="ml-1 rounded-full bg-yellow-100 px-2 py-0.5 font-medium text-yellow-700"
										>{unverified} unverified</span
									>
								{:else}
									<span
										class="ml-1 rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700"
										>all verified</span
									>
								{/if}
							</p>
						{/if}
						<a
							href="/requests/{req.id}?from=approvals"
							class="mt-auto text-xs text-primary hover:underline">View detail →</a
						>
					</div>
					<form
						method="POST"
						action="?/decideRequest"
						use:enhance
						class="mt-2 shrink-0 space-y-2 border-t pt-2"
					>
						<input type="hidden" name="id" value={req.id} />
						<textarea
							name="note"
							rows="1"
							placeholder="Note (required to reject/return)"
							class="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
							bind:value={notes[req.id]}
						></textarea>
						<div class="flex gap-2">
							<button
								type="submit"
								name="decision"
								value="APPROVED"
								class="flex-1 rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700"
								>Approve</button
							>
							<button
								type="submit"
								name="decision"
								value="RETURNED"
								class="flex-1 rounded-md bg-orange-500 px-2 py-1 text-xs font-medium text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
								disabled={noteEmpty(req.id)}>Return</button
							>
							<button
								type="submit"
								name="decision"
								value="REJECTED"
								class="flex-1 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
								disabled={noteEmpty(req.id)}>Reject</button
							>
						</div>
					</form>
				</div>
			{/each}
		</div>

		<Pagination meta={data.pagination} />
	{/if}
</div>
