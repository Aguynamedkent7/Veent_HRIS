<script lang="ts">
	import { enhance } from '$app/forms'
	import BackButton from '$lib/components/ui/BackButton.svelte'
	import { createSubmitGuard } from '$lib/utils/submit-guard.svelte'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	const r = $derived(data.review)

	// #108: double-submitting these re-writes the review.
	const saveSelf = createSubmitGuard()
	const submitReview = createSubmitGuard()

	function statusClass(s: string) {
		if (s === 'ACKNOWLEDGED') return 'bg-green-500/15 text-green-400'
		if (s === 'COMPLETED') return 'bg-blue-500/15 text-blue-400'
		if (s === 'PENDING') return 'bg-gray-500/15 text-gray-400'
		return 'bg-yellow-500/15 text-yellow-400'
	}
</script>

<svelte:head>
	<title>Performance Review — Veent HRIS</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
	<BackButton fallback="/performance" label="Performance" />

	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">
				{r.employee.firstName}
				{r.employee.lastName}
			</h1>
			<p class="text-sm text-muted-foreground">
				{r.cycle.name} · Reviewer: {r.reviewer.firstName}
				{r.reviewer.lastName}
			</p>
		</div>
		<span class="rounded-full px-2.5 py-1 text-xs font-medium {statusClass(r.status)}"
			>{r.status.replace('_', ' ')}</span
		>
	</div>

	{#if form?.error}
		<div
			class="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400"
		>
			{form.error}
		</div>
	{/if}

	<!-- Self-assessment -->
	<section class="space-y-2 rounded-lg border bg-card p-4">
		<h2 class="font-semibold">Self-Assessment</h2>
		{#if data.isSubject && (r.status === 'PENDING' || r.status === 'SELF_ASSESSMENT')}
			<form method="POST" action="?/saveSelf" use:enhance={saveSelf.enhance} class="space-y-2">
				<textarea
					name="selfAssessment"
					rows="4"
					class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
					>{r.selfAssessment ?? ''}</textarea
				>
				<button
					disabled={saveSelf.busy}
					class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
					>{saveSelf.busy ? 'Saving…' : 'Save self-assessment'}</button
				>
			</form>
		{:else if r.selfAssessment}
			<p class="whitespace-pre-line text-sm text-muted-foreground">{r.selfAssessment}</p>
		{:else}
			<p class="text-sm text-muted-foreground">Not submitted yet.</p>
		{/if}
	</section>

	<!-- Manager review -->
	<section class="space-y-2 rounded-lg border bg-card p-4">
		<h2 class="font-semibold">Manager Review</h2>
		{#if data.isReviewer && r.status !== 'ACKNOWLEDGED'}
			<form
				method="POST"
				action="?/submitReview"
				use:enhance={submitReview.enhance}
				class="space-y-2"
			>
				<textarea
					name="managerComments"
					rows="4"
					placeholder="Comments"
					class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
					>{r.managerComments ?? ''}</textarea
				>
				<div class="flex items-center gap-2">
					<label for="rating" class="text-sm">Overall rating (1–5)</label>
					<input
						id="rating"
						name="overallRating"
						type="number"
						min="1"
						max="5"
						value={r.overallRating ?? ''}
						class="h-9 w-16 rounded-md border border-input bg-background px-2 text-sm"
					/>
				</div>
				<button
					disabled={submitReview.busy}
					class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
					>{submitReview.busy ? 'Submitting…' : 'Submit review'}</button
				>
			</form>
		{:else if data.isSubject}
			<!-- #179: the reviewed employee never sees the HR-authored comments or rating. -->
			<p class="text-sm text-muted-foreground">This review is confidential and managed by HR.</p>
		{:else if r.managerComments || r.overallRating != null}
			<p class="whitespace-pre-line text-sm text-muted-foreground">{r.managerComments ?? ''}</p>
			{#if r.overallRating != null}<p class="text-sm font-medium">
					Rating: {r.overallRating}/5
				</p>{/if}
		{:else}
			<p class="text-sm text-muted-foreground">Awaiting manager review.</p>
		{/if}
	</section>
</div>
