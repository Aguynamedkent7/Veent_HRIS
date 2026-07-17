<script lang="ts">
	import Pagination from '$lib/components/Pagination.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	const ACTIONS = [
		'CREATE',
		'UPDATE',
		'DELETE',
		'LOGIN',
		'LOGIN_FAILED',
		'PAYROLL_OVERRIDE',
		'LEAVE_OVERRIDE'
	]
</script>

<svelte:head>
	<title>Audit Log — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold tracking-tight">Audit Log</h1>

	<!-- Filter form -->
	<form method="GET" class="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
		<!-- Actor -->
		<div class="flex flex-col gap-1">
			<label for="actor" class="text-xs font-medium text-muted-foreground">Actor</label>
			<select
				id="actor"
				name="actor"
				class="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<option value="">All Users</option>
				{#each data.actors as actor (actor.id)}
					<option value={actor.id}>{actor.email}</option>
				{/each}
			</select>
		</div>

		<!-- Entity type -->
		<div class="flex flex-col gap-1">
			<label for="entity" class="text-xs font-medium text-muted-foreground">Entity Type</label>
			<select
				id="entity"
				name="entity"
				class="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<option value="">All Types</option>
				{#each data.entityTypes as et (et)}
					<option value={et}>{et}</option>
				{/each}
			</select>
		</div>

		<!-- Action -->
		<div class="flex flex-col gap-1">
			<label for="action" class="text-xs font-medium text-muted-foreground">Action</label>
			<select
				id="action"
				name="action"
				class="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<option value="">All Actions</option>
				{#each ACTIONS as a (a)}
					<option value={a}>{a}</option>
				{/each}
			</select>
		</div>

		<!-- Date range -->
		<div class="flex flex-col gap-1">
			<label for="start" class="text-xs font-medium text-muted-foreground">From</label>
			<input
				id="start"
				name="start"
				type="date"
				class="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
		</div>
		<div class="flex flex-col gap-1">
			<label for="end" class="text-xs font-medium text-muted-foreground">To</label>
			<input
				id="end"
				name="end"
				type="date"
				class="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
		</div>

		<button
			type="submit"
			class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
		>
			Filter
		</button>
	</form>

	<!-- Summary -->
	<p class="text-sm text-muted-foreground">
		{data.pagination.total.toLocaleString()} total entries — page {data.pagination.page} of {data
			.pagination.totalPages}
	</p>

	<!-- Table -->
	{#if data.logs.length === 0}
		<div
			class="flex h-40 items-center justify-center rounded-lg border bg-muted/30 text-muted-foreground"
		>
			No audit log entries match the selected filters.
		</div>
	{:else}
		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap"
							>Timestamp</th
						>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap"
							>Actor</th
						>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap"
							>Action</th
						>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap"
							>Entity Type</th
						>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap"
							>Entity ID</th
						>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Changes</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.logs as log (log.id)}
						<tr class="hover:bg-muted/30">
							<td class="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">
								{new Date(log.createdAt).toLocaleString('en-PH', {
									year: 'numeric',
									month: 'short',
									day: 'numeric',
									hour: '2-digit',
									minute: '2-digit',
									second: '2-digit'
								})}
							</td>
							<td class="px-4 py-3 whitespace-nowrap">
								<span class="font-medium">{log.actor.email}</span>
								<span class="ml-1 rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground"
									>{log.actor.role}</span
								>
							</td>
							<td class="px-4 py-3 whitespace-nowrap">
								<span
									class="rounded px-2 py-0.5 text-xs font-medium {log.action === 'CREATE'
										? 'bg-green-100 text-green-800'
										: log.action === 'DELETE'
											? 'bg-red-100 text-red-800'
											: log.action === 'UPDATE'
												? 'bg-blue-100 text-blue-800'
												: log.action === 'LOGIN_FAILED'
													? 'bg-amber-100 text-amber-800'
													: 'bg-muted text-muted-foreground'}"
								>
									{log.action}
								</span>
							</td>
							<td class="px-4 py-3 whitespace-nowrap">{log.entityType}</td>
							<td class="px-4 py-3 whitespace-nowrap font-mono text-xs text-muted-foreground">
								{log.entityId.slice(0, 12)}…
							</td>
							<td class="px-4 py-3">
								{#if log.oldValue !== null || log.newValue !== null}
									<details class="cursor-pointer">
										<summary class="text-xs text-muted-foreground hover:text-foreground"
											>View changes</summary
										>
										<div class="mt-1 space-y-1">
											{#if log.oldValue !== null}
												<div>
													<span class="text-xs font-medium text-red-600">Before:</span>
													<pre
														class="mt-0.5 max-w-xs overflow-x-auto rounded bg-muted p-1 text-xs">{JSON.stringify(
															log.oldValue,
															null,
															2
														)}</pre>
												</div>
											{/if}
											{#if log.newValue !== null}
												<div>
													<span class="text-xs font-medium text-green-600">After:</span>
													<pre
														class="mt-0.5 max-w-xs overflow-x-auto rounded bg-muted p-1 text-xs">{JSON.stringify(
															log.newValue,
															null,
															2
														)}</pre>
												</div>
											{/if}
										</div>
									</details>
								{:else}
									<span class="text-xs text-muted-foreground">—</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<Pagination meta={data.pagination} />
	{/if}
</div>
