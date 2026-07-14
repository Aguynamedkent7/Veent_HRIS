<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatCurrency } from '$lib/utils/format'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
</script>

<svelte:head>
	<title>Salary Grades — Veent HRIS</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-6">
	<div>
		<a href="/settings" class="text-sm text-muted-foreground hover:underline">← Settings</a>
		<h1 class="mt-1 text-2xl font-bold tracking-tight">Salary Grades</h1>
		<p class="text-sm text-muted-foreground">
			Pay bands assignable to positions. Employees inherit their band via their position; HR is
			warned when a basic salary falls outside it.
		</p>
	</div>

	{#if form?.error}
		<div class="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
			{form.error}
		</div>
	{/if}

	<!-- Grades -->
	<section class="space-y-3 rounded-lg border bg-card p-4">
		<h2 class="font-semibold">Grades</h2>
		<div class="overflow-x-auto rounded-md border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="px-3 py-2 text-left font-medium text-muted-foreground">Grade</th>
						<th class="px-3 py-2 text-right font-medium text-muted-foreground">Min</th>
						<th class="px-3 py-2 text-right font-medium text-muted-foreground">Mid</th>
						<th class="px-3 py-2 text-right font-medium text-muted-foreground">Max</th>
						<th class="px-3 py-2"></th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.grades as g (g.id)}
						<tr class="hover:bg-muted/30 {g.isActive ? '' : 'opacity-50'}">
							<td class="px-3 py-2 font-medium">{g.name}</td>
							<td class="px-3 py-2 text-right font-mono text-xs"
								>{formatCurrency(Number(g.minSalary))}</td
							>
							<td class="px-3 py-2 text-right font-mono text-xs"
								>{formatCurrency(Number(g.midSalary))}</td
							>
							<td class="px-3 py-2 text-right font-mono text-xs"
								>{formatCurrency(Number(g.maxSalary))}</td
							>
							<td class="px-3 py-2 text-right">
								<form method="POST" action="?/toggleGrade" use:enhance>
									<input type="hidden" name="id" value={g.id} />
									<button
										type="submit"
										class="text-xs {g.isActive ? 'text-red-600' : 'text-green-600'} hover:underline"
										>{g.isActive ? 'Deactivate' : 'Activate'}</button
									>
								</form>
							</td>
						</tr>
					{:else}
						<tr
							><td colspan="5" class="px-3 py-6 text-center text-muted-foreground"
								>No grades yet.</td
							></tr
						>
					{/each}
				</tbody>
			</table>
		</div>
		<form
			method="POST"
			action="?/addGrade"
			use:enhance
			class="flex flex-wrap items-end gap-2 border-t pt-3"
		>
			<input
				name="name"
				placeholder="Grade name"
				required
				class="h-8 w-36 rounded-md border border-input bg-background px-2 text-xs"
			/>
			<input
				name="minSalary"
				type="number"
				min="0"
				step="0.01"
				placeholder="Min"
				required
				class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
			/>
			<input
				name="midSalary"
				type="number"
				min="0"
				step="0.01"
				placeholder="Mid"
				required
				class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
			/>
			<input
				name="maxSalary"
				type="number"
				min="0"
				step="0.01"
				placeholder="Max"
				required
				class="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
			/>
			<button
				class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
				>Add Grade</button
			>
		</form>
	</section>

	<!-- Position assignment -->
	<section class="space-y-3 rounded-lg border bg-card p-4">
		<h2 class="font-semibold">Position Grades</h2>
		{#if data.positions.length}
			<div class="overflow-x-auto rounded-md border">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/50">
						<tr>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Position</th>
							<th class="px-3 py-2 text-left font-medium text-muted-foreground">Grade</th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each data.positions as p (p.id)}
							<tr class="hover:bg-muted/30">
								<td class="px-3 py-2">{p.title}</td>
								<td class="px-3 py-2">
									<form
										method="POST"
										action="?/assignGrade"
										use:enhance
										class="flex items-center gap-2"
									>
										<input type="hidden" name="positionId" value={p.id} />
										<select
											name="salaryGradeId"
											onchange={(e) =>
												(e.currentTarget.closest('form') as HTMLFormElement).requestSubmit()}
											class="h-8 rounded-md border border-input bg-background px-2 text-xs"
										>
											<option value="" selected={!p.salaryGradeId}>— none —</option>
											{#each data.grades as g (g.id)}
												<option value={g.id} selected={p.salaryGradeId === g.id}>{g.name}</option>
											{/each}
										</select>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-xs text-muted-foreground">
				No positions defined. Create positions under <a
					href="/settings/org"
					class="text-primary hover:underline">Org Structure</a
				>.
			</p>
		{/if}
	</section>
</div>
