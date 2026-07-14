<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const { run } = data
	let overrideEntryId = $state<string | null>(null)
</script>

<svelte:head>
	<title>Payroll {formatShortDate(run.periodStart)} — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center gap-4">
		<a href="/payroll" class="text-sm text-muted-foreground hover:text-foreground">← Payroll</a>
		<h1 class="text-2xl font-bold">
			{formatShortDate(run.periodStart)} – {formatShortDate(run.periodEnd)}
		</h1>
		<span
			class="rounded-full px-2.5 py-1 text-xs font-medium {run.status === 'APPROVED'
				? 'bg-green-100 text-green-700'
				: 'bg-blue-100 text-blue-700'}"
		>
			{run.status}
		</span>
		{#if run.hasOverride}
			<span class="text-xs text-yellow-600 font-medium">Has overrides</span>
		{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-3">
		<div class="rounded-lg border bg-card p-4">
			<p class="text-sm text-muted-foreground">Total Gross</p>
			<p class="text-xl font-bold font-mono">{formatCurrency(Number(run.totalGross))}</p>
		</div>
		<div class="rounded-lg border bg-card p-4">
			<p class="text-sm text-muted-foreground">Total Deductions</p>
			<p class="text-xl font-bold font-mono">{formatCurrency(Number(run.totalDeductions))}</p>
		</div>
		<div class="rounded-lg border bg-card p-4">
			<p class="text-sm text-muted-foreground">Total Net Pay</p>
			<p class="text-xl font-bold font-mono text-green-700">
				{formatCurrency(Number(run.totalNet))}
			</p>
		</div>
	</div>

	<div class="rounded-lg border overflow-x-auto">
		<table class="w-full text-sm">
			<thead class="border-b bg-muted/50">
				<tr>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">Gross</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">SSS (EE)</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">PhilHealth</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">Pag-IBIG</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">BIR Tax</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">Net Pay</th>
					<th class="px-4 py-3"></th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each run.entries as entry (entry.id)}
					<tr class="hover:bg-muted/30 {entry.isFlagged ? 'bg-yellow-50' : ''}">
						<td class="px-4 py-3">
							<div class="font-medium">{entry.employee.lastName}, {entry.employee.firstName}</div>
							<div class="text-xs text-muted-foreground">
								{entry.employee.employeeNumber} · {entry.employee.department.name}
							</div>
							{#if entry.isFlagged}
								<div class="text-xs text-yellow-600">⚠ {entry.flagReason}</div>
							{/if}
						</td>
						<td class="px-4 py-3 text-right font-mono">{formatCurrency(Number(entry.grossPay))}</td>
						<td class="px-4 py-3 text-right font-mono text-muted-foreground"
							>{formatCurrency(Number(entry.sssEe))}</td
						>
						<td class="px-4 py-3 text-right font-mono text-muted-foreground"
							>{formatCurrency(Number(entry.philhealthEe))}</td
						>
						<td class="px-4 py-3 text-right font-mono text-muted-foreground"
							>{formatCurrency(Number(entry.pagibigEe))}</td
						>
						<td class="px-4 py-3 text-right font-mono text-muted-foreground"
							>{formatCurrency(Number(entry.withholdingTax))}</td
						>
						<td class="px-4 py-3 text-right font-mono font-medium"
							>{formatCurrency(Number(entry.netPay))}</td
						>
						<td class="px-4 py-3">
							{#if run.status !== 'APPROVED'}
								<button
									onclick={() => (overrideEntryId = entry.id)}
									class="text-xs text-primary hover:underline">Override</button
								>
							{/if}
						</td>
					</tr>
					{#if overrideEntryId === entry.id}
						<tr>
							<td colspan="8" class="px-4 py-3 bg-muted/30">
								<form method="POST" action="?/override" use:enhance class="flex items-end gap-3">
									<input type="hidden" name="entryId" value={entry.id} />
									<div>
										<label class="text-xs font-medium">Override Net Pay</label>
										<input
											name="netPay"
											type="number"
											step="0.01"
											value={Number(entry.netPay)}
											class="mt-1 flex h-8 w-36 rounded border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										/>
									</div>
									<div class="flex-1">
										<label class="text-xs font-medium">Reason (required)</label>
										<input
											name="note"
											required
											class="mt-1 flex h-8 w-full rounded border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										/>
									</div>
									<button
										type="submit"
										class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
										>Save</button
									>
									<button
										type="button"
										onclick={() => (overrideEntryId = null)}
										class="rounded border px-3 py-1.5 text-xs hover:bg-accent">Cancel</button
									>
								</form>
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
</div>
