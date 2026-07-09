<script lang="ts">
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const { metrics } = data
</script>

<svelte:head>
	<title>Dashboard — Veent HRIS</title>
</svelte:head>

<div class="space-y-8">
	<div class="page-header">
		<h1 class="page-title">Dashboard</h1>
	</div>

	<!-- Metric cards -->
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		<div class="card flex flex-col gap-3">
			<p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Active Employees</p>
			<p class="text-4xl font-bold text-foreground">{metrics.headcount}</p>
			<p class="text-xs text-muted-foreground">across your organisation</p>
		</div>

		<div class="card flex flex-col gap-3">
			<p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Pending Leave</p>
			<p class="text-4xl font-bold {metrics.pendingLeave > 0 ? 'text-yellow-400' : 'text-foreground'}">{metrics.pendingLeave}</p>
			<p class="text-xs text-muted-foreground">requests awaiting review</p>
		</div>

		<div class="card flex flex-col gap-3">
			<p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Timesheets for Review</p>
			<p class="text-4xl font-bold {metrics.pendingTimesheets > 0 ? 'text-blue-400' : 'text-foreground'}">{metrics.pendingTimesheets}</p>
			<p class="text-xs text-muted-foreground">submitted, awaiting approval</p>
		</div>

		<div class="card flex flex-col gap-3">
			<p class="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Last Payroll</p>
			{#if metrics.lastPayrollRun}
				<p class="text-3xl font-bold text-foreground">{formatCurrency(Number(metrics.lastPayrollRun.totalNet))}</p>
				<p class="flex items-center gap-2 text-xs text-muted-foreground">
					<span>{formatShortDate(metrics.lastPayrollRun.periodEnd)}</span>
					<span class="badge-{metrics.lastPayrollRun.status === 'APPROVED' ? 'green' : 'yellow'}">
						{metrics.lastPayrollRun.status}
					</span>
				</p>
			{:else}
				<p class="text-2xl font-semibold text-muted-foreground/60">—</p>
				<p class="text-xs text-muted-foreground">no payroll runs yet</p>
			{/if}
		</div>
	</div>

	<!-- Quick actions -->
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		<a href="/employees/new" class="card group flex items-center gap-4 transition-colors hover:border-primary/40 hover:bg-card/80">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/20">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM3 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 9.374 21c-2.331 0-4.512-.645-6.374-1.766Z" />
				</svg>
			</div>
			<div>
				<p class="text-sm font-medium text-foreground">Onboard Employee</p>
				<p class="text-xs text-muted-foreground">Add a new team member</p>
			</div>
		</a>

		<a href="/timesheets/new" class="card group flex items-center gap-4 transition-colors hover:border-primary/40 hover:bg-card/80">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 group-hover:bg-blue-500/20">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
				</svg>
			</div>
			<div>
				<p class="text-sm font-medium text-foreground">Log Timesheet</p>
				<p class="text-xs text-muted-foreground">Submit this week's hours</p>
			</div>
		</a>

		<a href="/leave/new" class="card group flex items-center gap-4 transition-colors hover:border-primary/40 hover:bg-card/80">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-yellow-500/10 text-yellow-400 group-hover:bg-yellow-500/20">
				<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
				</svg>
			</div>
			<div>
				<p class="text-sm font-medium text-foreground">File Leave</p>
				<p class="text-xs text-muted-foreground">Submit a leave request</p>
			</div>
		</a>
	</div>
</div>
