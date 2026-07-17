<script lang="ts">
	import { enhance } from '$app/forms'
	import { advanceTo } from '$lib/actions/dateRange'
	import type { ActionData } from './$types'

	let { form }: { form: ActionData } = $props()

	const inputClass =
		'mt-1 flex h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
</script>

<svelte:head>
	<title>New Timesheet — Veent HRIS</title>
</svelte:head>

<div class="max-w-2xl space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">New Timesheet</h1>
		<a href="/timesheets" class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</a>
	</div>

	{#if form?.error}
		<div
			class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
		>
			{form.error}
		</div>
	{/if}

	<form method="POST" action="?/create" use:enhance class="rounded-lg border p-4 space-y-3">
		<p class="text-sm text-muted-foreground">
			Pick the period. Hours are seeded from your recorded attendance punches — adjust them
			afterward from the timesheet's row. The sheet is saved as a draft; submit it for review
			separately.
		</p>
		<!-- svelte-ignore a11y_label_has_associated_control -->
		<div class="flex flex-wrap items-end gap-4">
			<div>
				<label class="text-sm font-medium">Period Start</label>
				<input
					name="periodStart"
					type="date"
					required
					use:advanceTo={'periodEnd'}
					class={inputClass}
				/>
			</div>
			<div>
				<label class="text-sm font-medium">Period End</label>
				<input name="periodEnd" type="date" required class={inputClass} />
			</div>
			<button
				type="submit"
				class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
				>Create</button
			>
		</div>
	</form>
</div>
