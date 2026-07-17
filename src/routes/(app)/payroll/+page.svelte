<script lang="ts">
	import { enhance } from '$app/forms'
	import { advanceTo } from '$lib/actions/dateRange'
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import TableSkeleton from '$lib/components/ui/TableSkeleton.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showCreate = $state(false)
</script>

<svelte:head>
	<title>Payroll — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Payroll Runs</h1>
		<div class="flex items-center gap-2">
			<a
				href="/payroll/calculator"
				class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Calculator</a
			>
			<a
				href="/payroll/periods"
				class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">Payroll Periods</a
			>
			<button
				onclick={() => (showCreate = !showCreate)}
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				New Payroll Run
			</button>
		</div>
	</div>

	{#if form?.error && !showCreate}
		<div
			class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive"
		>
			{form.error}
		</div>
	{/if}

	{#if showCreate}
		<form method="POST" action="?/create" use:enhance class="rounded-lg border p-4 space-y-3">
			<h2 class="font-semibold">Create Payroll Run</h2>
			{#if form?.error}<div class="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{form.error}
				</div>{/if}
			<div class="flex items-end gap-4">
				<div>
					<label for="periodStart" class="text-sm font-medium">Period Start</label>
					<input
						id="periodStart"
						name="periodStart"
						type="date"
						required
						use:advanceTo={'periodEnd'}
						class="mt-1 flex h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label for="periodEnd" class="text-sm font-medium">Period End</label>
					<input
						id="periodEnd"
						name="periodEnd"
						type="date"
						required
						class="mt-1 flex h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<button
					type="submit"
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>Create</button
				>
				<button
					type="button"
					onclick={() => (showCreate = false)}
					class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button
				>
			</div>
		</form>
	{/if}

	{#await data.runs}
		<TableSkeleton rows={5} cols={6} />
	{:then runs}
		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Period</th>
						<th class="px-4 py-3 text-right font-medium text-muted-foreground">Gross</th>
						<th class="px-4 py-3 text-right font-medium text-muted-foreground">Deductions</th>
						<th class="px-4 py-3 text-right font-medium text-muted-foreground">Net Pay</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
						<th class="px-4 py-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each runs as run (run.id)}
						<tr class="hover:bg-muted/30">
							<td class="px-4 py-3"
								>{formatShortDate(run.periodStart)} – {formatShortDate(run.periodEnd)}</td
							>
							<td class="px-4 py-3 text-right font-mono"
								>{formatCurrency(Number(run.totalGross))}</td
							>
							<td class="px-4 py-3 text-right font-mono text-muted-foreground"
								>{formatCurrency(Number(run.totalDeductions))}</td
							>
							<td class="px-4 py-3 text-right font-mono font-medium"
								>{formatCurrency(Number(run.totalNet))}</td
							>
							<td class="px-4 py-3">
								<span
									class={run.status === 'APPROVED'
										? 'badge-green'
										: run.status === 'COMPUTED'
											? 'badge-blue'
											: run.status === 'VOIDED'
												? 'badge-red'
												: 'badge-gray'}
								>
									{run.status}
									{#if run.hasOverride}<span class="ml-1 text-yellow-500">*</span>{/if}
								</span>
							</td>
							<td class="px-4 py-3 flex gap-2">
								{#if run.status === 'DRAFT'}
									<form method="POST" action="?/compute" use:enhance>
										<input type="hidden" name="id" value={run.id} />
										<button type="submit" class="btn-row">Compute</button>
									</form>
								{/if}
								{#if run.status === 'COMPUTED'}
									<form method="POST" action="?/compute" use:enhance>
										<input type="hidden" name="id" value={run.id} />
										<button type="submit" class="btn-row">Recompute</button>
									</form>
									<form method="POST" action="?/approve" use:enhance>
										<input type="hidden" name="id" value={run.id} />
										<button type="submit" class="btn-row-positive">Approve</button>
									</form>
								{/if}
								<a href="/payroll/{run.id}" class="btn-row">Detail</a>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="6" class="px-4 py-8 text-center text-muted-foreground"
								>No payroll runs yet</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/await}
</div>
