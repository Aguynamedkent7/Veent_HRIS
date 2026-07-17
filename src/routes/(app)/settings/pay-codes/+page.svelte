<script lang="ts">
	import { enhance } from '$app/forms'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
</script>

<svelte:head>
	<title>Earnings & Deductions — Veent HRIS</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-6">
	<div>
		<BackButton fallback="/settings" label="Settings" />
		<h1 class="mt-1 text-2xl font-bold tracking-tight">Earnings &amp; Deduction Codes</h1>
		<p class="text-sm text-muted-foreground">
			Codes used by the payroll engine. Deactivate instead of deleting — historical payslips
			reference them.
		</p>
	</div>

	{#if form?.error}
		<div class="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
			{form.error}
		</div>
	{/if}

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- Earnings -->
		<section class="space-y-3 rounded-lg border bg-card p-4">
			<h2 class="font-semibold">Earnings</h2>
			<div class="overflow-x-auto rounded-md border">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/50">
						<tr>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Code</th>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Label</th>
							<th class="px-3 py-2 text-center font-medium text-muted-foreground">Taxable</th>
							<th class="px-3 py-2 text-right font-medium text-muted-foreground">×</th>
							<th class="px-3 py-2"></th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each data.earningTypes as et (et.id)}
							<tr class="hover:bg-muted/30 {et.isActive ? '' : 'opacity-50'}">
								<td class="px-3 py-2 font-mono text-xs">{et.code}</td>
								<td class="px-3 py-2">{et.label}</td>
								<td class="px-3 py-2 text-center">{et.taxable ? '✓' : '—'}</td>
								<td class="px-3 py-2 text-right font-mono text-xs"
									>{et.multiplier ? Number(et.multiplier).toFixed(2) : '—'}</td
								>
								<td class="px-3 py-2 text-right">
									<form method="POST" action="?/toggleEarning" use:enhance>
										<input type="hidden" name="id" value={et.id} />
										<button
											type="submit"
											class="text-xs {et.isActive
												? 'text-red-600'
												: 'text-green-600'} hover:underline"
											>{et.isActive ? 'Deactivate' : 'Activate'}</button
										>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<form
				method="POST"
				action="?/addEarning"
				use:enhance
				class="flex flex-wrap items-end gap-2 border-t pt-3"
			>
				<input
					name="code"
					placeholder="CODE"
					required
					class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs uppercase"
				/>
				<input
					name="label"
					placeholder="Label"
					required
					class="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs"
				/>
				<input
					name="multiplier"
					type="number"
					step="0.01"
					min="0"
					placeholder="×"
					class="h-8 w-16 rounded-md border border-input bg-background px-2 text-xs"
				/>
				<label class="flex items-center gap-1 text-xs"
					><input name="taxable" type="checkbox" checked /> Taxable</label
				>
				<button
					class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
					>Add</button
				>
			</form>
		</section>

		<!-- Deductions -->
		<section class="space-y-3 rounded-lg border bg-card p-4">
			<h2 class="font-semibold">Deductions</h2>
			<div class="overflow-x-auto rounded-md border">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/50">
						<tr>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Code</th>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Label</th>
							<th class="px-3 py-2 text-center font-medium text-muted-foreground">Statutory</th>
							<th class="px-3 py-2"></th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each data.deductionTypes as dt (dt.id)}
							<tr class="hover:bg-muted/30 {dt.isActive ? '' : 'opacity-50'}">
								<td class="px-3 py-2 font-mono text-xs">{dt.code}</td>
								<td class="px-3 py-2">{dt.label}</td>
								<td class="px-3 py-2 text-center">{dt.isStatutory ? '✓' : '—'}</td>
								<td class="px-3 py-2 text-right">
									<form method="POST" action="?/toggleDeduction" use:enhance>
										<input type="hidden" name="id" value={dt.id} />
										<button
											type="submit"
											class="text-xs {dt.isActive
												? 'text-red-600'
												: 'text-green-600'} hover:underline"
											>{dt.isActive ? 'Deactivate' : 'Activate'}</button
										>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<form
				method="POST"
				action="?/addDeduction"
				use:enhance
				class="flex flex-wrap items-end gap-2 border-t pt-3"
			>
				<input
					name="code"
					placeholder="CODE"
					required
					class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs uppercase"
				/>
				<input
					name="label"
					placeholder="Label"
					required
					class="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs"
				/>
				<label class="flex items-center gap-1 text-xs"
					><input name="isStatutory" type="checkbox" /> Statutory</label
				>
				<button
					class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
					>Add</button
				>
			</form>
		</section>
	</div>
</div>
