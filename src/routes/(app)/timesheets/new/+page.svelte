<script lang="ts">
	import { enhance } from '$app/forms'
	import { advanceTo } from '$lib/actions/dateRange'
	import type { ActionData } from './$types'

	let { form }: { form: ActionData } = $props()

	const inputClass =
		'flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
</script>

<svelte:head>
	<title>New Timesheet — Veent HRIS</title>
</svelte:head>

<div class="mx-auto max-w-xl py-10">
	<div class="space-y-6 rounded-xl border bg-card p-8 shadow-sm">
		<div class="space-y-2 text-center">
			<div
				class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"
			>
				<svg
					class="h-6 w-6"
					fill="none"
					viewBox="0 0 24 24"
					stroke-width="1.8"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
					/>
				</svg>
			</div>
			<h1 class="text-2xl font-bold tracking-tight">New Timesheet</h1>
			<p class="mx-auto max-w-md text-sm text-muted-foreground">
				Hours are seeded from your recorded attendance punches — adjust them afterward from the
				timesheet's row. The sheet is saved as a draft; submit it for review separately.
			</p>
		</div>

		{#if form?.error}
			<div
				class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive"
			>
				{form.error}
			</div>
		{/if}

		<form method="POST" action="?/create" use:enhance class="space-y-5">
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="space-y-1.5">
					<label for="periodStart" class="text-sm font-medium">Period Start</label>
					<input
						id="periodStart"
						name="periodStart"
						type="date"
						required
						use:advanceTo={'periodEnd'}
						class={inputClass}
					/>
				</div>
				<div class="space-y-1.5">
					<label for="periodEnd" class="text-sm font-medium">Period End</label>
					<input id="periodEnd" name="periodEnd" type="date" required class={inputClass} />
				</div>
			</div>

			<div class="flex gap-3 pt-1">
				<a
					href="/timesheets"
					class="flex-1 rounded-md border px-4 py-2.5 text-center text-sm font-medium hover:bg-accent"
					>Cancel</a
				>
				<button
					type="submit"
					class="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>Create timesheet</button
				>
			</div>
		</form>
	</div>
</div>
