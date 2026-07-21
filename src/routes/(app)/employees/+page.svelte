<script lang="ts">
	import { page } from '$app/stores'
	import { goto } from '$app/navigation'
	import { formatShortDate } from '$lib/utils/format'
	import Pagination from '$lib/components/Pagination.svelte'
	import TableSkeleton from '$lib/components/ui/TableSkeleton.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	let search = $state($page.url.searchParams.get('search') ?? '')
</script>

<svelte:head>
	<title>Employees — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Employees</h1>
		<a
			href="/employees/new"
			class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
		>
			Add Employee
		</a>
	</div>

	<!-- Search -->
	<!-- One GET form: a sibling form would submit on its own and drop the search term. -->
	<form method="GET" class="flex flex-wrap gap-2">
		<input
			name="search"
			value={search}
			placeholder="Search by name or employee number…"
			class="flex h-9 w-64 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		/>
		{#if data.showBranches}
			<select
				name="branch"
				aria-label="Branch"
				class="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<option value="">All branches</option>
				{#each data.branches as br (br.id)}
					<option value={br.id} selected={data.branchFilter === br.id}>{br.name}</option>
				{/each}
			</select>
		{/if}
		<button type="submit" class="rounded-md border px-3 py-1 text-sm hover:bg-accent">Search</button
		>
	</form>

	<!-- Table -->
	{#await data.employees}
		<TableSkeleton rows={6} cols={6} />
	{:then employees}
		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full min-w-max text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Department</th>
						{#if data.showBranches}
							<th class="px-4 py-3 text-left font-medium text-muted-foreground">Branch</th>
						{/if}
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Start Date</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each employees as emp (emp.id)}
						<tr
							class="cursor-pointer hover:bg-muted/30"
							role="link"
							tabindex="0"
							onclick={() => goto(`/employees/${emp.id}`)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault()
									goto(`/employees/${emp.id}`)
								}
							}}
						>
							<td class="px-4 py-3">
								<div class="font-medium">{emp.lastName}, {emp.firstName}</div>
								<div class="text-xs text-muted-foreground">{emp.employeeNumber}</div>
							</td>
							<td class="px-4 py-3 text-muted-foreground">{emp.department.name}</td>
							{#if data.showBranches}
								<td class="px-4 py-3 text-muted-foreground">{emp.branch?.name ?? '—'}</td>
							{/if}
							<td class="px-4 py-3">{emp.jobTitle}</td>
							<td class="px-4 py-3 text-muted-foreground">{emp.employmentType.replace('_', ' ')}</td
							>
							<td class="px-4 py-3">
								<span
									class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {emp.employmentStatus ===
									'ACTIVE'
										? 'bg-green-500/15 text-green-400'
										: 'bg-gray-500/15 text-gray-400'}"
								>
									{emp.employmentStatus}
								</span>
							</td>
							<td class="px-4 py-3 text-muted-foreground">{formatShortDate(emp.startDate)}</td>
						</tr>
					{:else}
						<tr>
							<td colspan="6" class="px-4 py-8 text-center text-muted-foreground"
								>No employees found</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/await}

	<Pagination meta={data.pagination} />
</div>
