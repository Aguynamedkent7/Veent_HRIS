<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	let showCreate = $state(false)
</script>

<svelte:head>
	<title>Organization Structure — Veent HRIS</title>
</svelte:head>

<div class="space-y-8">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Organization Structure</h1>
		<button
			onclick={() => (showCreate = !showCreate)}
			class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
		>
			Add Position
		</button>
	</div>

	<!-- Create position form -->
	{#if showCreate}
		<form method="POST" action="?/createPosition" use:enhance class="rounded-lg border p-4 space-y-4">
			<h2 class="font-semibold">New Position</h2>
			<div class="grid gap-3 sm:grid-cols-3">
				<div>
					<label class="text-sm font-medium">Title</label>
					<input
						name="title"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">Level</label>
					<input
						name="level"
						type="number"
						min="0"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">Department</label>
					<select
						name="departmentId"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<option value="">— None —</option>
						{#each data.orgChart as dept (dept.id)}
							<option value={dept.id}>{dept.name}</option>
						{/each}
					</select>
				</div>
			</div>
			<div class="flex gap-2 justify-end">
				<button
					type="button"
					onclick={() => (showCreate = false)}
					class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button
				>
				<button
					type="submit"
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>Create</button
				>
			</div>
		</form>
	{/if}

	<!-- Positions catalog -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Positions</h2>
		<div class="rounded-lg border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Department</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Level</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employees</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.positions as pos (pos.id)}
						<tr class="hover:bg-muted/30">
							<td class="px-4 py-3 font-medium">{pos.title}</td>
							<td class="px-4 py-3 text-muted-foreground">{pos.department?.name ?? '—'}</td>
							<td class="px-4 py-3 text-muted-foreground">{pos.level ?? '—'}</td>
							<td class="px-4 py-3 text-muted-foreground">{pos._count.employees}</td>
							<td class="px-4 py-3">
								<span
									class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {pos.isActive
										? 'bg-green-100 text-green-700'
										: 'bg-gray-100 text-gray-600'}"
								>
									{pos.isActive ? 'ACTIVE' : 'INACTIVE'}
								</span>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="5" class="px-4 py-8 text-center text-muted-foreground"
								>No positions defined</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Org chart -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Org Chart</h2>
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.orgChart as dept (dept.id)}
				<div class="rounded-lg border bg-card p-4">
					<h3 class="font-semibold">{dept.name}</h3>
					<p class="text-xs text-muted-foreground mb-3">
						{dept.employees.length} member{dept.employees.length === 1 ? '' : 's'}
					</p>
					<ul class="space-y-1">
						{#each dept.employees as emp (emp.id)}
							<li class="text-sm">
								<span class="font-medium">{emp.lastName}, {emp.firstName}</span>
								<span class="text-muted-foreground"> — {emp.jobTitle}</span>
							</li>
						{:else}
							<li class="text-sm text-muted-foreground">No employees</li>
						{/each}
					</ul>
				</div>
			{:else}
				<p class="text-sm text-muted-foreground">No departments defined</p>
			{/each}
		</div>
	</section>
</div>
