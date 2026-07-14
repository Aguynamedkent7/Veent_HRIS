<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatCurrency } from '$lib/utils/format'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	let showCreate = $state(false)
</script>

<svelte:head>
	<title>Benefits — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Benefits</h1>
		<button
			onclick={() => (showCreate = !showCreate)}
			class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
		>
			Add Plan
		</button>
	</div>

	<!-- Create form -->
	{#if showCreate}
		<form
			method="POST"
			action="?/createPlan"
			use:enhance
			class="rounded-lg border bg-card p-4 space-y-4"
		>
			<h2 class="font-semibold">New Benefit Plan</h2>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label class="text-sm font-medium">Name</label>
					<input
						name="name"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">Type</label>
					<select
						name="type"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<option value="HMO">HMO</option>
						<option value="INSURANCE">Insurance</option>
						<option value="RETIREMENT">Retirement</option>
						<option value="ALLOWANCE">Allowance</option>
						<option value="LEAVE_CREDIT">Leave Credit</option>
						<option value="OTHER">Other</option>
					</select>
				</div>
				<div>
					<label class="text-sm font-medium">Provider</label>
					<input
						name="provider"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">Description</label>
					<input
						name="description"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">Employee Cost (PHP)</label>
					<input
						name="employeeCost"
						type="number"
						min="0"
						step="0.01"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">Employer Cost (PHP)</label>
					<input
						name="employerCost"
						type="number"
						min="0"
						step="0.01"
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
	<div class="overflow-x-auto rounded-lg border">
		<table class="w-full text-sm">
			<thead class="border-b bg-muted/50">
				<tr>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Provider</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">EE Cost</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">ER Cost</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Active</th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each data.plans as plan (plan.id)}
					<tr class="hover:bg-muted/30">
						<td class="px-4 py-3 font-medium">{plan.name}</td>
						<td class="px-4 py-3 text-muted-foreground">{plan.type.replace('_', ' ')}</td>
						<td class="px-4 py-3 text-muted-foreground">{plan.provider ?? '—'}</td>
						<td class="px-4 py-3 text-right"
							>{plan.employeeCost != null ? formatCurrency(Number(plan.employeeCost)) : '—'}</td
						>
						<td class="px-4 py-3 text-right"
							>{plan.employerCost != null ? formatCurrency(Number(plan.employerCost)) : '—'}</td
						>
						<td class="px-4 py-3">
							<span
								class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {plan.isActive
									? 'bg-green-100 text-green-700'
									: 'bg-gray-100 text-gray-600'}"
							>
								{plan.isActive ? 'Active' : 'Inactive'}
							</span>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="px-4 py-8 text-center text-muted-foreground"
							>No benefit plans found</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- Enrollments -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Enrollments</h2>

		<form
			method="POST"
			action="?/enroll"
			use:enhance
			class="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-4"
		>
			<div class="grid gap-1">
				<label for="enr-emp" class="text-xs font-medium text-muted-foreground">Employee</label>
				<select
					id="enr-emp"
					name="employeeId"
					required
					class="h-9 rounded-md border border-input bg-background px-2 text-sm"
				>
					{#each data.employees as e (e.id)}<option value={e.id}>{e.lastName}, {e.firstName}</option
						>{/each}
				</select>
			</div>
			<div class="grid gap-1">
				<label for="enr-plan" class="text-xs font-medium text-muted-foreground">Plan</label>
				<select
					id="enr-plan"
					name="benefitPlanId"
					required
					class="h-9 rounded-md border border-input bg-background px-2 text-sm"
				>
					{#each data.plans.filter((p) => p.isActive) as p (p.id)}<option value={p.id}
							>{p.name}</option
						>{/each}
				</select>
			</div>
			<div class="grid gap-1">
				<label for="enr-cov" class="text-xs font-medium text-muted-foreground">Coverage</label>
				<input
					id="enr-cov"
					name="coverageLevel"
					placeholder="e.g. Self + 1"
					class="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm"
				/>
			</div>
			<div class="grid gap-1">
				<label for="enr-date" class="text-xs font-medium text-muted-foreground">Effective</label>
				<input
					id="enr-date"
					name="effectiveDate"
					type="date"
					required
					class="h-9 rounded-md border border-input bg-background px-2 text-sm"
				/>
			</div>
			<button
				class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>Enroll</button
			>
		</form>

		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Plan</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Coverage</th>
						<th class="px-4 py-3 text-right font-medium text-muted-foreground">EE Cost</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
						<th class="px-4 py-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.enrollments as en (en.id)}
						<tr class="hover:bg-muted/30 {en.status === 'ACTIVE' ? '' : 'opacity-60'}">
							<td class="px-4 py-3">{en.employee.lastName}, {en.employee.firstName}</td>
							<td class="px-4 py-3 text-muted-foreground">{en.plan.name}</td>
							<td class="px-4 py-3 text-muted-foreground">{en.coverageLevel ?? '—'}</td>
							<td class="px-4 py-3 text-right"
								>{en.plan.employeeCost != null
									? formatCurrency(Number(en.plan.employeeCost))
									: '—'}</td
							>
							<td class="px-4 py-3">
								<span
									class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {en.status ===
									'ACTIVE'
										? 'bg-green-100 text-green-700'
										: en.status === 'WAIVED'
											? 'bg-yellow-100 text-yellow-700'
											: 'bg-gray-100 text-gray-600'}">{en.status}</span
								>
							</td>
							<td class="px-4 py-3 text-right">
								<form
									method="POST"
									action="?/setEnrollmentStatus"
									use:enhance
									class="inline-flex items-center gap-1"
								>
									<input type="hidden" name="id" value={en.id} />
									<select
										name="status"
										onchange={(e) =>
											(e.currentTarget.closest('form') as HTMLFormElement).requestSubmit()}
										class="h-7 rounded border border-input bg-background px-1 text-xs"
									>
										<option value="ACTIVE" selected={en.status === 'ACTIVE'}>Active</option>
										<option value="WAIVED" selected={en.status === 'WAIVED'}>Waived</option>
										<option value="TERMINATED" selected={en.status === 'TERMINATED'}
											>Terminated</option
										>
									</select>
								</form>
							</td>
						</tr>
					{:else}
						<tr
							><td colspan="6" class="px-4 py-8 text-center text-muted-foreground"
								>No enrollments yet.</td
							></tr
						>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
