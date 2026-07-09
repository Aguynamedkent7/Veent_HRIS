<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatShortDate } from '$lib/utils/format'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showRequest = $state(false)
</script>

<svelte:head>
	<title>Leave — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Leave</h1>
		{#if data.myEmployeeId}
			<button onclick={() => (showRequest = !showRequest)} class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
				File Leave
			</button>
		{/if}
	</div>

	<!-- Balances -->
	{#if data.balances.length > 0}
		<div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
			{#each data.balances as b (b.id)}
				<div class="rounded-lg border bg-card p-4">
					<p class="text-xs font-medium text-muted-foreground">{b.leaveType.name}</p>
					<p class="mt-1 text-2xl font-bold">{Number(b.remaining).toFixed(1)}</p>
					<p class="text-xs text-muted-foreground">of {Number(b.allocated)} days</p>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Request form -->
	{#if showRequest}
		<form method="POST" action="?/request" use:enhance class="rounded-lg border p-4 space-y-4">
			<h2 class="font-semibold">File Leave Request</h2>
			{#if form?.error}
				<div class="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</div>
			{/if}
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<label class="text-sm font-medium">Leave Type</label>
					<select name="leaveTypeId" required class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
						{#each data.leaveTypes as lt (lt.id)}
							<option value={lt.id}>{lt.name}</option>
						{/each}
					</select>
				</div>
				<div>
					<label class="text-sm font-medium">Reason (optional)</label>
					<input name="reason" class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
				</div>
				<div>
					<label class="text-sm font-medium">Start Date</label>
					<input name="startDate" type="date" required class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
				</div>
				<div>
					<label class="text-sm font-medium">End Date</label>
					<input name="endDate" type="date" required class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
				</div>
			</div>
			<div class="flex gap-2 justify-end">
				<button type="button" onclick={() => (showRequest = false)} class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button>
				<button type="submit" class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Submit Request</button>
			</div>
		</form>
	{/if}

	<!-- Requests table -->
	<div class="rounded-lg border">
		<table class="w-full text-sm">
			<thead class="border-b bg-muted/50">
				<tr>
					{#if data.isManager}<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>{/if}
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Leave Type</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Dates</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Days</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					<th class="px-4 py-3"></th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each data.requests as req (req.id)}
					<tr class="hover:bg-muted/30">
						{#if data.isManager}
							<td class="px-4 py-3">{req.employee.lastName}, {req.employee.firstName}</td>
						{/if}
						<td class="px-4 py-3">{req.leaveType.name}</td>
						<td class="px-4 py-3 text-muted-foreground">{formatShortDate(req.startDate)} – {formatShortDate(req.endDate)}</td>
						<td class="px-4 py-3">{Number(req.totalDays)}</td>
						<td class="px-4 py-3">
							<span class="rounded-full px-2 py-0.5 text-xs font-medium {req.status === 'APPROVED' ? 'bg-green-100 text-green-700' : req.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}">
								{req.status}
							</span>
						</td>
						<td class="px-4 py-3">
							{#if req.status === 'PENDING' && data.isManager}
								<form method="POST" action="?/review" use:enhance class="flex gap-2">
									<input type="hidden" name="id" value={req.id} />
									<button name="approved" value="true" class="text-green-600 text-xs hover:underline">Approve</button>
									<button name="approved" value="false" class="text-red-600 text-xs hover:underline">Reject</button>
								</form>
							{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="px-4 py-8 text-center text-muted-foreground">No leave requests</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
