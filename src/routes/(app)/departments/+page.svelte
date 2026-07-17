<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	let showCreate = $state(false)
	let newName = $state('')
	let editingId = $state<string | null>(null)
	let editName = $state('')

	function startEdit(id: string, name: string) {
		editingId = id
		editName = name
	}

	function cancelEdit() {
		editingId = null
		editName = ''
	}

	// Members panel (#71): expand one department at a time to see current members
	// and transfer other employees in (routed through the employee-update path so
	// the move lands in employment history).
	let membersId = $state<string | null>(null)
	let assignId = $state('')
	const deptName = $derived(new Map(data.departments.map((d) => [d.id, d.name])))
	const membersOf = (id: string) => data.employees.filter((e) => e.departmentId === id)
	const assignableTo = (id: string) => data.employees.filter((e) => e.departmentId !== id)
	function toggleMembers(id: string) {
		membersId = membersId === id ? null : id
		assignId = ''
	}

	function formatDate(date: Date | string) {
		return new Date(date).toLocaleDateString('en-PH', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		})
	}
</script>

<svelte:head>
	<title>Departments — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Departments</h1>
		<button
			onclick={() => {
				showCreate = !showCreate
				newName = ''
			}}
			class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
		>
			{showCreate ? 'Cancel' : 'Add Department'}
		</button>
	</div>

	{#if form?.error}
		<div
			class="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
		>
			{form.error}
		</div>
	{/if}

	<!-- Inline create form -->
	{#if showCreate}
		<form
			method="POST"
			action="?/create"
			use:enhance={() => {
				return async ({ update }) => {
					await update()
					showCreate = false
					newName = ''
				}
			}}
			class="flex items-center gap-3 rounded-md border bg-muted/50 p-4"
		>
			<!-- The form only mounts on user action, so focusing it is expected. -->
			<!-- svelte-ignore a11y_autofocus -->
			<input
				name="name"
				bind:value={newName}
				placeholder="Department name…"
				required
				autofocus
				class="flex h-9 w-64 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
			<button
				type="submit"
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				Create
			</button>
			<button
				type="button"
				onclick={() => {
					showCreate = false
					newName = ''
				}}
				class="rounded-md border px-4 py-2 text-sm hover:bg-accent"
			>
				Cancel
			</button>
		</form>
	{/if}

	<!-- Departments table -->
	<div class="overflow-x-auto rounded-md border">
		<table class="w-full min-w-max text-sm">
			<thead class="border-b bg-muted/50">
				<tr>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employees</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
					<th class="px-4 py-3"></th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each data.departments as dept (dept.id)}
					<tr class="hover:bg-muted/30">
						<td class="px-4 py-3">
							{#if editingId === dept.id}
								<form
									method="POST"
									action="?/update"
									use:enhance={() => {
										return async ({ update }) => {
											await update()
											editingId = null
											editName = ''
										}
									}}
									class="flex items-center gap-2"
								>
									<input type="hidden" name="id" value={dept.id} />
									<input
										name="name"
										bind:value={editName}
										required
										class="flex h-8 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									/>
									<button
										type="submit"
										class="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
									>
										Save
									</button>
									<button
										type="button"
										onclick={cancelEdit}
										class="rounded-md border px-3 py-1 text-xs hover:bg-accent"
									>
										Cancel
									</button>
								</form>
							{:else}
								<span class="font-medium">{dept.name}</span>
							{/if}
						</td>
						<td class="px-4 py-3 text-muted-foreground">
							{dept._count.employees}
						</td>
						<td class="px-4 py-3 text-muted-foreground">
							{formatDate(dept.createdAt)}
						</td>
						<td class="px-4 py-3 text-right">
							{#if editingId !== dept.id}
								<div class="flex justify-end gap-2">
									<button
										onclick={() => toggleMembers(dept.id)}
										class="rounded-md border px-3 py-1 text-xs hover:bg-accent"
									>
										{membersId === dept.id ? 'Hide Members' : 'Members'}
									</button>
									<button
										onclick={() => startEdit(dept.id, dept.name)}
										class="rounded-md border px-3 py-1 text-xs hover:bg-accent"
									>
										Edit
									</button>
								</div>
							{/if}
						</td>
					</tr>
					{#if membersId === dept.id}
						<tr class="bg-muted/20">
							<td colspan="4" class="px-4 py-4">
								<div class="space-y-3">
									{#if membersOf(dept.id).length}
										<ul class="flex flex-wrap gap-2">
											{#each membersOf(dept.id) as emp (emp.id)}
												<li>
													<a
														href="/employees/{emp.id}"
														class="rounded-full border bg-card px-3 py-1 text-xs hover:border-primary/40"
														>{emp.lastName}, {emp.firstName}
														<span class="text-muted-foreground">· {emp.employeeNumber}</span></a
													>
												</li>
											{/each}
										</ul>
									{:else}
										<p class="text-xs text-muted-foreground">No active employees in this department.</p>
									{/if}
									<form
										method="POST"
										action="?/assignEmployee"
										use:enhance={() => {
											return async ({ update }) => {
												await update()
												assignId = ''
											}
										}}
										class="flex flex-wrap items-center gap-2"
									>
										<input type="hidden" name="departmentId" value={dept.id} />
										<select
											name="employeeId"
											bind:value={assignId}
											required
											class="h-8 max-w-xs rounded-md border border-input bg-background px-2 text-xs"
										>
											<option value="" disabled>Assign an employee…</option>
											{#each assignableTo(dept.id) as emp (emp.id)}
												<option value={emp.id}
													>{emp.lastName}, {emp.firstName} ({deptName.get(emp.departmentId) ??
														'—'})</option
												>
											{/each}
										</select>
										<button
											type="submit"
											disabled={!assignId}
											class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
											>Assign here</button
										>
										<span class="text-xs text-muted-foreground"
											>Transfers are recorded in the employee's employment history.</span
										>
									</form>
								</div>
							</td>
						</tr>
					{/if}
				{:else}
					<tr>
						<td colspan="4" class="px-4 py-8 text-center text-muted-foreground">
							No departments yet. Add one to get started.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
