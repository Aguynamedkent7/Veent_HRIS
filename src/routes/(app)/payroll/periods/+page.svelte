<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatCurrency, formatShortDate } from '$lib/utils/format'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showOpen = $state(false)

	const badge: Record<string, string> = {
		OPEN: 'bg-gray-100 text-gray-600',
		IMPORTED: 'bg-blue-100 text-blue-700',
		GENERATED: 'bg-blue-100 text-blue-700',
		LOCKED: 'bg-yellow-100 text-yellow-700',
		RELEASED: 'bg-green-100 text-green-700',
		VOIDED: 'bg-red-100 text-red-700'
	}
</script>

<svelte:head>
	<title>Payroll Periods — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<a href="/payroll" class="text-sm text-muted-foreground hover:text-foreground">← Payroll</a>
			<h1 class="text-2xl font-bold tracking-tight">Payroll Periods</h1>
		</div>
		<button
			onclick={() => (showOpen = !showOpen)}
			class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
		>
			Open Period
		</button>
	</div>

	{#if form?.error}
		<div
			class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-red-400"
		>
			{form.error}
		</div>
	{/if}

	{#if showOpen}
		<form method="POST" action="?/open" use:enhance class="rounded-lg border p-4 space-y-3">
			<h2 class="font-semibold">Open a Payroll Period</h2>
			<div class="grid gap-3 sm:grid-cols-4">
				<div>
					<label class="text-sm font-medium">Name</label>
					<input
						name="name"
						required
						placeholder="Jul 1–15 2026"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">Start</label>
					<input
						name="start"
						type="date"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">End</label>
					<input
						name="end"
						type="date"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium"
						>Cutoff <span class="text-muted-foreground">(day)</span></label
					>
					<input
						name="cutoff"
						type="number"
						min="1"
						max="31"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
			</div>
			<div class="flex justify-end gap-2">
				<button
					type="button"
					onclick={() => (showOpen = false)}
					class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button
				>
				<button
					type="submit"
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>Open</button
				>
			</div>
		</form>
	{/if}

	<div class="rounded-lg border">
		<table class="w-full text-sm">
			<thead class="border-b bg-muted/50">
				<tr>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Period</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Dates</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">Net</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each data.periods as p (p.id)}
					{@const run = p.runs[0]}
					<tr class="hover:bg-muted/30">
						<td class="px-4 py-3 font-medium">{p.name}</td>
						<td class="px-4 py-3 text-muted-foreground"
							>{formatShortDate(p.startDate)} – {formatShortDate(p.endDate)}</td
						>
						<td class="px-4 py-3 text-right font-mono"
							>{run ? formatCurrency(Number(run.totalNet)) : '—'}</td
						>
						<td class="px-4 py-3">
							<span
								class="rounded-full px-2 py-0.5 text-xs font-medium {badge[p.status] ??
									'bg-gray-100 text-gray-600'}">{p.status}</span
							>
						</td>
						<td class="px-4 py-3">
							<div class="flex flex-wrap items-center justify-end gap-2">
								{#if p.status === 'OPEN'}
									<form method="POST" action="?/import" use:enhance>
										<input type="hidden" name="id" value={p.id} />
										<button class="text-primary text-xs hover:underline">Import Attendance</button>
									</form>
								{/if}
								{#if p.status === 'OPEN' || p.status === 'IMPORTED' || p.status === 'GENERATED'}
									<form method="POST" action="?/generate" use:enhance>
										<input type="hidden" name="id" value={p.id} />
										<button class="text-primary text-xs hover:underline"
											>{p.status === 'GENERATED' ? 'Re-generate' : 'Generate'}</button
										>
									</form>
								{/if}
								{#if p.status === 'GENERATED'}
									<form method="POST" action="?/lock" use:enhance class="flex items-center gap-1">
										<input type="hidden" name="id" value={p.id} />
										<input
											name="overrideNote"
											placeholder="Override note (if flagged)"
											class="h-7 w-44 rounded border border-input bg-background px-2 text-xs"
										/>
										<button class="text-yellow-600 text-xs hover:underline">Lock</button>
									</form>
								{/if}
								{#if p.status === 'LOCKED'}
									<form method="POST" action="?/release" use:enhance>
										<input type="hidden" name="id" value={p.id} />
										<button class="text-green-600 text-xs hover:underline">Release</button>
									</form>
								{/if}
								{#if run}
									<a href="/payroll/{run.id}" class="text-primary text-xs hover:underline">Detail</a
									>
								{/if}
								{#if data.isSuperAdmin && p.status !== 'VOIDED'}
									<form method="POST" action="?/void" use:enhance>
										<input type="hidden" name="id" value={p.id} />
										<button class="text-red-600 text-xs hover:underline">Void</button>
									</form>
								{/if}
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5" class="px-4 py-8 text-center text-muted-foreground"
							>No payroll periods yet</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
