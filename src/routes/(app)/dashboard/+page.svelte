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
	<div class="page-header">
		<h1 class="page-title">Dashboard</h1>
	</div>

	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<!-- Metric cards -->
		<div class="card flex flex-col gap-1">
			<p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Active Employees</p>
			<p class="mt-1 text-3xl font-bold text-foreground">{metrics.headcount}</p>
			<p class="text-xs text-muted-foreground">across your organisation</p>
		</div>

		<div class="card flex flex-col gap-1">
			<p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Pending Leave</p>
			<p class="mt-1 text-3xl font-bold {metrics.pendingLeave > 0 ? 'text-yellow-400' : 'text-foreground'}">{metrics.pendingLeave}</p>
			<p class="text-xs text-muted-foreground">requests awaiting review</p>
		</div>

		<div class="card flex flex-col gap-1">
			<p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Timesheets for Review</p>
			<p class="mt-1 text-3xl font-bold {metrics.pendingTimesheets > 0 ? 'text-blue-400' : 'text-foreground'}">{metrics.pendingTimesheets}</p>
			<p class="text-xs text-muted-foreground">submitted, awaiting approval</p>
		</div>

		<div class="card flex flex-col gap-1">
			<p class="text-xs font-medium uppercase tracking-wider text-muted-foreground">Last Payroll</p>
			{#if metrics.lastPayrollRun}
				<p class="mt-1 text-2xl font-bold text-foreground">{formatCurrency(Number(metrics.lastPayrollRun.totalNet))}</p>
				<p class="text-xs text-muted-foreground">
					{formatShortDate(metrics.lastPayrollRun.periodEnd)} ·
					<span class="badge-{metrics.lastPayrollRun.status === 'APPROVED' ? 'green' : 'yellow'} inline">
						{metrics.lastPayrollRun.status}
					</span>
				</p>
			{:else}
				<p class="mt-1 text-xl text-muted-foreground">No runs yet</p>
			{/if}
		</div>
	</div>
</div>
