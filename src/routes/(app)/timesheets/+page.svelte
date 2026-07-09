<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatShortDate } from '$lib/utils/format'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	let showCreate = $state(false)
</script>

<svelte:head>
	<title>Timesheets — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Timesheets</h1>
		{#if data.myEmployeeId}
			<button onclick={() => (showCreate = !showCreate)} class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
				New Timesheet
			</button>
		{/if}
	</div>

	{#if showCreate}
		<form method="POST" action="?/create" use:enhance class="rounded-lg border p-4 space-y-3">
			<h2 class="font-semibold">Create Timesheet</h2>
			<div class="flex items-end gap-4">
				<div>
					<label class="text-sm font-medium">Period Start</label>
					<input name="periodStart" type="date" required class="mt-1 flex h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
				</div>
				<div>
					<label class="text-sm font-medium">Period End</label>
					<input name="periodEnd" type="date" required class="mt-1 flex h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
				</div>
				<button type="submit" class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Create</button>
				<button type="button" onclick={() => (showCreate = false)} class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
			</div>
		</form>
	{/if}

	<div class="rounded-lg border">
		<table class="w-full text-sm">
			<thead class="border-b bg-muted/50">
				<tr>
					{#if data.isManager}<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>{/if}
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Period</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Total Hours</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					<th class="px-4 py-3"></th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each data.timesheets as ts (ts.id)}
					<tr class="hover:bg-muted/30">
						{#if data.isManager}
							<td class="px-4 py-3">{ts.employee.lastName}, {ts.employee.firstName}</td>
						{/if}
						<td class="px-4 py-3">{formatShortDate(ts.periodStart)} – {formatShortDate(ts.periodEnd)}</td>
						<td class="px-4 py-3">{Number(ts.totalHours).toFixed(2)} hrs</td>
						<td class="px-4 py-3">
							<span class="rounded-full px-2 py-0.5 text-xs font-medium {ts.status === 'APPROVED' ? 'bg-green-100 text-green-700' : ts.status === 'REJECTED' ? 'bg-red-100 text-red-700' : ts.status === 'SUBMITTED' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}">
								{ts.status}
							</span>
						</td>
						<td class="px-4 py-3 flex gap-2">
							{#if ts.status === 'DRAFT' && ts.employeeId === data.myEmployeeId}
								<form method="POST" action="?/submit" use:enhance>
									<input type="hidden" name="id" value={ts.id} />
									<button type="submit" class="text-primary text-xs hover:underline">Submit</button>
								</form>
							{/if}
							{#if ts.status === 'SUBMITTED' && data.isManager}
								<form method="POST" action="?/review" use:enhance class="flex gap-1">
									<input type="hidden" name="id" value={ts.id} />
									<button type="submit" name="approved" value="true" class="text-green-600 text-xs hover:underline">Approve</button>
									<button type="submit" name="approved" value="false" class="text-red-600 text-xs hover:underline">Reject</button>
								</form>
							{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5" class="px-4 py-8 text-center text-muted-foreground">No timesheets found</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
