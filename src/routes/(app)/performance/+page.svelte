<script lang="ts">
	import { enhance } from '$app/forms'
	import { advanceTo } from '$lib/actions/dateRange'
	import { formatShortDate } from '$lib/utils/format'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showGoal = $state(false)
	let cycleStart = $state('')
	let cycleEnd = $state('')

	const goalStatusClass = (status: string) =>
		status === 'COMPLETED'
			? 'bg-green-100 text-green-700'
			: status === 'CANCELLED'
				? 'bg-red-100 text-red-700'
				: status === 'DRAFT'
					? 'bg-gray-100 text-gray-700'
					: 'bg-blue-100 text-blue-700'

	const reviewStatusClass = (status: string) =>
		status === 'COMPLETED' || status === 'ACKNOWLEDGED'
			? 'bg-green-100 text-green-700'
			: status === 'PENDING'
				? 'bg-yellow-100 text-yellow-700'
				: 'bg-blue-100 text-blue-700'
</script>

<svelte:head>
	<title>Performance — Veent HRIS</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Performance</h1>
		<button
			onclick={() => (showGoal = !showGoal)}
			class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
		>
			New Goal
		</button>
	</div>

	<!-- Create goal form -->
	{#if showGoal}
		<form method="POST" action="?/createGoal" use:enhance class="rounded-lg border p-4 space-y-4">
			<h2 class="font-semibold">Create Goal</h2>
			{#if form?.error}
				<div class="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">{form.error}</div>
			{/if}
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="sm:col-span-2">
					<label for="title" class="text-sm font-medium">Title</label>
					<input
						id="title"
						name="title"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div class="sm:col-span-2">
					<label for="description" class="text-sm font-medium">Description (optional)</label>
					<textarea
						id="description"
						name="description"
						rows="2"
						class="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					></textarea>
				</div>
				<div>
					<label for="category" class="text-sm font-medium">Category (optional)</label>
					<input
						id="category"
						name="category"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label for="targetDate" class="text-sm font-medium">Target Date (optional)</label>
					<input
						id="targetDate"
						name="targetDate"
						type="date"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
			</div>
			<div class="flex gap-2 justify-end">
				<button
					type="button"
					onclick={() => (showGoal = false)}
					class="rounded-md border px-4 py-2 text-sm hover:bg-accent">Cancel</button
				>
				<button
					type="submit"
					class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>Save Goal</button
				>
			</div>
		</form>
	{/if}

	<!-- My Goals -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">My Goals</h2>
		{#if data.myGoals.length > 0}
			<div class="grid gap-3 sm:grid-cols-2">
				{#each data.myGoals as goal (goal.id)}
					<div class="rounded-lg border bg-card p-4 space-y-3">
						<div class="flex items-start justify-between gap-2">
							<div>
								<p class="font-medium">{goal.title}</p>
								{#if goal.category}
									<p class="text-xs text-muted-foreground">{goal.category}</p>
								{/if}
							</div>
							<span
								class="rounded-full px-2 py-0.5 text-xs font-medium {goalStatusClass(goal.status)}"
							>
								{goal.status}
							</span>
						</div>
						{#if goal.description}
							<p class="text-sm text-muted-foreground">{goal.description}</p>
						{/if}
						<div>
							<div class="flex items-center justify-between text-xs text-muted-foreground">
								<span>Progress</span>
								<span>{goal.progress}%</span>
							</div>
							<div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
								<div class="h-full rounded-full bg-primary" style="width: {goal.progress}%"></div>
							</div>
						</div>
						{#if goal.targetDate}
							<p class="text-xs text-muted-foreground">
								Target: {formatShortDate(goal.targetDate)}
							</p>
						{/if}
						<form
							method="POST"
							action="?/updateGoal"
							use:enhance
							class="flex items-end gap-2 border-t pt-3"
						>
							<input type="hidden" name="id" value={goal.id} />
							<div class="flex-1">
								<label for={'progress-' + goal.id} class="text-xs font-medium text-muted-foreground"
									>Progress</label
								>
								<input
									id={'progress-' + goal.id}
									name="progress"
									type="number"
									min="0"
									max="100"
									value={goal.progress}
									class="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								/>
							</div>
							<div class="flex-1">
								<label for={'status-' + goal.id} class="text-xs font-medium text-muted-foreground"
									>Status</label
								>
								<select
									id={'status-' + goal.id}
									name="status"
									class="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									{#each ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as s (s)}
										<option value={s} selected={s === goal.status}>{s}</option>
									{/each}
								</select>
							</div>
							<button
								type="submit"
								class="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
								>Update</button
							>
						</form>
					</div>
				{/each}
			</div>
		{:else}
			<div class="rounded-lg border p-8 text-center text-sm text-muted-foreground">
				No goals yet
			</div>
		{/if}
	</section>

	<!-- Review Cycles (HR) -->
	{#if data.isAdmin}
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Review Cycles</h2>
			<form
				method="POST"
				action="?/createCycle"
				use:enhance
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
					class="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>Create cycle</button
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
												<form method="POST" action="?/setCycleStatus" use:enhance>
													<input type="hidden" name="id" value={c.id} /><input
														type="hidden"
														name="status"
														value="ACTIVE"
													/><button
														class="rounded-md border border-green-200 px-3 py-1 text-xs font-medium text-green-600 hover:bg-green-50"
														>Activate</button
													>
												</form>
											{/if}
											{#if c.status === 'ACTIVE'}
												<form method="POST" action="?/openReviews" use:enhance>
													<input type="hidden" name="id" value={c.id} /><button
														class="rounded-md border border-primary/40 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10"
														>Open reviews</button
													>
												</form>
												<form method="POST" action="?/setCycleStatus" use:enhance>
													<input type="hidden" name="id" value={c.id} /><input
														type="hidden"
														name="status"
														value="CLOSED"
													/><button
														class="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
														>Close</button
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
			{#if form?.opened != null}<p class="text-xs text-green-600">
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
						<th class="px-4 py-3 text-left font-medium text-muted-foreground">Rating</th>
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
							<td class="px-4 py-3">{review.overallRating ?? '—'}</td>
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
							<td colspan="4" class="px-4 py-8 text-center text-muted-foreground">No reviews</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Team Goals (manager view) -->
	{#if data.isManager && data.teamGoals.length}
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Team Goals</h2>
			<div class="overflow-x-auto rounded-lg border">
				<table class="w-full text-sm">
					<thead class="border-b bg-muted/50">
						<tr>
							<th class="px-4 py-3 text-left font-medium text-muted-foreground">Employee</th>
							<th class="px-4 py-3 text-left font-medium text-muted-foreground">Goal</th>
							<th class="px-4 py-3 text-right font-medium text-muted-foreground">Progress</th>
							<th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each data.teamGoals as g (g.id)}
							<tr class="hover:bg-muted/30">
								<td class="px-4 py-3">{g.employee.lastName}, {g.employee.firstName}</td>
								<td class="px-4 py-3 font-medium">{g.title}</td>
								<td class="px-4 py-3 text-right">{g.progress}%</td>
								<td class="px-4 py-3"
									><span
										class="rounded-full px-2 py-0.5 text-xs font-medium {goalStatusClass(g.status)}"
										>{g.status}</span
									></td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

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
