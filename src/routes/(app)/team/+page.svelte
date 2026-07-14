<script lang="ts">
	import { formatShortDate } from '$lib/utils/format'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
</script>

<svelte:head>
	<title>Team — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Team Attendance</h1>
	</div>

	<!-- Date range filter -->
	<form method="GET" class="flex flex-wrap items-end gap-3 rounded-md border p-4">
		<div>
			<label for="start" class="block text-sm font-medium mb-1">Start Date</label>
			<input
				id="start"
				name="start"
				type="date"
				value={data.startDate}
				class="flex h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
		</div>
		<div>
			<label for="end" class="block text-sm font-medium mb-1">End Date</label>
			<input
				id="end"
				name="end"
				type="date"
				value={data.endDate}
				class="flex h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
		</div>
		<button
			type="submit"
			class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
		>
			Apply
		</button>
	</form>

	<!-- Legend -->
	<div class="flex gap-4 text-xs text-muted-foreground">
		<span class="flex items-center gap-1.5">
			<span
				class="inline-flex h-5 w-5 items-center justify-center rounded bg-green-100 text-green-700 font-bold"
				>P</span
			>
			Present
		</span>
		<span class="flex items-center gap-1.5">
			<span
				class="inline-flex h-5 w-5 items-center justify-center rounded bg-yellow-100 text-yellow-700 font-bold"
				>L</span
			>
			On Leave
		</span>
		<span class="flex items-center gap-1.5">
			<span
				class="inline-flex h-5 w-5 items-center justify-center rounded bg-muted text-muted-foreground font-bold"
				>–</span
			>
			No Data
		</span>
	</div>

	<!-- Attendance table -->
	{#if data.members.length === 0}
		<div class="rounded-md border bg-muted/50 px-6 py-12 text-center text-muted-foreground text-sm">
			No team members found.
		</div>
	{:else}
		<div class="overflow-x-auto rounded-md border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th
							class="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap sticky left-0 bg-muted/50 z-10"
						>
							Employee
						</th>
						{#each data.dates as date (date)}
							<th
								class="px-2 py-3 text-center font-medium text-muted-foreground whitespace-nowrap min-w-[64px]"
							>
								{formatShortDate(date)}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.members as member (member.id)}
						<tr class="hover:bg-muted/30">
							<td class="px-4 py-3 font-medium whitespace-nowrap sticky left-0 bg-background z-10">
								{member.lastName}, {member.firstName}
							</td>
							{#each data.dates as date (date)}
								{@const status = data.attendanceMap[member.id]?.[date]}
								<td class="px-2 py-3 text-center">
									{#if status === 'P'}
										<span
											class="inline-flex h-6 w-6 items-center justify-center rounded bg-green-100 text-green-700 text-xs font-bold"
										>
											P
										</span>
									{:else if status === 'L'}
										<span
											class="inline-flex h-6 w-6 items-center justify-center rounded bg-yellow-100 text-yellow-700 text-xs font-bold"
										>
											L
										</span>
									{:else}
										<span
											class="inline-flex h-6 w-6 items-center justify-center rounded bg-muted text-muted-foreground text-xs"
										>
											–
										</span>
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
