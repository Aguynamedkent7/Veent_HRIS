<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showCreate = $state(false)
	let editingId = $state<string | null>(null)

	const inputClass =
		'mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
</script>

<svelte:head>
	<title>Organization Structure — Veent HRIS</title>
</svelte:head>

<div class="space-y-8">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Organization Structure</h1>
		<div class="flex gap-2">
			<a
				href="/settings/org-chart"
				class="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">View Org Chart</a
			>
			<button
				onclick={() => (showCreate = !showCreate)}
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				Add Position
			</button>
		</div>
	</div>

	{#if form?.error}
		<div
			class="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
		>
			{form.error}
		</div>
	{/if}

	<!-- Create position form -->
	{#if showCreate}
		<form
			method="POST"
			action="?/createPosition"
			use:enhance={() =>
				async ({ update }) => {
					await update()
					showCreate = false
				}}
			class="rounded-lg border p-4 space-y-4"
		>
			<h2 class="font-semibold">New Position</h2>
			<div class="grid gap-3 sm:grid-cols-3">
				<div>
					<label class="text-sm font-medium">Title</label>
					<input name="title" required class={inputClass} />
				</div>
				<div>
					<label class="text-sm font-medium">Level</label>
					<input name="level" type="number" min="0" class={inputClass} />
				</div>
				<div>
					<label class="text-sm font-medium">Department</label>
					<select name="departmentId" class={inputClass}>
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
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Salary Grade</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employees</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
						<th class="px-4 py-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.positions as pos (pos.id)}
						<tr class="hover:bg-muted/30">
							<td class="px-4 py-3 font-medium">{pos.title}</td>
							<td class="px-4 py-3 text-muted-foreground">{pos.department?.name ?? '—'}</td>
							<td class="px-4 py-3 text-muted-foreground">{pos.level ?? '—'}</td>
							<td class="px-4 py-3 text-muted-foreground">{pos.salaryGrade?.name ?? '—'}</td>
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
							<td class="px-4 py-3 text-right">
								<button
									onclick={() => (editingId = editingId === pos.id ? null : pos.id)}
									class="rounded-md border px-3 py-1 text-xs hover:bg-accent"
								>
									{editingId === pos.id ? 'Close' : 'Edit'}
								</button>
							</td>
						</tr>
						{#if editingId === pos.id}
							<tr class="bg-muted/20">
								<td colspan="7" class="px-4 py-4">
									<form
										method="POST"
										action="?/updatePosition"
										use:enhance={() =>
											async ({ update }) => {
												await update({ reset: false })
												editingId = null
											}}
										class="grid items-end gap-3 sm:grid-cols-5"
									>
										<input type="hidden" name="id" value={pos.id} />
										<div>
											<label class="text-xs font-medium">Title</label>
											<input name="title" required value={pos.title} class={inputClass} />
										</div>
										<div>
											<label class="text-xs font-medium">Level</label>
											<input
												name="level"
												type="number"
												min="0"
												value={pos.level ?? ''}
												class={inputClass}
											/>
										</div>
										<div>
											<label class="text-xs font-medium">Department</label>
											<select name="departmentId" value={pos.departmentId ?? ''} class={inputClass}>
												<option value="">— None —</option>
												{#each data.orgChart as dept (dept.id)}
													<option value={dept.id}>{dept.name}</option>
												{/each}
											</select>
										</div>
										<div>
											<label class="text-xs font-medium">Salary Grade</label>
											<select
												name="salaryGradeId"
												value={pos.salaryGradeId ?? ''}
												class={inputClass}
											>
												<option value="">— None —</option>
												{#each data.salaryGrades as g (g.id)}
													<option value={g.id}>{g.name}</option>
												{/each}
											</select>
										</div>
										<div>
											<label class="text-xs font-medium">Status</label>
											<select
												name="isActive"
												value={pos.isActive ? 'true' : 'false'}
												class={inputClass}
											>
												<option value="true">Active</option>
												<option value="false">Inactive</option>
											</select>
										</div>
										<div class="sm:col-span-5 flex justify-end gap-2">
											<button
												type="button"
												onclick={() => (editingId = null)}
												class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button
											>
											<button
												type="submit"
												class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
												>Save</button
											>
										</div>
									</form>
								</td>
							</tr>
						{/if}
					{:else}
						<tr>
							<td colspan="7" class="px-4 py-8 text-center text-muted-foreground"
								>No positions defined</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Employee ↔ position assignment -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Employee Assignments</h2>
		<p class="text-sm text-muted-foreground">Assign each employee to a position in the catalog.</p>
		<div class="rounded-lg border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Job Title</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Department</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Position</th>
						<th class="px-4 py-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.employees as emp (emp.id)}
						<tr class="hover:bg-muted/30">
							<td class="px-4 py-3 font-medium">{emp.name}</td>
							<td class="px-4 py-3 text-muted-foreground">{emp.jobTitle}</td>
							<td class="px-4 py-3 text-muted-foreground">{emp.departmentName ?? '—'}</td>
							<td class="px-4 py-3" colspan="2">
								<form
									method="POST"
									action="?/assignEmployee"
									use:enhance
									class="flex items-center gap-2"
								>
									<input type="hidden" name="employeeId" value={emp.id} />
									<select
										name="positionId"
										value={emp.positionId ?? ''}
										class="flex h-9 w-56 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<option value="">— Unassigned —</option>
										{#each data.positions as pos (pos.id)}
											<option value={pos.id}>{pos.title}</option>
										{/each}
									</select>
									<button
										type="submit"
										class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
										>Save</button
									>
								</form>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="5" class="px-4 py-8 text-center text-muted-foreground"
								>No employees found</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
