<script lang="ts">
	import { page } from '$app/stores'
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const currentYear = new Date().getFullYear()
</script>

<svelte:head>
	<title>Reports — Veent HRIS</title>
</svelte:head>

<div class="space-y-8">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Reports</h1>
		<form id="year-form" method="GET" class="flex items-center gap-2">
			<label class="text-sm font-medium">Year</label>
			<select name="year" onchange={() => { if (typeof document !== 'undefined') (document.getElementById('year-form') as HTMLFormElement)?.submit() }} class="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
				{#each [currentYear, currentYear - 1, currentYear - 2] as y (y)}
					<option value={y} selected={y === data.year}>{y}</option>
				{/each}
			</select>
		</form>
	</div>

	<!-- Attrition summary -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Workforce — {data.year}</h2>
		<div class="grid gap-4 sm:grid-cols-3">
			<div class="rounded-lg border bg-card p-4">
				<p class="text-sm text-muted-foreground">Total Active</p>
				<p class="text-3xl font-bold">{data.headcountByDept.reduce((s: number, d: typeof data.headcountByDept[number]) => s + d._count.employees, 0)}</p>
			</div>
			<div class="rounded-lg border bg-card p-4">
				<p class="text-sm text-muted-foreground">Hired in {data.year}</p>
				<p class="text-3xl font-bold text-green-700">{data.attrition.hired}</p>
			</div>
			<div class="rounded-lg border bg-card p-4">
				<p class="text-sm text-muted-foreground">Offboarded in {data.year}</p>
				<p class="text-3xl font-bold text-red-700">{data.attrition.offboarded}</p>
			</div>
		</div>
	</section>

	<!-- Headcount by department -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Headcount by Department</h2>
		<div class="rounded-lg border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Department</th>
						<th class="px-4 py-3 text-right font-medium text-muted-foreground">Active Employees</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.headcountByDept as dept (dept.id)}
						<tr class="hover:bg-muted/30">
							<td class="px-4 py-3">{dept.name}</td>
							<td class="px-4 py-3 text-right font-medium">{dept._count.employees}</td>
						</tr>
					{:else}
						<tr><td colspan="2" class="px-4 py-6 text-center text-muted-foreground">No data</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Payroll summary -->
	{#if data.payrollSummary.length > 0}
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Payroll Summary — {data.year}</h2>
			<div class="rounded-lg border overflow-x-auto">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/50">
						<tr>
							<th class="px-4 py-3 text-left font-medium text-muted-foreground">Period</th>
							<th class="px-4 py-3 text-right font-medium text-muted-foreground">Gross</th>
							<th class="px-4 py-3 text-right font-medium text-muted-foreground">Deductions</th>
							<th class="px-4 py-3 text-right font-medium text-muted-foreground">Net Pay</th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each data.payrollSummary as run (run.id)}
							<tr class="hover:bg-muted/30">
								<td class="px-4 py-3">{formatShortDate(run.periodStart)} – {formatShortDate(run.periodEnd)}</td>
								<td class="px-4 py-3 text-right font-mono">{formatCurrency(Number(run.totalGross))}</td>
								<td class="px-4 py-3 text-right font-mono text-muted-foreground">{formatCurrency(Number(run.totalDeductions))}</td>
								<td class="px-4 py-3 text-right font-mono font-medium">{formatCurrency(Number(run.totalNet))}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>
