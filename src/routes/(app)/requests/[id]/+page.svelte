<script lang="ts">
	import { formatShortDate, formatDate } from '$lib/utils/format'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const req = $derived(data.request)

	const typeLabels: Record<string, string> = {
		LEAVE: 'Leave',
		OVERTIME: 'Overtime',
		UNDERTIME: 'Undertime',
		OFFICIAL_BUSINESS: 'Official Business',
		REST_DAY_WORK: 'Work on Rest Day',
		HOLIDAY_WORK: 'Holiday Work',
		INFO_UPDATE: 'Info Update'
	}

	function statusClass(s: string) {
		if (s === 'APPROVED') return 'bg-green-100 text-green-700'
		if (s === 'REJECTED') return 'bg-red-100 text-red-700'
		if (s === 'RETURNED') return 'bg-orange-100 text-orange-700'
		if (s === 'CANCELLED') return 'bg-gray-100 text-gray-600'
		return 'bg-yellow-100 text-yellow-700'
	}

	// payload is Json; render its key/values (dropping the redundant `type`).
	const payloadEntries = $derived(
		Object.entries((req.payload ?? {}) as Record<string, unknown>).filter(([k]) => k !== 'type')
	)
	function stageLabel(step: { stageKind: string; role: string | null }) {
		return step.stageKind === 'SUPERVISOR' ? 'Supervisor' : (step.role ?? 'Approver')
	}
</script>

<svelte:head>
	<title>Request — Veent HRIS</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<a href="/requests/approvals" class="text-sm text-muted-foreground hover:underline"
		>← Back to requests</a
	>

	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">{typeLabels[req.type] ?? req.type}</h1>
		<span class="rounded-full px-2.5 py-1 text-xs font-medium {statusClass(req.status)}"
			>{req.status}</span
		>
	</div>

	<div class="rounded-lg border bg-card p-4">
		<dl class="grid grid-cols-3 gap-y-2 text-sm">
			<dt class="text-muted-foreground">Employee</dt>
			<dd class="col-span-2">{req.employee.firstName} {req.employee.lastName}</dd>
			{#if req.dateFrom}
				<dt class="text-muted-foreground">Dates</dt>
				<dd class="col-span-2">
					{formatShortDate(req.dateFrom)}{#if req.dateTo && req.dateTo !== req.dateFrom}
						– {formatShortDate(req.dateTo)}{/if}
				</dd>
			{/if}
			{#if req.hours}
				<dt class="text-muted-foreground">Hours</dt>
				<dd class="col-span-2">{req.hours}</dd>
			{/if}
			{#each payloadEntries as [k, v] (k)}
				<dt class="text-muted-foreground">{k}</dt>
				<dd class="col-span-2 break-words">{String(v)}</dd>
			{/each}
			{#if req.reason}
				<dt class="text-muted-foreground">Reason</dt>
				<dd class="col-span-2">{req.reason}</dd>
			{/if}
			<dt class="text-muted-foreground">Filed</dt>
			<dd class="col-span-2">{formatDate(req.createdAt)}</dd>
		</dl>
	</div>

	<div class="space-y-3">
		<h2 class="text-lg font-semibold">Approval chain</h2>
		<ol class="space-y-2">
			{#each req.steps as step, i (step.id)}
				{@const active = req.status === 'PENDING' && i === req.currentStage}
				<li
					class="flex items-start gap-3 rounded-lg border p-3 {active
						? 'border-primary/50 bg-primary/5'
						: ''}"
				>
					<div
						class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium
						{step.decision === 'APPROVED'
							? 'bg-green-100 text-green-700'
							: step.decision === 'REJECTED'
								? 'bg-red-100 text-red-700'
								: step.decision === 'RETURNED'
									? 'bg-orange-100 text-orange-700'
									: 'bg-muted text-muted-foreground'}"
					>
						{i + 1}
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-sm font-medium">{stageLabel(step)}</p>
						<p class="text-xs text-muted-foreground">
							{#if step.decision}
								{step.decision}{#if step.actor}
									by {step.actor.email}{/if}{#if step.decidedAt}
									· {formatShortDate(step.decidedAt)}{/if}
							{:else if active}
								Pending — awaiting decision
							{:else}
								Not yet reached
							{/if}
						</p>
						{#if step.note}<p class="mt-1 text-xs text-muted-foreground">“{step.note}”</p>{/if}
					</div>
				</li>
			{/each}
		</ol>
	</div>
</div>
