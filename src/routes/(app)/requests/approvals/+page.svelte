<script lang="ts">
	import { enhance } from '$app/forms'
	import type { SubmitFunction } from '@sveltejs/kit'
	import { tick } from 'svelte'
	import { slide } from 'svelte/transition'
	import { formatDateRange } from '$lib/utils/format'
	import Pagination from '$lib/components/Pagination.svelte'
	import ReasonDialog from '$lib/components/ui/ReasonDialog.svelte'
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

	// Decision notes are collected in a popup (#70 follow-up) instead of inline
	// textareas, so cards keep a fixed, tidy layout. Confirming the popup fills
	// the hidden decide/bulk form and submits it.
	let noteDialogOpen = $state(false)
	let noteTarget = $state<
		{ kind: 'decide'; id: string; decision: 'RETURNED' | 'REJECTED' } | { kind: 'bulk' } | null
	>(null)
	let decideForm = $state<HTMLFormElement>()
	let bulkForm = $state<HTMLFormElement>()
	let decideId = $state('')
	let decideDecision = $state('')
	let decideNote = $state('')

	function askNote(target: NonNullable<typeof noteTarget>) {
		noteTarget = target
		noteDialogOpen = true
	}
	async function submitWithNote(reason: string) {
		if (!noteTarget) return
		if (noteTarget.kind === 'decide') {
			decideId = noteTarget.id
			decideDecision = noteTarget.decision
			decideNote = reason
			await tick()
			decideForm?.requestSubmit()
		} else {
			bulkNote = reason
			await tick()
			bulkForm?.requestSubmit()
		}
	}

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
			<span class="text-sm font-medium">{selected.length} selected</span>
			<div class="flex items-center gap-2">
				<button
					onclick={() => (selected = [])}
					class="text-sm text-muted-foreground hover:underline">Clear</button
				>
				<form
					bind:this={bulkForm}
					method="POST"
					action="?/rejectMany"
					use:enhance={clearOnSuccess}
				>
					<input type="hidden" name="ids" value={selected.join(',')} />
					<input type="hidden" name="note" value={bulkNote} />
					<button
						type="button"
						disabled={busy}
						onclick={() => askNote({ kind: 'bulk' })}
						class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
						>Reject selected…</button
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
		<!-- Uniform fixed-height cards: details clip inside (reason is clamped, full
		     text lives on the detail page) and the decision buttons pin to the bottom.
		     Safe now that notes are collected in a popup instead of an inline textarea. -->
		<div class="flex flex-wrap items-start gap-4">
			{#each data.pendingRequests as req (req.id)}
				<div
					class="flex h-72 w-full min-w-[18rem] flex-col rounded-lg border bg-card p-4 sm:w-[22rem]"
				>
					<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
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
					<!-- Approve posts directly; Return/Reject collect their required note in
					     a popup (ReasonDialog) and submit through the hidden decide form. -->
					<form
						method="POST"
						action="?/decideRequest"
						use:enhance
						class="mt-3 flex shrink-0 gap-2 border-t pt-2"
					>
						<input type="hidden" name="id" value={req.id} />
						<button
							type="submit"
							name="decision"
							value="APPROVED"
							class="flex-1 rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700"
							>Approve</button
						>
						<button
							type="button"
							onclick={() => askNote({ kind: 'decide', id: req.id, decision: 'RETURNED' })}
							class="flex-1 rounded-md bg-orange-500 px-2 py-1 text-xs font-medium text-white hover:bg-orange-600"
							>Return…</button
						>
						<button
							type="button"
							onclick={() => askNote({ kind: 'decide', id: req.id, decision: 'REJECTED' })}
							class="flex-1 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
							>Reject…</button
						>
					</form>
				</div>
			{/each}
		</div>

		<Pagination meta={data.pagination} />
	{/if}
</div>

<!-- Submission target for popup-collected Return/Reject notes. -->
<form bind:this={decideForm} method="POST" action="?/decideRequest" use:enhance class="hidden">
	<input type="hidden" name="id" value={decideId} />
	<input type="hidden" name="decision" value={decideDecision} />
	<input type="hidden" name="note" value={decideNote} />
</form>

<ReasonDialog
	bind:open={noteDialogOpen}
	title={noteTarget?.kind === 'bulk'
		? `Reject ${selected.length} selected request${selected.length === 1 ? '' : 's'}`
		: noteTarget?.decision === 'RETURNED'
			? 'Return request'
			: 'Reject request'}
	message={noteTarget?.kind === 'bulk'
		? 'The note below is applied to every selected request.'
		: noteTarget?.decision === 'RETURNED'
			? 'Tell the employee what to fix before resubmitting.'
			: 'Tell the employee why this request is rejected.'}
	placeholder="Write the note…"
	confirmText={noteTarget?.kind !== 'bulk' && noteTarget?.decision === 'RETURNED'
		? 'Return'
		: 'Reject'}
	confirmClass={noteTarget?.kind !== 'bulk' && noteTarget?.decision === 'RETURNED'
		? 'bg-orange-500 text-white hover:bg-orange-600'
		: 'bg-red-600 text-white hover:bg-red-700'}
	onconfirm={submitWithNote}
/>
