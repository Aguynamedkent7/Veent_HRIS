<script lang="ts">
	import { enhance } from '$app/forms'
	import { page } from '$app/stores'
	import { formatShortDate } from '$lib/utils/format'
	import TableSkeleton from '$lib/components/ui/TableSkeleton.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	let showCreate = $state(false)
	let search = $state($page.url.searchParams.get('search') ?? '')
</script>

<svelte:head>
	<title>Employees — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Employees</h1>
		<button
			onclick={() => (showCreate = !showCreate)}
			class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
		>
			Add Employee
		</button>
	</div>

	<!-- Search -->
	<form method="GET" class="flex gap-2">
		<input
			name="search"
			value={search}
			placeholder="Search by name or employee number…"
			class="flex h-9 w-64 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		/>
		<button type="submit" class="rounded-md border px-3 py-1 text-sm hover:bg-accent">Search</button
		>
	</form>

	<!-- Create form -->
	{#if showCreate}
		<form method="POST" action="?/create" use:enhance class="rounded-lg border p-4 space-y-4">
			<h2 class="font-semibold">New Employee</h2>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label class="text-sm font-medium">Email</label>
					<input
						name="email"
						type="email"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">Role</label>
					<select
						name="role"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<option value="EMPLOYEE">Employee</option>
						<option value="MANAGER">Manager</option>
						<option value="HR_ADMIN">HR Admin</option>
					</select>
				</div>
				<div>
					<label class="text-sm font-medium">First Name</label>
					<input
						name="firstName"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">Last Name</label>
					<input
						name="lastName"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">Department</label>
					<select
						name="departmentId"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{#each data.departments as dept (dept.id)}
							<option value={dept.id}>{dept.name}</option>
						{/each}
					</select>
				</div>
				<div>
					<label class="text-sm font-medium">Job Title</label>
					<input
						name="jobTitle"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">Employment Type</label>
					<select
						name="employmentType"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<option value="FULL_TIME">Full-time</option>
						<option value="PART_TIME">Part-time</option>
						<option value="CONTRACTUAL">Contractual</option>
						<option value="PROBATIONARY">Probationary</option>
					</select>
				</div>
				<div>
					<label class="text-sm font-medium">Start Date</label>
					<input
						name="startDate"
						type="date"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">Basic Monthly Salary (PHP)</label>
					<input
						name="basicMonthlySalary"
						type="number"
						min="0"
						step="0.01"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
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

	<!-- Table -->
	{#await data.employees}
		<TableSkeleton rows={6} cols={6} />
	{:then employees}
		<div class="rounded-lg border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Department</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Start Date</th>
						<th class="px-4 py-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each employees as emp (emp.id)}
						<tr class="hover:bg-muted/30">
							<td class="px-4 py-3">
								<div class="font-medium">{emp.lastName}, {emp.firstName}</div>
								<div class="text-xs text-muted-foreground">{emp.employeeNumber}</div>
							</td>
							<td class="px-4 py-3 text-muted-foreground">{emp.department.name}</td>
							<td class="px-4 py-3">{emp.jobTitle}</td>
							<td class="px-4 py-3 text-muted-foreground">{emp.employmentType.replace('_', ' ')}</td
							>
							<td class="px-4 py-3">
								<span
									class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {emp.employmentStatus ===
									'ACTIVE'
										? 'bg-green-100 text-green-700'
										: 'bg-gray-100 text-gray-600'}"
								>
									{emp.employmentStatus}
								</span>
							</td>
							<td class="px-4 py-3 text-muted-foreground">{formatShortDate(emp.startDate)}</td>
							<td class="px-4 py-3">
								<a href="/employees/{emp.id}" class="text-primary hover:underline text-xs">View</a>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="7" class="px-4 py-8 text-center text-muted-foreground"
								>No employees found</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/await}
</div>
