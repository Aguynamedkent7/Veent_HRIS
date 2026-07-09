<script lang="ts">
	import { enhance } from '$app/forms'

	interface Props {
		type: 'timesheet' | 'leave'
		id: string
		submitterName: string
		period: string
		details: string
		actionApprove: string
		actionReject: string
	}

	let { type, id, submitterName, period, details, actionApprove, actionReject }: Props = $props()

	let showRejectForm = $state(false)
	let rejectionReason = $state('')
</script>

<div class="rounded-md border bg-card p-4 space-y-3">
	<!-- Header -->
	<div class="flex items-start justify-between gap-3">
		<div>
			<p class="font-semibold text-sm">{submitterName}</p>
			<p class="text-xs text-muted-foreground mt-0.5">{period}</p>
		</div>
		<span class="rounded-full px-2 py-0.5 text-xs font-medium {type === 'timesheet' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}">
			{type === 'timesheet' ? 'Timesheet' : 'Leave'}
		</span>
	</div>

	<!-- Body -->
	<div class="rounded-md bg-muted/50 px-3 py-2 text-sm">
		{details}
	</div>

	<!-- Footer actions -->
	{#if !showRejectForm}
		<div class="flex gap-2">
			<form method="POST" action="?/{actionApprove}" use:enhance class="flex-1">
				<input type="hidden" name="id" value={id} />
				<button
					type="submit"
					class="w-full rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
				>
					Approve
				</button>
			</form>
			<button
				type="button"
				onclick={() => (showRejectForm = true)}
				class="flex-1 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
			>
				Reject
			</button>
		</div>
	{:else}
		<form method="POST" action="?/{actionReject}" use:enhance class="space-y-2">
			<input type="hidden" name="id" value={id} />
			<textarea
				name="rejectionReason"
				bind:value={rejectionReason}
				placeholder="Reason for rejection..."
				rows="3"
				class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
			></textarea>
			<div class="flex gap-2">
				<button
					type="button"
					onclick={() => { showRejectForm = false; rejectionReason = '' }}
					class="flex-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
				>
					Cancel
				</button>
				<button
					type="submit"
					class="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
				>
					Confirm Reject
				</button>
			</div>
		</form>
	{/if}
</div>
