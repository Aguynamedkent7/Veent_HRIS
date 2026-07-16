<script lang="ts">
	import { enhance } from '$app/forms'
	import { goto } from '$app/navigation'
	import { formatShortDate } from '$lib/utils/format'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showCreate = $state(false)
	let creating = $state(false)
	let selectedIds = $state<string[]>([])

	const draftIds = $derived(
		data.postings.filter((p: { status: string }) => p.status === 'DRAFT').map((p) => p.id)
	)
	const selectedDraftIds = $derived(selectedIds.filter((id) => draftIds.includes(id)))
	const allDraftsSelected = $derived(
		draftIds.length > 0 && draftIds.every((id) => selectedIds.includes(id))
	)

	function toggle(id: string) {
		selectedIds = selectedIds.includes(id)
			? selectedIds.filter((x) => x !== id)
			: [...selectedIds, id]
	}
	function toggleAllDrafts() {
		selectedIds = allDraftsSelected
			? selectedIds.filter((id) => !draftIds.includes(id))
			: [...draftIds]
	}
</script>

<svelte:head>
	<title>Recruitment — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h1 class="text-2xl font-bold tracking-tight">Recruitment</h1>
		<div class="flex items-center gap-2">
			{#if selectedDraftIds.length}
				<form
					method="POST"
					action="?/publishMany"
					use:enhance={() => {
						return async ({ update }) => {
							selectedIds = []
							await update()
						}
					}}
				>
					{#each selectedDraftIds as id (id)}
						<input type="hidden" name="ids" value={id} />
					{/each}
					<button
						type="submit"
						class="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20"
					>
						Publish selected ({selectedDraftIds.length})
					</button>
				</form>
			{/if}
			<button
				onclick={() => (showCreate = !showCreate)}
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				New Job Posting
			</button>
		</div>
	</div>

	{#if form?.success && form.message}
		<div
			role="status"
			class="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700"
		>
			{form.message}
		</div>
	{/if}
	{#if form?.error}
		<div
			role="alert"
			class="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
		>
			{form.error}
		</div>
	{/if}

	{#if showCreate}
		<form
			method="POST"
			action="?/create"
			use:enhance={() => {
				creating = true
				return async ({ update, result }) => {
					await update()
					creating = false
					if (result.type === 'success') showCreate = false
				}
			}}
			class="rounded-lg border p-4 space-y-3"
		>
			<h2 class="font-semibold">Create Job Posting</h2>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label class="text-sm font-medium">Job Title</label>
					<input
						name="title"
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
				<div class="sm:col-span-2">
					<label class="text-sm font-medium">Description</label>
					<textarea
						name="description"
						required
						rows="4"
						class="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					></textarea>
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
					disabled={creating}
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
					>{creating ? 'Creating…' : 'Create Draft'}</button
				>
			</div>
		</form>
	{/if}

	<div class="overflow-x-auto rounded-lg border">
		<table class="w-full text-sm">
			<thead class="border-b bg-muted/50">
				<tr>
					<th class="w-10 px-4 py-3">
						{#if draftIds.length}
							<input
								type="checkbox"
								checked={allDraftsSelected}
								onchange={toggleAllDrafts}
								title="Select all drafts"
								class="h-4 w-4 rounded border-input"
							/>
						{/if}
					</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Position</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Department</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Applicants</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Posted</th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each data.postings as jp (jp.id)}
					<tr
						class="cursor-pointer hover:bg-muted/30"
						role="link"
						tabindex="0"
						onclick={() => goto(`/recruitment/${jp.id}`)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault()
								goto(`/recruitment/${jp.id}`)
							}
						}}
					>
						<td class="px-4 py-3" onclick={(e) => e.stopPropagation()}>
							{#if jp.status === 'DRAFT'}
								<input
									type="checkbox"
									checked={selectedIds.includes(jp.id)}
									onchange={() => toggle(jp.id)}
									class="h-4 w-4 rounded border-input"
								/>
							{/if}
						</td>
						<td class="px-4 py-3 font-medium">{jp.title}</td>
						<td class="px-4 py-3 text-muted-foreground">{jp.department.name}</td>
						<td class="px-4 py-3">{jp._count.applicants}</td>
						<td class="px-4 py-3">
							<span
								class="rounded-full px-2 py-0.5 text-xs font-medium {jp.status === 'OPEN'
									? 'bg-green-100 text-green-700'
									: jp.status === 'CLOSED'
										? 'bg-gray-100 text-gray-600'
										: 'bg-yellow-100 text-yellow-700'}"
							>
								{jp.status}
							</span>
						</td>
						<td class="px-4 py-3 text-muted-foreground"
							>{jp.postedAt ? formatShortDate(jp.postedAt) : '—'}</td
						>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="px-4 py-8 text-center text-muted-foreground"
							>No job postings yet</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
