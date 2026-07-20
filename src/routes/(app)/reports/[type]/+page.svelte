<script lang="ts">
	import { formatCurrency } from '$lib/utils/format'
	import { advanceTo } from '$lib/actions/dateRange'
	import { navigating } from '$app/stores'
	import TableSkeleton from '$lib/components/ui/TableSkeleton.svelte'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	// svelte-ignore state_referenced_locally
	let startValue = $state(data.startDate)
	// svelte-ignore state_referenced_locally
	let endValue = $state(data.endDate)

	// True while a report is being (re)generated via the same-route GET filter form.
	const isGenerating = $derived(
		!!$navigating && $navigating.to?.route.id === '/(app)/reports/[type]'
	)

	const REPORT_LABELS: Record<string, string> = {
		headcount: 'Headcount Report',
		attendance: 'Attendance Report',
		'payroll-costs': 'Payroll Costs Report',
		'leave-utilization': 'Leave Utilization Report',
		'payroll-register': 'Payroll Register',
		tardiness: 'Tardiness Report',
		overtime: 'Overtime Report',
		'loan-summary': 'Loan Summary',
		'government-remittance': 'Government Remittance',
		'bir-withholding': 'BIR Withholding Report',
		separation: 'Separation Report'
	}

	const title = $derived(REPORT_LABELS[data.reportType] ?? 'Report')

	// Show department filter only for report types that support it
	const showDeptFilter = $derived(
		['headcount', 'attendance', 'tardiness', 'overtime'].includes(data.reportType)
	)

	// Build CSV export URL
	const csvUrl = $derived(() => {
		const params = new URLSearchParams({
			export: 'csv',
			start: data.startDate,
			end: data.endDate
		})
		if (data.selectedDepartment) params.set('department', data.selectedDepartment)
		return `/api/v1/reports/${data.reportType}?${params.toString()}`
	})

	// Currency columns
	const CURRENCY_COLS = new Set([
		'TotalGross',
		'TotalNet',
		'Gross',
		'SSS',
		'PhilHealth',
		'PagIBIG',
		'Tax',
		'OtherDeductions',
		'Net',
		'Principal',
		'Balance',
		'Installment',
		'EmployeeShare',
		'EmployerShare',
		'Total',
		'TaxWithheld'
	])

	function formatCell(col: string, val: unknown): string {
		if (val === null || val === undefined) return '—'
		if (CURRENCY_COLS.has(col) && typeof val === 'number') return formatCurrency(val)
		return String(val)
	}

	const MAX_DISPLAY = 500
	const truncated = $derived(data.results.length > MAX_DISPLAY)
	const displayResults = $derived(
		truncated ? data.results.slice(0, MAX_DISPLAY) : data.results
	) as Record<string, unknown>[]
</script>

<svelte:head>
	<title>{title} — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<BackButton fallback="/reports" label="Reports" />

	<!-- Header -->
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="text-2xl font-bold tracking-tight">{title}</h1>
		{#if data.results.length > 0}
			<a
				href={csvUrl()}
				class="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
					<polyline points="7 10 12 15 17 10" />
					<line x1="12" y1="15" x2="12" y2="3" />
				</svg>
				Export CSV
			</a>
		{/if}
	</div>

	<!-- Filter form -->
	<form method="GET" class="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
		<div class="flex flex-col gap-1">
			<label for="start" class="text-xs font-medium text-muted-foreground">Start Date</label>
			<input
				id="start"
				name="start"
				type="date"
				bind:value={startValue}
				max={endValue || undefined}
				use:advanceTo={'end'}
				class="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
		</div>
		<div class="flex flex-col gap-1">
			<label for="end" class="text-xs font-medium text-muted-foreground">End Date</label>
			<input
				id="end"
				name="end"
				type="date"
				bind:value={endValue}
				min={startValue || undefined}
				class="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
		</div>
		{#if showDeptFilter}
			<div class="flex flex-col gap-1">
				<label for="department" class="text-xs font-medium text-muted-foreground">Department</label>
				<select
					id="department"
					name="department"
					class="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<option value="">All Departments</option>
					{#each data.departments as dept (dept.id)}
						<option value={dept.id} selected={dept.id === data.selectedDepartment}>
							{dept.name}
						</option>
					{/each}
				</select>
			</div>
		{/if}
		<button
			type="submit"
			class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
		>
			Generate
		</button>
	</form>

	<!-- Results -->
	{#if isGenerating}
		<TableSkeleton rows={8} cols={data.columns.length || 4} />
	{:else if data.results.length === 0}
		<div
			class="flex h-40 items-center justify-center rounded-lg border bg-muted/30 text-muted-foreground"
		>
			No results found for the selected filters.
		</div>
	{:else}
		<div class="space-y-2">
			<p class="text-sm text-muted-foreground">
				Showing {displayResults.length} of {data.results.length} row{data.results.length === 1
					? ''
					: 's'}{#if truncated}&nbsp;<span class="font-medium text-amber-600"
						>(display limited to {MAX_DISPLAY} rows — export CSV for full data)</span
					>{/if}
			</p>
			<div class="overflow-x-auto rounded-lg border">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/50">
						<tr>
							{#each data.columns as col (col)}
								<th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
									{col}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each displayResults as row, i (i)}
							<tr class="hover:bg-muted/30">
								{#each data.columns as col (col)}
									<td
										class="px-4 py-3 whitespace-nowrap {CURRENCY_COLS.has(col)
											? 'text-right font-mono'
											: ''}"
									>
										{formatCell(col, row[col])}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>
