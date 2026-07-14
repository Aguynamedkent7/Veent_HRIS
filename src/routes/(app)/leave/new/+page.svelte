<script lang="ts">
	import { enhance } from '$app/forms'
	import BalanceSummary from '$lib/components/leave/BalanceSummary.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	let selectedLeaveTypeId = $state('')

	let selectedBalance = $derived(data.balances.find((b) => b.leaveTypeId === selectedLeaveTypeId))
</script>

<svelte:head>
	<title>New Leave Request — Veent HRIS</title>
</svelte:head>

<div class="space-y-6 max-w-xl">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">New Leave Request</h1>
		<a href="/leave" class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</a>
	</div>

	{#if data.balances.length > 0}
		<BalanceSummary balances={data.balances} />
	{/if}

	{#if form?.error}
		<div class="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
			{form.error}
			{#if 'remaining' in form && 'requested' in form && form.remaining !== undefined && form.requested !== undefined}
				<span class="block mt-1">
					Remaining: {form.remaining} days &mdash; Requested: {form.requested} days
				</span>
			{/if}
		</div>
	{/if}

	<form method="POST" action="?/create" use:enhance class="space-y-4 rounded-lg border p-5">
		<div class="space-y-1">
			<label for="leaveTypeId" class="text-sm font-medium">Leave Type</label>
			<select
				id="leaveTypeId"
				name="leaveTypeId"
				required
				bind:value={selectedLeaveTypeId}
				class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<option value="">Select leave type…</option>
				{#each data.leaveTypes as lt (lt.id)}
					<option value={lt.id}>{lt.name}</option>
				{/each}
			</select>
			{#if selectedBalance}
				<p class="text-xs text-muted-foreground mt-1">
					Available: <span class="font-medium">{Number(selectedBalance.remaining)} days</span>
					of {Number(selectedBalance.allocated)} allocated
				</p>
			{/if}
		</div>

		<div class="grid grid-cols-2 gap-4">
			<div class="space-y-1">
				<label for="startDate" class="text-sm font-medium">Start Date</label>
				<input
					id="startDate"
					name="startDate"
					type="date"
					required
					class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</div>
			<div class="space-y-1">
				<label for="endDate" class="text-sm font-medium">End Date</label>
				<input
					id="endDate"
					name="endDate"
					type="date"
					required
					class="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</div>
		</div>

		<div class="space-y-1">
			<label for="reason" class="text-sm font-medium"
				>Reason <span class="text-muted-foreground">(optional)</span></label
			>
			<textarea
				id="reason"
				name="reason"
				rows="3"
				placeholder="Provide a reason for your leave request…"
				class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
			></textarea>
		</div>

		<div class="flex gap-3 pt-1">
			<button
				type="submit"
				class="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				Submit Request
			</button>
			<a href="/leave" class="rounded-md border px-5 py-2 text-sm hover:bg-accent"> Cancel </a>
		</div>
	</form>
</div>
