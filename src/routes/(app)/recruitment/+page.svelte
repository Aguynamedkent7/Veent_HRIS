<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatShortDate } from '$lib/utils/format'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	let showCreate = $state(false)
</script>

<svelte:head>
	<title>Recruitment — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Recruitment</h1>
		<button
			onclick={() => (showCreate = !showCreate)}
			class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
		>
			New Job Posting
		</button>
	</div>

	{#if showCreate}
		<form method="POST" action="?/create" use:enhance class="rounded-lg border p-4 space-y-3">
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
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>Create Draft</button
				>
			</div>
		</form>
	{/if}

	<div class="overflow-x-auto rounded-lg border">
		<table class="w-full text-sm">
			<thead class="border-b bg-muted/50">
				<tr>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Position</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Department</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Applicants</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Posted</th>
					<th class="px-4 py-3"></th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each data.postings as jp (jp.id)}
					<tr class="hover:bg-muted/30">
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
						<td class="px-4 py-3 flex gap-2">
							{#if jp.status === 'DRAFT'}
								<form method="POST" action="?/publish" use:enhance>
									<input type="hidden" name="id" value={jp.id} />
									<button type="submit" class="text-primary text-xs hover:underline">Publish</button
									>
								</form>
							{/if}
							<a href="/recruitment/{jp.id}" class="text-primary text-xs hover:underline">View</a>
						</td>
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
