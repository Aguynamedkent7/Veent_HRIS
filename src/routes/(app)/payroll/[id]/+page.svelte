<script lang="ts">
	import { enhance } from '$app/forms'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	const run = $derived(data.run)
	let overrideEntryId = $state<string | null>(null)
	let expandedEntryId = $state<string | null>(null)
</script>

<svelte:head>
	<title>Payroll {formatShortDate(run.periodStart)} — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center gap-4">
		<BackButton fallback="/payroll" label="Payroll" />
		<h1 class="text-2xl font-bold">
			{formatShortDate(run.periodStart)} – {formatShortDate(run.periodEnd)}
		</h1>
		<span class={run.status === 'APPROVED' ? 'badge-green' : 'badge-blue'}>
			{run.status}
		</span>
		{#if run.hasOverride}
			<span class="text-xs text-yellow-600 font-medium dark:text-yellow-500">Has overrides</span>
		{/if}
		{#if run.status === 'COMPUTED'}
			<!-- Recompute rebuilds all entries from current data (e.g. after assigning
			     recurring earnings/deductions). Disabled once approved. -->
			<form method="POST" action="?/compute" use:enhance class="ml-auto">
				<button
					type="submit"
					class="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent"
					>Recompute</button
				>
			</form>
		{/if}
	</div>

	{#if form?.error}
		<div
			class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive"
		>
			{form.error}
		</div>
	{/if}

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
			<p class="text-xl font-bold font-mono text-green-700 dark:text-green-400">
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
					<tr class="hover:bg-muted/30 {entry.isFlagged ? 'bg-yellow-500/10' : ''}">
						<td class="px-4 py-3">
							<div class="font-medium">{entry.employee.lastName}, {entry.employee.firstName}</div>
							<div class="text-xs text-muted-foreground">
								{entry.employee.employeeNumber} · {entry.employee.department.name}
							</div>
							{#if entry.isFlagged}
								<div class="text-xs text-yellow-600 dark:text-yellow-500">⚠ {entry.flagReason}</div>
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
							<div class="flex items-center justify-end gap-2">
								<button
									onclick={() => (expandedEntryId = expandedEntryId === entry.id ? null : entry.id)}
									class="btn-row">{expandedEntryId === entry.id ? 'Hide' : 'Breakdown'}</button
								>
								{#if run.status !== 'APPROVED'}
									<button onclick={() => (overrideEntryId = entry.id)} class="btn-row"
										>Override</button
									>
								{/if}
							</div>
						</td>
					</tr>
					{#if expandedEntryId === entry.id}
						<tr>
							<td colspan="8" class="bg-muted/30 px-4 py-3">
								<div class="grid gap-6 sm:grid-cols-2">
									<div>
										<p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
											Earnings
										</p>
										<table class="mt-1 w-full text-sm">
											<tbody>
												{#each entry.earnings as c (c.id)}
													<tr
														><td class="py-0.5">{c.label}{c.taxable ? '' : ' (non-taxable)'}</td><td
															class="py-0.5 text-right font-mono"
															>{formatCurrency(Number(c.amount))}</td
														></tr
													>
												{:else}
													<tr><td class="py-0.5 text-muted-foreground">No earning lines.</td></tr>
												{/each}
											</tbody>
										</table>
									</div>
									<div>
										<p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
											Deductions
										</p>
										<table class="mt-1 w-full text-sm">
											<tbody>
												{#each entry.deductions as c (c.id)}
													<tr
														><td class="py-0.5">{c.label}</td><td
															class="py-0.5 text-right font-mono text-muted-foreground"
															>{formatCurrency(Number(c.amount))}</td
														></tr
													>
												{:else}
													<tr><td class="py-0.5 text-muted-foreground">No deduction lines.</td></tr>
												{/each}
											</tbody>
										</table>
									</div>
								</div>
							</td>
						</tr>
					{/if}
					{#if overrideEntryId === entry.id}
						<tr>
							<td colspan="8" class="px-4 py-3 bg-muted/30">
								<form method="POST" action="?/override" use:enhance class="flex items-end gap-3">
									<input type="hidden" name="entryId" value={entry.id} />
									<div>
										<label for={'netPay-' + entry.id} class="text-xs font-medium"
											>Override Net Pay</label
										>
										<input
											id={'netPay-' + entry.id}
											name="netPay"
											type="number"
											step="any"
											value={Number(entry.netPay)}
											class="mt-1 flex h-8 w-36 rounded border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										/>
									</div>
									<div class="flex-1">
										<label for={'note-' + entry.id} class="text-xs font-medium"
											>Reason (required)</label
										>
										<input
											id={'note-' + entry.id}
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
