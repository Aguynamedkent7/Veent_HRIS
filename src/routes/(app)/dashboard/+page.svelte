<script lang="ts">
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const { metrics } = data
</script>

<svelte:head>
	<title>Dashboard — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold tracking-tight">Dashboard</h1>

	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<div class="rounded-lg border bg-card p-6 shadow-sm">
			<p class="text-sm font-medium text-muted-foreground">Active Employees</p>
			<p class="mt-2 text-3xl font-bold">{metrics.headcount}</p>
		</div>
		<div class="rounded-lg border bg-card p-6 shadow-sm">
			<p class="text-sm font-medium text-muted-foreground">Pending Leave Requests</p>
			<p class="mt-2 text-3xl font-bold">{metrics.pendingLeave}</p>
		</div>
		<div class="rounded-lg border bg-card p-6 shadow-sm">
			<p class="text-sm font-medium text-muted-foreground">Timesheets for Review</p>
			<p class="mt-2 text-3xl font-bold">{metrics.pendingTimesheets}</p>
		</div>
		<div class="rounded-lg border bg-card p-6 shadow-sm">
			<p class="text-sm font-medium text-muted-foreground">Last Payroll Total</p>
			{#if metrics.lastPayrollRun}
				<p class="mt-2 text-2xl font-bold">{formatCurrency(Number(metrics.lastPayrollRun.totalNet))}</p>
				<p class="text-xs text-muted-foreground">
					{formatShortDate(metrics.lastPayrollRun.periodEnd)}
					· {metrics.lastPayrollRun.status}
				</p>
			{:else}
				<p class="mt-2 text-lg text-muted-foreground">No runs yet</p>
			{/if}
		</div>
	</div>
</div>
