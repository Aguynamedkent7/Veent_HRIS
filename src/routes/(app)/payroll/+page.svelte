<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import PeriodPicker from '$lib/components/ui/PeriodPicker.svelte'
	import TableSkeleton from '$lib/components/ui/TableSkeleton.svelte'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showCreate = $state(false)

	// #108: a double-submit here creates a duplicate payroll run for the same period.
	const create = createSubmitGuard()

	// #108: compute/approve live inside an {#each}, so each run needs its OWN guard — a single
	// shared one would disable every row's button at once. Memoised by `${runId}:${action}`.
	const guards = new Map<string, ReturnType<typeof createSubmitGuard>>()
	function guard(key: string) {
		let g = guards.get(key)
		if (!g) guards.set(key, (g = createSubmitGuard()))
		return g
	}
</script>

<svelte:head>
	<title>Payroll — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Payroll Runs</h1>
		{#if data.canManage}
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
		{:else}
			<!-- Sign-off roles (Verifier/Approver) see a read-only list and open a run to act. -->
			<span class="text-xs text-muted-foreground">Open a computed run to verify or approve it.</span
			>
		{/if}
	</div>

	{#if form?.error && !showCreate}
		<div
			class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive"
		>
			{form.error}
		</div>
	{/if}

	{#if showCreate}
		<form
			method="POST"
			action="?/create"
			use:enhance={create.enhance}
			class="rounded-lg border p-4 space-y-3"
		>
			<h2 class="font-semibold">Create Payroll Run</h2>
			{#if form?.error}<div class="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{form.error}
				</div>{/if}
			<div class="max-w-md">
				<PeriodPicker />
			</div>
			<div class="flex items-center gap-2">
				<button
					type="submit"
					disabled={create.busy}
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
					>{create.busy ? 'Creating…' : 'Create'}</button
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
							<td class="px-4 py-3">
								<div class="flex items-center justify-end gap-2">
									<!-- Creating a run computes it (#138), so a run only stays DRAFT when that
									     compute failed — this button is the recovery path. -->
									{#if data.canManage && run.status === 'DRAFT'}
										{@const computeG = guard(`${run.id}:compute`)}
										<form method="POST" action="?/compute" use:enhance={computeG.enhance}>
											<input type="hidden" name="id" value={run.id} />
											<button
												type="submit"
												disabled={computeG.busy}
												class="btn-row disabled:pointer-events-none disabled:opacity-50"
												>{computeG.busy ? 'Computing…' : 'Compute'}</button
											>
										</form>
									{/if}
									{#if data.canManage && run.status === 'COMPUTED'}
										{@const recomputeG = guard(`${run.id}:compute`)}
										<form method="POST" action="?/compute" use:enhance={recomputeG.enhance}>
											<input type="hidden" name="id" value={run.id} />
											<button
												type="submit"
												disabled={recomputeG.busy}
												class="btn-row disabled:pointer-events-none disabled:opacity-50"
												>{recomputeG.busy ? 'Computing…' : 'Recompute'}</button
											>
										</form>
									{/if}
									<!-- Sign-off (verify → approve) happens through the chain on the detail page (#134). -->
									<a href="/payroll/{run.id}" class="btn-row"
										>{run.status === 'COMPUTED' ? 'Review' : 'Detail'}</a
									>
								</div>
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
