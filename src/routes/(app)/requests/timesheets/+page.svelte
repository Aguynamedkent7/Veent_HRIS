<script lang="ts">
	import { formatShortDate } from '$lib/utils/format'
	import ApprovalCard from '$lib/components/approvals/ApprovalCard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
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
</div>
