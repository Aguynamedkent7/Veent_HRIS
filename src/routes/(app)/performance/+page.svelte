<script lang="ts">
	import { enhance } from '$app/forms'
	import { formatShortDate } from '$lib/utils/format'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	let showGoal = $state(false)

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
					<label class="text-sm font-medium">Title</label>
					<input
						name="title"
						required
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div class="sm:col-span-2">
					<label class="text-sm font-medium">Description (optional)</label>
					<textarea
						name="description"
						rows="2"
						class="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					></textarea>
				</div>
				<div>
					<label class="text-sm font-medium">Category (optional)</label>
					<input
						name="category"
						class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				<div>
					<label class="text-sm font-medium">Target Date (optional)</label>
					<input
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
							<p class="text-xs text-muted-foreground">Target: {formatShortDate(goal.targetDate)}</p>
						{/if}
						<form
							method="POST"
							action="?/updateGoal"
							use:enhance
							class="flex items-end gap-2 border-t pt-3"
						>
							<input type="hidden" name="id" value={goal.id} />
							<div class="flex-1">
								<label class="text-xs font-medium text-muted-foreground">Progress</label>
								<input
									name="progress"
									type="number"
									min="0"
									max="100"
									value={goal.progress}
									class="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								/>
							</div>
							<div class="flex-1">
								<label class="text-xs font-medium text-muted-foreground">Status</label>
								<select
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
			<div class="rounded-lg border p-8 text-center text-sm text-muted-foreground">No goals yet</div>
		{/if}
	</section>

	<!-- My Reviews -->
	<section class="space-y-3">
		<h2 class="text-lg font-semibold">My Reviews</h2>
		<div class="rounded-lg border">
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
							<td class="px-4 py-3">{review.cycle.name}</td>
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

	<!-- Reviews to Complete (reviewer) -->
	{#if data.reviewsToGive.length}
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Reviews to Complete</h2>
			<div class="rounded-lg border">
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
								<td class="px-4 py-3">{review.employee.lastName}, {review.employee.firstName}</td>
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
