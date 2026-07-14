<script lang="ts">
	import { enhance } from '$app/forms'
	import WeeklyGrid from '$lib/components/timesheets/WeeklyGrid.svelte'
	import { getWeekStart, getWeekEnd, formatDateISO } from '$lib/utils/dates'
	import type { ActionData } from './$types'

	let { form }: { form: ActionData } = $props()

	let weekOffset = $state(0)

	function offsetDate(offset: number): Date {
		const d = new Date()
		d.setDate(d.getDate() + offset * 7)
		return d
	}

	let weekStart = $derived(getWeekStart(offsetDate(weekOffset)))
	let weekEnd = $derived(getWeekEnd(offsetDate(weekOffset)))

	// Build default entries for the current week (Mon–Sun)
	function buildDefaultEntries(start: Date) {
		return Array.from({ length: 7 }, (_, i) => {
			const d = new Date(start)
			d.setDate(d.getDate() + i)
			return { date: d, hoursWorked: 0, notes: '' }
		})
	}

	let entries = $state<{ date: Date; hoursWorked: number; notes?: string }[]>([])

	$effect(() => {
		entries = buildDefaultEntries(weekStart)
	})

	let entriesJson = $derived(
		JSON.stringify(
			entries.map((e) => ({
				date: formatDateISO(e.date),
				hoursWorked: e.hoursWorked,
				notes: e.notes ?? ''
			}))
		)
	)

	function handleEntriesChange(updated: typeof entries) {
		entries = updated
	}
</script>

<svelte:head>
	<title>New Timesheet — Veent HRIS</title>
</svelte:head>

<div class="space-y-6 max-w-4xl">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">New Timesheet</h1>
		<a href="/timesheets" class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</a>
	</div>

	{#if form?.error}
		<div class="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
			{form.error}
		</div>
	{/if}

	<div class="flex items-center gap-3">
		<button
			type="button"
			onclick={() => weekOffset--}
			class="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
		>
			&larr; Prev
		</button>
		<span class="text-sm font-medium">
			{formatDateISO(weekStart)} &ndash; {formatDateISO(weekEnd)}
		</span>
		<button
			type="button"
			onclick={() => weekOffset++}
			class="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
		>
			Next &rarr;
		</button>
	</div>

	<WeeklyGrid {entries} onchange={handleEntriesChange} />

	<form method="POST" action="?/create" use:enhance class="space-y-4">
		<input type="hidden" name="periodStart" value={formatDateISO(weekStart)} />
		<input type="hidden" name="periodEnd" value={formatDateISO(weekEnd)} />
		<input type="hidden" name="entries" value={entriesJson} />

		<div class="flex gap-3">
			<button
				type="submit"
				class="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				Submit Timesheet
			</button>
			<a href="/timesheets" class="rounded-md border px-5 py-2 text-sm hover:bg-accent"> Cancel </a>
		</div>
	</form>
</div>
