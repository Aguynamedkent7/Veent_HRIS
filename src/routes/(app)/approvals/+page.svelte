<script lang="ts">
	import { formatShortDate } from '$lib/utils/format'
	import ApprovalCard from '$lib/components/approvals/ApprovalCard.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	let activeTab = $state<'timesheets' | 'leave'>('timesheets')
</script>

<svelte:head>
	<title>Approvals — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Approvals</h1>
	</div>

	<!-- Tab navigation -->
	<div class="flex gap-1 border-b">
		<button
			type="button"
			onclick={() => (activeTab = 'timesheets')}
			class="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors {activeTab === 'timesheets' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
		>
			Timesheets
			{#if data.pendingTimesheets.length > 0}
				<span class="rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
					{data.pendingTimesheets.length}
				</span>
			{/if}
		</button>
		<button
			type="button"
			onclick={() => (activeTab = 'leave')}
			class="flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors {activeTab === 'leave' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
		>
			Leave
			{#if data.pendingLeave.length > 0}
				<span class="rounded-full bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
					{data.pendingLeave.length}
				</span>
			{/if}
		</button>
	</div>

	<!-- Timesheets tab -->
	{#if activeTab === 'timesheets'}
		{#if data.pendingTimesheets.length === 0}
			<div class="rounded-md border bg-muted/50 px-6 py-12 text-center text-muted-foreground text-sm">
				No pending timesheets to review.
			</div>
		{:else}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.pendingTimesheets as ts (ts.id)}
					<ApprovalCard
						type="timesheet"
						id={ts.id}
						submitterName="{ts.employee.lastName}, {ts.employee.firstName}"
						period="{formatShortDate(ts.periodStart)} – {formatShortDate(ts.periodEnd)}"
						details="{Number(ts.totalHours).toFixed(1)} hrs"
						actionApprove="approveTimesheet"
						actionReject="rejectTimesheet"
					/>
				{/each}
			</div>
		{/if}
	{/if}

	<!-- Leave tab -->
	{#if activeTab === 'leave'}
		{#if data.pendingLeave.length === 0}
			<div class="rounded-md border bg-muted/50 px-6 py-12 text-center text-muted-foreground text-sm">
				No pending leave requests to review.
			</div>
		{:else}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.pendingLeave as req (req.id)}
					<ApprovalCard
						type="leave"
						id={req.id}
						submitterName="{req.employee.lastName}, {req.employee.firstName}"
						period="{formatShortDate(req.startDate)} – {formatShortDate(req.endDate)}"
						details="{Number(req.totalDays)} days – {req.leaveType.name}"
						actionApprove="approveLeave"
						actionReject="rejectLeave"
					/>
				{/each}
			</div>
		{/if}
	{/if}
</div>
