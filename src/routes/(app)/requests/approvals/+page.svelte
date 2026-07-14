<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatShortDate } from '$lib/utils/format'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

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
							<span class="truncate font-medium">{typeLabel(req.type)}</span>
							<span class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
								>{currentStageLabel(req)}</span
							>
						</div>
						<p class="text-sm text-muted-foreground">
							{req.employee.lastName}, {req.employee.firstName}
						</p>
						<p class="text-sm">
							{#if req.dateFrom}{formatShortDate(
									req.dateFrom
								)}{#if req.dateTo && req.dateTo !== req.dateFrom}
									– {formatShortDate(req.dateTo)}{/if}{/if}
							{#if req.hours}
								· {req.hours} hrs{/if}
						</p>
						{#if req.reason}
							<p class="line-clamp-3 text-xs text-muted-foreground">{req.reason}</p>
						{/if}
						<a href="/requests/{req.id}" class="mt-auto text-xs text-primary hover:underline"
							>View detail →</a
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
	{/if}
</div>
