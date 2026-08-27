<script lang="ts">
	import { enhance } from '$app/forms'
	import { advanceTo } from '$lib/actions/dateRange'
	import { formatShortDate } from '$lib/utils/format'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let cycleStart = $state('')
	let cycleEnd = $state('')

	// #108: a double-click would create a duplicate cycle, or re-run a status transition.
	const createCycle = createSubmitGuard()

	// Forms inside {#each} need one guard per row — a single shared guard would disable every
	// row's button at once. Keyed lazily so each row keeps its own stable instance.
	const rowGuards = new Map<string, ReturnType<typeof createSubmitGuard>>()
	function rowGuard(key: string) {
		let g = rowGuards.get(key)
		if (!g) {
			g = createSubmitGuard()
			rowGuards.set(key, g)
		}
		return g
	}

	const reviewStatusClass = (status: string) =>
		status === 'COMPLETED' || status === 'ACKNOWLEDGED'
			? 'bg-green-500/15 text-green-400'
			: status === 'PENDING'
				? 'bg-yellow-500/15 text-yellow-400'
				: 'bg-blue-500/15 text-blue-400'
</script>

<svelte:head>
	<title>Performance — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Performance</h1>
	</div>

	<!-- Top level: page-wide error banner for createCycle / setCycleStatus / openReviews. -->
	{#if form?.error}
		<div class="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
			{form.error}
		</div>
	{/if}

	<!-- #178 readiness note. Informational, never a gate: it disables nothing and blocks no
	     action. The count is 0 for anyone without ADMINISTER_HR_ORGWIDE (see the load), so the
	     capability check is the server's and `> 0` is the whole client-side condition. -->
	{#if data.templateBackfill > 0}
		<p class="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm">
			{data.templateBackfill} active
			{data.templateBackfill === 1 ? 'employee has' : 'employees have'} no assigned template. This is
			a readiness note, not a blocker.
		</p>
	{/if}

	<!-- Review Cycles (HR) -->
	{#if data.isAdmin}
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Review Cycles</h2>
			<form
				method="POST"
				action="?/createCycle"
				use:enhance={createCycle.enhance}
				class="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-4"
			>
				<input
					name="name"
					aria-label="Cycle name"
					placeholder="e.g. 2026 Mid-Year"
					required
					class="h-9 w-44 rounded-md border border-input bg-background px-2 text-sm"
				/>
				<input
					name="startDate"
					type="date"
					aria-label="Cycle start date"
					required
					bind:value={cycleStart}
					max={cycleEnd || undefined}
					use:advanceTo={'endDate'}
					class="h-9 rounded-md border border-input bg-background px-2 text-sm"
				/>
				<input
					name="endDate"
					type="date"
					aria-label="Cycle end date"
					required
					bind:value={cycleEnd}
					min={cycleStart || undefined}
					class="h-9 rounded-md border border-input bg-background px-2 text-sm"
				/>
				<button
					disabled={createCycle.busy}
					class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
					>{createCycle.busy ? 'Creating…' : 'Create cycle'}</button
				>
			</form>
			{#if data.cycles.length}
				<div class="overflow-x-auto rounded-lg border">
					<table class="w-full text-sm">
						<thead class="border-b bg-muted/50">
							<tr>
								<th class="px-4 py-3 text-left font-medium text-muted-foreground">Cycle</th>
								<th class="px-4 py-3 text-left font-medium text-muted-foreground">Period</th>
								<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
								<th class="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
							</tr>
						</thead>
						<tbody class="divide-y">
							{#each data.cycles as c (c.id)}
								{@const activateCycle = rowGuard('activate-' + c.id)}
								{@const openReviews = rowGuard('open-' + c.id)}
								{@const closeCycle = rowGuard('close-' + c.id)}
								<tr class="hover:bg-muted/30">
									<td class="px-4 py-3 font-medium">{c.name}</td>
									<td class="px-4 py-3 text-muted-foreground"
										>{formatShortDate(c.startDate)} – {formatShortDate(c.endDate)}</td
									>
									<td class="px-4 py-3"
										><span
											class="rounded-full px-2 py-0.5 text-xs font-medium {reviewStatusClass(
												c.status
											)}">{c.status}</span
										></td
									>
									<td class="px-4 py-3">
										<div class="flex items-center justify-end gap-2">
											{#if c.status === 'DRAFT'}
												<form
													method="POST"
													action="?/setCycleStatus"
													use:enhance={activateCycle.enhance}
												>
													<input type="hidden" name="id" value={c.id} /><input
														type="hidden"
														name="status"
														value="ACTIVE"
													/><button
														disabled={activateCycle.busy}
														class="rounded-md border border-green-500/20 px-3 py-1 text-xs font-medium text-green-600 dark:text-green-400 hover:bg-green-500/10 disabled:pointer-events-none disabled:opacity-50"
														>{activateCycle.busy ? 'Activating…' : 'Activate'}</button
													>
												</form>
											{/if}
											{#if c.status === 'ACTIVE'}
												<form
													method="POST"
													action="?/openReviews"
													use:enhance={openReviews.enhance}
												>
													<input type="hidden" name="id" value={c.id} /><button
														disabled={openReviews.busy}
														class="rounded-md border border-primary/40 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-50"
														>{openReviews.busy ? 'Opening…' : 'Open reviews'}</button
													>
												</form>
												<form
													method="POST"
													action="?/setCycleStatus"
													use:enhance={closeCycle.enhance}
												>
													<input type="hidden" name="id" value={c.id} /><input
														type="hidden"
														name="status"
														value="CLOSED"
													/><button
														disabled={closeCycle.busy}
														class="rounded-md border border-red-500/20 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:pointer-events-none disabled:opacity-50"
														>{closeCycle.busy ? 'Closing…' : 'Close'}</button
													>
												</form>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
			{#if form?.opened != null}<p class="text-xs text-green-600 dark:text-green-400">
					Opened {form.opened} review(s).
				</p>{/if}
		</section>
	{/if}

	<!-- My Reviews -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">My Reviews</h2>
		<div class="overflow-x-auto rounded-lg border">
			<table class="w-full text-sm">
				<thead class="border-b bg-muted/50">
					<tr>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Cycle</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Reviewer</th>
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.myReviews as review (review.id)}
						<tr class="hover:bg-muted/30">
							<td class="px-4 py-3"
								><a
									href="/performance/reviews/{review.id}"
									class="font-medium text-primary hover:underline">{review.cycle.name}</a
								></td
							>
							<td class="px-4 py-3 text-muted-foreground">
								{review.reviewer.lastName}, {review.reviewer.firstName}
							</td>
							<td class="px-4 py-3">
								<span
									class="rounded-full px-2 py-0.5 text-xs font-medium {reviewStatusClass(
										review.status
									)}"
								>
									{review.status}
								</span>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="3" class="px-4 py-8 text-center text-muted-foreground">No reviews</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Reviews to Complete (reviewer) -->
	{#if data.reviewsToGive.length}
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Reviews to Complete</h2>
			<div class="overflow-x-auto rounded-lg border">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/50">
						<tr>
							<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>
							<th class="px-4 py-3 text-left font-medium text-muted-foreground">Cycle</th>
							<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each data.reviewsToGive as review (review.id)}
							<tr class="hover:bg-muted/30">
								<td class="px-4 py-3"
									><a
										href="/performance/reviews/{review.id}"
										class="font-medium text-primary hover:underline"
										>{review.employee.lastName}, {review.employee.firstName}</a
									></td
								>
								<td class="px-4 py-3 text-muted-foreground">{review.cycle.name}</td>
								<td class="px-4 py-3">
									<span
										class="rounded-full px-2 py-0.5 text-xs font-medium {reviewStatusClass(
											review.status
										)}"
									>
										{review.status}
									</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>
