<script lang="ts">
	import { enhance } from '$app/forms'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showCreate = $state(false)

	// #108: a double-click would create a duplicate work schedule.
	const createSchedule = createSubmitGuard()

	const DOW = [
		{ v: 1, l: 'Mon' },
		{ v: 2, l: 'Tue' },
		{ v: 3, l: 'Wed' },
		{ v: 4, l: 'Thu' },
		{ v: 5, l: 'Fri' },
		{ v: 6, l: 'Sat' },
		{ v: 0, l: 'Sun' }
	]
	const label = (w: number) => DOW.find((d) => d.v === w)?.l ?? String(w)
	const toHHMM = (m: number) =>
		`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
</script>

<svelte:head>
	<title>Work Schedules — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-3">
			<BackButton fallback="/settings" label="Settings" />
			<h1 class="text-2xl font-bold tracking-tight">Work Schedules</h1>
		</div>
		<button
			onclick={() => (showCreate = !showCreate)}
			class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>New Schedule</button
		>
	</div>

	{#if form?.error}
		<div
			class="rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-red-400"
		>
			{form.error}
		</div>
	{/if}

	{#if showCreate}
		<form
			method="POST"
			action="?/create"
			use:enhance={createSchedule.enhance}
			class="rounded-lg border p-4 space-y-4"
		>
			<h2 class="font-semibold">New Work Schedule</h2>
			<div class="grid gap-3 sm:grid-cols-4">
				<div class="sm:col-span-2">
					<label for="name" class="text-sm font-medium">Name</label>
					<input
						id="name"
						name="name"
						required
						placeholder="Regular (Mon–Fri 8–5)"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
					/>
				</div>
				<div>
					<label for="start" class="text-sm font-medium">Start</label>
					<input
						id="start"
						name="start"
						type="time"
						value="08:00"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
					/>
				</div>
				<div>
					<label for="end" class="text-sm font-medium">End</label>
					<input
						id="end"
						name="end"
						type="time"
						value="17:00"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
					/>
				</div>
				<div>
					<label for="breakMinutes" class="text-sm font-medium">Break (min)</label>
					<input
						id="breakMinutes"
						name="breakMinutes"
						type="number"
						step="5"
						min="0"
						value="60"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
					/>
				</div>
			</div>
			<div>
				<span class="text-sm font-medium">Working days</span>
				<div class="mt-1 flex flex-wrap gap-3">
					{#each DOW as d (d.v)}
						<label class="flex items-center gap-1.5 text-sm">
							<input type="checkbox" name="weekday" value={d.v} checked={d.v >= 1 && d.v <= 5} />
							{d.l}
						</label>
					{/each}
				</div>
			</div>
			<label class="flex items-center gap-2 text-sm"
				><input type="checkbox" name="isDefault" /> Set as the organization default</label
			>
			<div class="flex justify-end gap-2">
				<button
					type="button"
					onclick={() => (showCreate = false)}
					class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button
				>
				<button
					type="submit"
					disabled={createSchedule.busy}
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
					>{createSchedule.busy ? 'Creating…' : 'Create'}</button
				>
			</div>
		</form>
	{/if}

	<div class="overflow-x-auto rounded-lg border">
		<table class="w-full text-sm">
			<thead class="border-b bg-muted/50">
				<tr>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Days</th>
					<th class="px-4 py-3 text-left font-medium text-muted-foreground">Shift</th>
					<th class="px-4 py-3 text-right font-medium text-muted-foreground">Employees</th>
				</tr>
			</thead>
			<tbody class="divide-y">
				{#each data.schedules as s (s.id)}
					{@const shift = s.days[0]}
					<tr class="hover:bg-muted/30">
						<td class="px-4 py-3 font-medium"
							>{s.name}
							{#if s.isDefault}<span
									class="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700"
									>default</span
								>{/if}</td
						>
						<td class="px-4 py-3 text-muted-foreground"
							>{s.days.map((d) => label(d.weekday)).join(', ') || '—'}</td
						>
						<td class="px-4 py-3 text-muted-foreground"
							>{shift
								? `${toHHMM(shift.startMinutes)}–${toHHMM(shift.endMinutes)} · ${shift.breakMinutes}m break`
								: '—'}</td
						>
						<td class="px-4 py-3 text-right">{s._count.employees}</td>
					</tr>
				{:else}
					<tr
						><td colspan="4" class="px-4 py-8 text-center text-muted-foreground"
							>No schedules yet. Until one is marked the organization default, unassigned employees
							fall back to Mon–Fri 8:00–17:00.</td
						></tr
					>
				{/each}
			</tbody>
		</table>
	</div>
</div>
