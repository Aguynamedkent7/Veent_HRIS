<script lang="ts">
	import { formatShortDate } from '$lib/utils/format'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	// Leave type name lives in the unified Request payload (leaveTypeId).
	const leaveName = (payload: unknown) => {
		const id = (payload as { leaveTypeId?: string })?.leaveTypeId
		return data.leaveTypes.find((lt) => lt.id === id)?.name ?? '—'
	}

	function statusClass(s: string) {
		if (s === 'APPROVED') return 'bg-green-100 text-green-700'
		if (s === 'REJECTED') return 'bg-red-100 text-red-700'
		if (s === 'RETURNED') return 'bg-orange-100 text-orange-700'
		if (s === 'CANCELLED') return 'bg-gray-100 text-gray-600'
		return 'bg-yellow-100 text-yellow-700'
	}
</script>

<svelte:head>
	<title>Leave — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">Leave</h1>
			<p class="text-sm text-muted-foreground">
				Your leave balances and history. File leave from
				<a href="/requests" class="text-primary hover:underline">Requests/Approvals</a>.
			</p>
		</div>
	</div>

	<!-- Balances -->
	{#if data.balances.length > 0}
		<div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
			{#each data.balances as b (b.id)}
				<div class="rounded-lg border bg-card p-4">
					<p class="text-xs font-medium text-muted-foreground">{b.leaveType.name}</p>
					<p class="mt-1 text-2xl font-bold">{Number(b.remaining).toFixed(1)}</p>
					<p class="text-xs text-muted-foreground">of {Number(b.allocated)} days</p>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Requests table (read-only) -->
	<div class="overflow-x-auto rounded-lg border">
		<table class="w-full text-sm">
			<thead class="border-b bg-muted/50">
				<tr>
					{#if data.isManager}<th class="px-4 py-3 text-left font-medium text-muted-foreground"
							>Employee</th
						>{/if}
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Leave Type</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Dates</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Stage</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">Filed</th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each data.requests as req (req.id)}
					<tr class="hover:bg-muted/30">
						{#if data.isManager}
							<td class="px-4 py-3">{req.employee.lastName}, {req.employee.firstName}</td>
						{/if}
						<td class="px-4 py-3 font-medium">
							<a href="/requests/{req.id}" class="hover:underline">{leaveName(req.payload)}</a>
						</td>
						<td class="px-4 py-3 text-muted-foreground">
							{#if req.dateFrom}
								{formatShortDate(req.dateFrom)}{#if req.dateTo && req.dateTo !== req.dateFrom}
									– {formatShortDate(req.dateTo)}{/if}
							{:else}
								—
							{/if}
						</td>
						<td class="px-4 py-3 text-muted-foreground">
							{req.status === 'PENDING' ? `${req.currentStage + 1} of ${req.steps.length}` : '—'}
						</td>
						<td class="px-4 py-3">
							<span class="rounded-full px-2 py-0.5 text-xs font-medium {statusClass(req.status)}"
								>{req.status}</span
							>
						</td>
						<td class="px-4 py-3 text-right text-muted-foreground"
							>{formatShortDate(req.createdAt)}</td
						>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="px-4 py-8 text-center text-muted-foreground"
							>No leave requests</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
